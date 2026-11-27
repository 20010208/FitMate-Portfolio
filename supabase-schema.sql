-- FitMate Supabase Schema — DEPRECATED / NON-AUTHORITATIVE REFERENCE ONLY
--
-- Do NOT paste this file into the Supabase SQL Editor and run it. It is not
-- kept in sync with every column/constraint Production actually has (for
-- example, it does not include profiles' gender/target_days/target_date/
-- nickname/character/fitness_goal columns, their CHECK constraints, or the
-- step_logs/blogs/food_items.reading objects), and running it against an
-- environment that already has these tables will fail or, worse, could
-- silently diverge from the real schema.
--
-- The only source of truth for this project's schema is
-- `supabase/migrations/` (applied in filename order). For a full picture of
-- what a *fresh* project's schema should look like, see the (also
-- non-executed-against-Production) baseline artifact at
-- `supabase/baseline/20260804_production_schema.sql`, which is kept
-- consistent with the versioned migrations and the confirmed Production
-- state as of 2026-08-04.
--
-- This file is kept only as a historical, human-readable snapshot of the
-- original schema definition (profiles/trainings/weight_records/meal_logs +
-- the AI usage quota objects), predating the versioned migration history.

-- profiles テーブル
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  name text default '',
  birthday text default null,
  height text default '',
  goal_weight text default '',
  created_at timestamptz default now()
);

-- trainings テーブル
create table if not exists public.trainings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  date_id text not null,  -- 'yyyyMMdd' format
  category text not null,
  exercise text not null,
  sets jsonb not null default '[]',
  created_at timestamptz default now()
);

-- weight_records テーブル
create table if not exists public.weight_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  date_id text not null,  -- 'yyyyMMdd' format
  weight text default '',
  body_fat text default '',
  created_at timestamptz default now(),
  unique(user_id, date_id)
);

-- meal_logs テーブル
create table if not exists public.meal_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  date_id text not null,  -- 'yyyyMMdd' format
  category text not null, -- 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacking'
  items jsonb not null default '[]',
  did_not_eat boolean default false,
  created_at timestamptz default now(),
  unique(user_id, date_id, category)
);

-- Row Level Security (RLS) を有効化
alter table public.profiles enable row level security;
alter table public.trainings enable row level security;
alter table public.weight_records enable row level security;
alter table public.meal_logs enable row level security;

-- RLS ポリシー: 自分のデータのみ操作可能
create policy "profiles: own data" on public.profiles
  for all using (auth.uid() = user_id);

create policy "trainings: own data" on public.trainings
  for all using (auth.uid() = user_id);

create policy "weight_records: own data" on public.weight_records
  for all using (auth.uid() = user_id);

create policy "meal_logs: own data" on public.meal_logs
  for all using (auth.uid() = user_id);

-- ユーザー登録時に自動でprofileを作成するトリガー
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id)
  values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- インデックス（検索パフォーマンス向上）
create index if not exists trainings_user_date on public.trainings(user_id, date_id);
create index if not exists weight_user_date on public.weight_records(user_id, date_id);
create index if not exists meal_user_date on public.meal_logs(user_id, date_id);

-- ============================================================
-- AI usage quota（analyze-meal / character-message / training-calorie）
-- ユーザーごとに1行のstate table。直接のtable操作はanon/authenticatedへ許可せず、
-- SECURITY DEFINER RPC（reserve_ai_usage / release_ai_usage）経由のみで操作する。
-- 詳細は supabase/migrations/202607230001_add_ai_usage_quota.sql 参照。
-- ============================================================

create table if not exists public.ai_usage_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minute_window_start timestamptz not null default now(),
  minute_count integer not null default 0,
  day_key date not null default ((now() at time zone 'Asia/Tokyo')::date),
  day_count integer not null default 0,
  active_request_id uuid,
  active_route text,
  active_until timestamptz,
  total_count bigint not null default 0,
  last_route text,
  last_used_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint ai_usage_state_minute_count_check check (minute_count >= 0),
  constraint ai_usage_state_day_count_check check (day_count >= 0),
  constraint ai_usage_state_total_count_check check (total_count >= 0),
  constraint ai_usage_state_active_route_check check (
    active_route is null or active_route in ('analyze-meal', 'character-message', 'training-calorie')
  ),
  constraint ai_usage_state_last_route_check check (
    last_route is null or last_route in ('analyze-meal', 'character-message', 'training-calorie')
  ),
  constraint ai_usage_state_active_reservation_check check (
    (active_request_id is null and active_route is null and active_until is null)
    or
    (active_request_id is not null and active_route is not null and active_until is not null)
  )
);

alter table public.ai_usage_state enable row level security;

