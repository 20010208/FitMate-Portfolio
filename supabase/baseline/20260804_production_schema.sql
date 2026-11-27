-- FitMate Supabase schema baseline artifact — fresh Supabase project only.
--
-- ============================================================================
-- DO NOT APPLY THIS FILE TO THE EXISTING FITMATE PRODUCTION PROJECT.
-- ============================================================================
-- This file reconstructs, in one pass, the exact object set confirmed present
-- in Production as of 2026-08-04 (public tables, RLS, policies, functions,
-- triggers, grants, and the meal-photos Storage object policies). It exists
-- solely so a brand-new Supabase project (a from-scratch dev/staging/DR
-- environment) can be bootstrapped to the same shape as Production in one
-- step, without replaying `supabase/migrations/` history on a database that
-- never had it.
--
-- This file is NOT a versioned migration and is never applied by the normal
-- migration pipeline (it does not live under `supabase/migrations/`, and its
-- filename intentionally does not match that pipeline's naming convention).
-- The existing FitMate Production project already has every object below —
-- running this against it would hit "already exists" errors on the (few)
-- non-idempotent statements and, more importantly, is simply the wrong tool:
-- Production's forward-only history lives in `supabase/migrations/`
-- (202607230001 / 202607240001 / 202607240002, plus the convergence and
-- privilege-hardening migrations that accompany this baseline). Only that
-- migration history is the source of truth for the existing project.
--
-- Scope explicitly excluded from this file (by design, per the same
-- least-privilege / minimal-blast-radius principle used throughout this
-- repo's migrations):
--   - No CREATE for any Storage system table (storage.buckets,
--     storage.objects, storage.migrations, etc.) — those are created and
--     owned by the Supabase platform itself when Storage is provisioned.
--   - No INSERT/UPDATE against storage.buckets. Bucket existence
--     (blog-images, character-images, meal-photos, Shop_logo) is never
--     created via SQL; a fresh bucket must be created via the Supabase
--     Dashboard Storage UI or the formal Storage API's bucket-creation
--     call (see docs/database/SCHEMA_MIGRATION_RUNBOOK.md §3.1 for the
--     fresh-bootstrap sequence). `scripts/manage-meal-photos-bucket.mjs`
--     cannot create a bucket — it only calls the Storage API's
--     `getBucket`/`updateBucket` operations, so it is usable only *after*
--     a bucket already exists, to inspect or update its
--     public/private flag, file_size_limit, and allowed_mime_types. This
--     file only recreates the `storage.objects` RLS policies that scope
--     access to the `meal-photos` bucket's own-folder-only convention; the
--     bucket row itself must already exist (created and configured
--     out-of-band, before this file is applied) for those policies to be
--     meaningful.
--   - No CREATE for `auth.users` or any other `auth.*` object — those are
--     owned and managed by Supabase Auth.
--   - No `CREATE EXTENSION` statements. `gen_random_uuid()` is available on
--     every Supabase project by default (pgcrypto is pre-enabled by the
--     platform); extension management is treated as a Supabase-platform
--     concern, not something this repo's SQL should assume control over.
--
-- Execution order matters and is preserved top-to-bottom in this file:
-- tables and indexes first, then RLS + policies, then functions, then
-- triggers (which reference the functions just created), then function
-- grants, then the meal-photos Storage object policies, then future default
-- privilege hardening last. Every DDL statement below is written to be safe
-- to run once against a genuinely empty `public` schema; it is not re-run
-- against Production and therefore does not need the IF NOT EXISTS /
-- catalog-check idempotency that the accompanying convergence migration
-- requires.
--
-- The entire file is wrapped in a single explicit transaction (`begin;` /
-- `commit;` below) so that a failure partway through — e.g. against a
-- project that turns out not to be genuinely empty — leaves no partially
-- applied schema behind; every statement here is ordinary transactional DDL
-- (no CREATE INDEX CONCURRENTLY, no Storage bucket INSERT/UPDATE, no
-- Supabase-internal schema CREATE, all of which are excluded by design per
-- the scope notes above and would either be non-transactional or
-- out-of-bounds for this file).

begin;

-- ============================================================================
-- 1. Tables
-- ============================================================================

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  name text default '',
  birthday text default null,
  height text default '',
  goal_weight text default '',
  created_at timestamptz default now(),
  gender text,
  target_days integer,
  target_date date,
  nickname text,
  character text,
  fitness_goal text,
  constraint profiles_gender_check check (gender is null or gender in ('male', 'female')),
  constraint profiles_character_check check (character is null or character in ('leo', 'mina', 'saya')),
  constraint profiles_fitness_goal_check check (
    fitness_goal is null or fitness_goal in ('gain_muscle', 'lose_weight', 'maintain')
  )
);

create table public.trainings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  date_id text not null,
  category text not null,
  exercise text not null,
  sets jsonb not null default '[]',
  created_at timestamptz default now(),
  memo text default ''
);