revoke all on table public.ai_usage_state from public;
revoke all on table public.ai_usage_state from anon;
revoke all on table public.ai_usage_state from authenticated;

create or replace function public.reserve_ai_usage(p_route text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_minute_limit constant integer := 3;
  c_day_limit constant integer := 20;
  c_active_seconds constant integer := 45;
  v_user_id uuid;
  v_now timestamptz := now();
  v_day_key date;
  v_row public.ai_usage_state%rowtype;
  v_minute_window_start timestamptz;
  v_minute_count integer;
  v_day_count integer;
  v_next_midnight timestamptz;
  v_retry_after integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'unauthorized', 'retry_after_seconds', 1);
  end if;

  if p_request_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_request', 'retry_after_seconds', 1);
  end if;

  if p_route is null or p_route not in ('analyze-meal', 'character-message', 'training-calorie') then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_route', 'retry_after_seconds', 1);
  end if;

  v_day_key := (v_now at time zone 'Asia/Tokyo')::date;

  insert into public.ai_usage_state (user_id, minute_window_start, day_key)
  values (v_user_id, v_now, v_day_key)
  on conflict (user_id) do nothing;

  select * into v_row
  from public.ai_usage_state
  where user_id = v_user_id
  for update;

  if v_now - v_row.minute_window_start >= interval '1 minute' then
    v_minute_window_start := v_now;
    v_minute_count := 0;
  else
    v_minute_window_start := v_row.minute_window_start;
    v_minute_count := v_row.minute_count;
  end if;

  if v_row.day_key <> v_day_key then
    v_day_count := 0;
  else
    v_day_count := v_row.day_count;
  end if;

  if v_row.active_until is not null and v_row.active_until > v_now then
    update public.ai_usage_state
    set minute_window_start = v_minute_window_start,
        minute_count = v_minute_count,
        day_key = v_day_key,
        day_count = v_day_count,
        updated_at = v_now
    where user_id = v_user_id;

    v_retry_after := greatest(1, ceil(extract(epoch from (v_row.active_until - v_now)))::integer);
    return jsonb_build_object('allowed', false, 'reason', 'concurrent', 'retry_after_seconds', v_retry_after);
  end if;

  if v_minute_count >= c_minute_limit then
    update public.ai_usage_state
    set minute_window_start = v_minute_window_start,
        minute_count = v_minute_count,
        day_key = v_day_key,
        day_count = v_day_count,
        updated_at = v_now
    where user_id = v_user_id;

    v_retry_after := greatest(1, ceil(extract(epoch from (v_minute_window_start + interval '1 minute' - v_now)))::integer);
    return jsonb_build_object('allowed', false, 'reason', 'minute_limit', 'retry_after_seconds', v_retry_after);
  end if;

  if v_day_count >= c_day_limit then
    update public.ai_usage_state
    set minute_window_start = v_minute_window_start,
        minute_count = v_minute_count,
        day_key = v_day_key,
        day_count = v_day_count,
        updated_at = v_now
    where user_id = v_user_id;

    v_next_midnight := (v_day_key + 1)::timestamp at time zone 'Asia/Tokyo';
    v_retry_after := least(86400, greatest(1, ceil(extract(epoch from (v_next_midnight - v_now)))::integer));
    return jsonb_build_object('allowed', false, 'reason', 'day_limit', 'retry_after_seconds', v_retry_after);
  end if;

  update public.ai_usage_state
  set minute_window_start = v_minute_window_start,
      minute_count = v_minute_count + 1,
      day_key = v_day_key,
      day_count = v_day_count + 1,
      active_request_id = p_request_id,
      active_route = p_route,
      active_until = v_now + make_interval(secs => c_active_seconds),
      total_count = v_row.total_count + 1,
      last_route = p_route,
      last_used_at = v_now,
      updated_at = v_now
  where user_id = v_user_id;

  return jsonb_build_object('allowed', true, 'reason', 'ok', 'retry_after_seconds', 0);
end;
$$;

revoke all on function public.reserve_ai_usage(text, uuid) from public;
revoke all on function public.reserve_ai_usage(text, uuid) from anon;
grant execute on function public.reserve_ai_usage(text, uuid) to authenticated;

create or replace function public.release_ai_usage(p_route text, p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_updated integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return false;
  end if;

  if p_request_id is null or p_route is null then
    return false;
  end if;

  update public.ai_usage_state
  set active_request_id = null,
      active_route = null,
      active_until = null,
      updated_at = now()
  where user_id = v_user_id
    and active_request_id = p_request_id
    and active_route = p_route;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.release_ai_usage(text, uuid) from public;
revoke all on function public.release_ai_usage(text, uuid) from anon;
grant execute on function public.release_ai_usage(text, uuid) to authenticated;