create table public.weight_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  date_id text not null,
  weight text default '',
  body_fat text default '',
  created_at timestamptz default now(),
  unique (user_id, date_id)
);

create table public.meal_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  date_id text not null,
  category text not null,
  items jsonb not null default '[]',
  did_not_eat boolean default false,
  created_at timestamptz default now(),
  photo_url text,
  unique (user_id, date_id, category)
);

create table public.step_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  date_id text not null,
  steps integer not null,
  created_at timestamptz default now(),
  unique (user_id, date_id)
);

create table public.food_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text not null default 'セブンイレブン',
  category text default '',
  amount text default '',
  calorie text default '',
  protein text default '',
  fat text default '',
  carbohydrate text default '',
  created_at timestamptz default now(),
  reading text
);

create table public.blogs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null,
  category text not null,
  published_at date not null,
  reading_minutes integer not null default 5,
  content text not null,
  og_image text,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.ai_usage_state (
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

-- ============================================================================
-- 2. Application indexes
-- ============================================================================

create index trainings_user_date on public.trainings(user_id, date_id);
create index weight_user_date on public.weight_records(user_id, date_id);
create index meal_user_date on public.meal_logs(user_id, date_id);

-- ============================================================================
-- 3. Row Level Security
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.trainings enable row level security;
alter table public.weight_records enable row level security;
alter table public.meal_logs enable row level security;
alter table public.step_logs enable row level security;
alter table public.food_items enable row level security;
alter table public.blogs enable row level security;
alter table public.ai_usage_state enable row level security;

create policy "profiles: own data" on public.profiles
  for all using (auth.uid() = user_id);

create policy "trainings: own data" on public.trainings
  for all using (auth.uid() = user_id);

create policy "weight_records: own data" on public.weight_records
  for all using (auth.uid() = user_id);

create policy "meal_logs: own data" on public.meal_logs
  for all using (auth.uid() = user_id);

create policy "Users can manage own step logs" on public.step_logs
  for all using (auth.uid() = user_id);

create policy "public_read_food_items" on public.food_items
  for select to public using (true);

create policy "public read published" on public.blogs
  for select to public using (is_published = true);

-- ai_usage_state: RLS enabled with zero policies on purpose. The only
-- reachable path is the two SECURITY DEFINER functions below; direct table
-- access is revoked from every role that can otherwise reach it (section 6).

-- ============================================================================
-- 4. Functions
-- ============================================================================

create or replace function public.get_brand_categories(brand_name text)
returns table(category text)
language sql
volatile
called on null input
security invoker
parallel unsafe
set search_path = ''
as $$
  SELECT DISTINCT category
  FROM public.food_items
  WHERE brand = brand_name
    AND category IS NOT NULL
    AND category != ''
  ORDER BY category;
$$;

create or replace function public.kata_to_hira(t text)
returns text
language plpgsql
immutable
called on null input
security invoker
parallel unsafe
set search_path = ''
as $$
DECLARE
  result text := '';
  i integer;
  code integer;
BEGIN
  FOR i IN 1..length(t) LOOP
    code := ascii(substring(t FROM i FOR 1));
    IF code >= 12449 AND code <= 12534 THEN
      result := result || chr(code - 96);
    ELSE
      result := result || substring(t FROM i FOR 1);
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

create or replace function public.set_food_item_reading()
returns trigger
language plpgsql
volatile
called on null input
security invoker
parallel unsafe
set search_path = ''
as $$
BEGIN
  IF NEW.reading IS NULL THEN
    NEW.reading := public.kata_to_hira(NEW.name);
  END IF;
  RETURN NEW;
END;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
volatile
called on null input
security definer
parallel unsafe
set search_path = ''
as $$
begin
  insert into public.profiles (user_id)
  values (new.id);
  return new;
end;
$$;

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

-- ============================================================================
-- 5. Triggers (reference the functions created in section 4)
-- ============================================================================

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create trigger food_items_reading_trigger
  before insert or update on public.food_items
  for each row execute function public.set_food_item_reading();

-- ============================================================================
-- 6. Grants — final least-privilege state (baseline bakes in the same
--    end-state that the existing Production project reaches only after the
--    privilege-hardening migration is applied there; a fresh project starts
--    here directly).
-- ============================================================================

-- ai_usage_state: no role may touch the table directly; only the two
-- SECURITY DEFINER functions above may read/write it.
revoke all on table public.ai_usage_state from public;
revoke all on table public.ai_usage_state from anon;
revoke all on table public.ai_usage_state from authenticated;

revoke all on function public.reserve_ai_usage(text, uuid) from public;
revoke all on function public.reserve_ai_usage(text, uuid) from anon;
grant execute on function public.reserve_ai_usage(text, uuid) to authenticated;

revoke all on function public.release_ai_usage(text, uuid) from public;
revoke all on function public.release_ai_usage(text, uuid) from anon;
grant execute on function public.release_ai_usage(text, uuid) to authenticated;

-- handle_new_user: trigger-only. Direct EXECUTE is not needed for the
-- on_auth_user_created trigger to fire (trigger invocation does not go
-- through the caller's direct-call EXECUTE privilege check).
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;

-- set_food_item_reading: trigger-only, same reasoning as handle_new_user.
-- No client code calls this directly (confirmed: only food_items_reading_trigger
-- invokes it), so the direct-call EXECUTE grant serves no legitimate purpose.
revoke execute on function public.set_food_item_reading() from public;
revoke execute on function public.set_food_item_reading() from anon;
revoke execute on function public.set_food_item_reading() from authenticated;

-- get_brand_categories: called directly via supabase.rpc() from
-- FoodSearchClient.tsx against public, non-user-owned food master data.
-- Kept publicly callable on purpose.
grant execute on function public.get_brand_categories(text) to anon;
grant execute on function public.get_brand_categories(text) to authenticated;

-- kata_to_hira: Production currently leaves this callable by anon/authenticated.
-- This baseline intentionally mirrors that current state rather than silently
-- tightening it — see docs/database/SCHEMA_MIGRATION_RUNBOOK.md and the
-- privilege-hardening migration's own comments for why this one function is
-- deliberately left unchanged this round.
grant execute on function public.kata_to_hira(text) to anon;
grant execute on function public.kata_to_hira(text) to authenticated;

-- blogs: least-privilege final state. anon/authenticated may only read
-- published rows (enforced by RLS above); no client role may write. Only
-- service_role (which is unaffected by these REVOKE statements and is not
-- named below) writes via scripts/generate-article.mjs.
revoke insert, update, delete, truncate on table public.blogs from anon, authenticated;
grant select on table public.blogs to anon, authenticated;

-- ============================================================================
-- 7. Storage — meal-photos object policies only (bucket row itself is
--    provisioned separately; see section header note above).
-- ============================================================================

drop policy if exists "meal-photos select" on storage.objects;
create policy "meal-photos select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'meal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "meal-photos insert" on storage.objects;
create policy "meal-photos insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'meal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "meal-photos delete" on storage.objects;
create policy "meal-photos delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'meal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ============================================================================
-- 8. Future default privileges — same least-privilege end-state that
--    202608040002_harden_database_privileges.sql establishes for the
--    existing Production project, applied here directly so a fresh project
--    starts in that state rather than reaching it only after a follow-up
--    migration. Object creator is pinned to role `postgres`, matching the
--    role Supabase's migration/SQL-apply pipeline runs as; this only affects
--    functions created *after* this point *by that same role* — it does not
--    and cannot retroactively change the grants of the functions created
--    earlier in this same file (those are set explicitly in section 6).
--
--    The **global** REVOKE (no `IN SCHEMA` clause) is the central hardening
--    action here — it removes PostgreSQL's built-in default of granting
--    EXECUTE on new functions to PUBLIC. Per PostgreSQL's documented
--    behavior, schema-specific default privileges are added to whatever the
--    global default privileges are — they do not replace or take
--    precedence over the global setting, and a schema-specific REVOKE
--    cannot cancel or "deny" a privilege a global GRANT separately confers.
--    The **schema-specific** REVOKE (`IN SCHEMA public`) below is an
--    auxiliary, convergence-only statement that mirrors 202608040002 (it
--    removes the same kind of already-existing, explicit schema-specific
--    default ACL entry that migration's own comment documents finding in
--    Production; on a fresh project there may be no such entry yet, so this
--    statement is a no-op there, but is still issued to keep this
--    baseline's end-state identical to Production's) — it is not a second,
--    symmetric line of defense against some hypothetical future global
--    GRANT. See 202608040002's own comment for the full reasoning. Neither
--    statement touches service_role or any already-created function's
--    grants.
--
--    Consequence for future work on this schema: after this point, any new
--    function meant to be called directly by anon/authenticated (the way
--    get_brand_categories is here) needs its own explicit
--    `grant execute on function ... to anon, authenticated;` next to its
--    CREATE FUNCTION — it is no longer granted implicitly.
-- ============================================================================

alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

commit;
