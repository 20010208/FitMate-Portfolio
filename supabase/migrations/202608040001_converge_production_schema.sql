-- Converges the versioned migration history with the current Production
-- schema state (confirmed 2026-08-04 via read-only Production metadata:
-- table/column/constraint/policy/trigger definitions supplied directly by
-- the user, not queried by this session). Production already has every
-- object this migration touches; nothing here is expected to change
-- Production's effective behavior. Its job is purely to make the existing,
-- already-safe state reproducible from `supabase/migrations/` alone.
--
-- This migration deliberately does NOT use "CREATE TABLE IF NOT EXISTS" (or
-- ALTER/CREATE POLICY) as its only safety net. For every object already
-- confirmed present in Production, this file verifies the object's actual
-- catalog definition before deciding whether to add, leave alone, or raise
-- an exception:
--   - table/column: compared via information_schema.columns
--     (data_type / is_nullable), added only if the column is entirely
--     absent; RAISE EXCEPTION if present with an unexpected type/nullability
--     (this migration never silently ALTERs an existing column).
--   - PRIMARY KEY / UNIQUE / FOREIGN KEY: looked up structurally via
--     pg_constraint (constraint kind + the exact column set involved, or —
--     for the FK — the target table and ON DELETE action), never by
--     assuming a specific constraint name, since Production's actual
--     constraint names were not confirmed in the source metadata for this
--     migration. Missing constraints are added; a constraint that exists on
--     the right columns but with the wrong shape (e.g. FK without CASCADE)
--     raises an exception rather than being silently altered.
--   - CHECK constraints (profiles.gender/character/fitness_goal): looked up
--     by which column they reference (via pg_attribute + conkey), not by
--     name, and verified loosely (their pg_get_constraintdef() text must
--     mention every expected literal value) rather than by exact string
--     equality — Postgres's internal re-printing of a CHECK expression is
--     not something this migration can predict without a live database to
--     test against, so an exact-string comparison would risk a false
--     "convergence: differs" failure against a constraint that is actually
--     correct. A constraint that exists on the right column but clearly
--     does not reference the expected literals raises an exception.
--   - RLS enable: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is idempotent
--     in PostgreSQL (a no-op if already enabled), so it is simply re-issued
--     for every table this migration touches.
--   - Policies: rather than attempting a fragile semantic comparison of a
--     policy's USING/WITH CHECK expression text (which can differ in
--     harmless ways — implicit casts, operand order — that a naive string
--     compare would misreport as "different"), every policy this migration
--     is responsible for is unconditionally normalized via
--     `DROP POLICY IF EXISTS` + `CREATE POLICY` using the exact definition
--     confirmed against Production. Both statements run inside this
--     migration's single transaction, so no external observer can ever see
--     the brief "policy absent" intermediate state.
--   - Trigger (food_items_reading_trigger): looked up via pg_trigger by
--     (tgrelid, tgisinternal = false), verified loosely via
--     pg_get_triggerdef() containing the expected function name and timing
--     keywords, added only if entirely absent.
--
-- Explicitly out of scope for this migration (left untouched, per the
-- confirmed-safe Production state and the task's own instructions):
--   - ai_usage_state and its two RPCs (already fully versioned by
--     202607230001; not touched here).
--   - get_brand_categories / kata_to_hira / handle_new_user / set_food_item_reading
--     function bodies and grants (already versioned by 202607240002 for the
--     bodies; grants are handled by 202608040002, not this file).
--   - blogs table/column/index privileges — this migration only converges
--     blogs' schema, RLS enable, and its published-only SELECT policy.
--     Table-level GRANT/REVOKE for blogs is 202608040002's responsibility.
--   - storage.buckets is never written by this migration (no UPDATE/INSERT).
--     The bucket's public flag and file_size_limit are only read-only
--     asserted below as a sanity check, matching the confirmed Production
--     values; a mismatch raises an exception rather than being corrected
--     here, since correcting it is an out-of-band Storage API operation
--     (scripts/manage-meal-photos-bucket.mjs), not something this SQL
--     migration is allowed to perform.
--
-- Codex follow-up fixes applied 2026-08-04 (round 2, recommended items):
--   - UNIQUE/PRIMARY KEY column-set comparisons now cast both sides to
--     text[] explicitly, removing the information_schema.sql_identifier[]
--     vs text[] type-ambiguity the first round left unresolved.
--   - profiles' 3 CHECK constraints are now verified by extracting the
--     *complete* set of literal values from pg_get_constraintdef() and
--     comparing it for exact equality against the expected set (rejecting
--     both missing and extra values), plus a convalidated check; previously
--     this only checked that each expected literal appeared somewhere in
--     the text, which would have wrongly accepted an over-broad constraint.
--   - step_logs and blogs now verify every confirmed Production column
--     (previously only 3 and 3 of their respective 5 and 11 columns) plus
--     an explicit structural PRIMARY KEY(id) check for both tables.
--   - food_items_reading_trigger verification now checks tgfoid via
--     ::regprocedure, tgenabled, absence of DELETE/TRUNCATE/WHEN, and
--     duplicate-trigger detection, in addition to the existing text checks.

begin;

-- ============================================================================
-- 1. profiles: converge the 6 additive columns and their CHECK constraints.
--    All 6 columns are nullable in Production; adding a nullable column with
--    no default is a fast, table-rewrite-free operation.
-- ============================================================================

do $$
declare
  v_data_type text;
  v_is_nullable text;
begin
  -- gender text, nullable
  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles' and column_name = 'gender';
  if not found then
    alter table public.profiles add column gender text;
  elsif v_data_type <> 'text' or v_is_nullable <> 'YES' then
    raise exception 'convergence: public.profiles.gender has unexpected definition (data_type=%, is_nullable=%)', v_data_type, v_is_nullable;
  end if;

  -- target_days integer, nullable
  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles' and column_name = 'target_days';
  if not found then
    alter table public.profiles add column target_days integer;
  elsif v_data_type <> 'integer' or v_is_nullable <> 'YES' then
    raise exception 'convergence: public.profiles.target_days has unexpected definition (data_type=%, is_nullable=%)', v_data_type, v_is_nullable;
  end if;

  -- target_date date, nullable
  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles' and column_name = 'target_date';
  if not found then
    alter table public.profiles add column target_date date;
  elsif v_data_type <> 'date' or v_is_nullable <> 'YES' then
    raise exception 'convergence: public.profiles.target_date has unexpected definition (data_type=%, is_nullable=%)', v_data_type, v_is_nullable;
  end if;

  -- nickname text, nullable
  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles' and column_name = 'nickname';
  if not found then
    alter table public.profiles add column nickname text;
  elsif v_data_type <> 'text' or v_is_nullable <> 'YES' then
    raise exception 'convergence: public.profiles.nickname has unexpected definition (data_type=%, is_nullable=%)', v_data_type, v_is_nullable;
  end if;

  -- character text, nullable
  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles' and column_name = 'character';
  if not found then
    alter table public.profiles add column character text;
  elsif v_data_type <> 'text' or v_is_nullable <> 'YES' then
    raise exception 'convergence: public.profiles.character has unexpected definition (data_type=%, is_nullable=%)', v_data_type, v_is_nullable;
  end if;

  -- fitness_goal text, nullable
  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles' and column_name = 'fitness_goal';
  if not found then
    alter table public.profiles add column fitness_goal text;
  elsif v_data_type <> 'text' or v_is_nullable <> 'YES' then
    raise exception 'convergence: public.profiles.fitness_goal has unexpected definition (data_type=%, is_nullable=%)', v_data_type, v_is_nullable;
  end if;
end $$;

-- CHECK constraints, looked up by which column they reference (not by
-- assumed name). See header note on why an exact pg_get_constraintdef()
-- string comparison is intentionally avoided here.

-- Codex follow-up fix: a naive "does the definition text contain each
-- expected literal as a substring" check would wrongly accept a broader
-- constraint (e.g. gender IN ('male','female','other')) as correct, since it
-- also contains the two expected substrings. Every CHECK verification below
-- instead extracts the *complete* set of single-quoted literals out of
-- pg_get_constraintdef()'s output via regexp_matches() and compares that set
-- for exact equality (sorted, deduplicated by array equality) against the
-- expected allowed-values set — this rejects both a too-narrow constraint
-- (missing an expected value) and a too-broad one (an unexpected extra
-- value), without depending on the exact surrounding operator syntax
-- (IN vs = ANY(ARRAY[...]), explicit ::text casts, parenthesization) that
-- Postgres's internal expression printer may use and that this migration
-- has no live database to confirm ahead of time.

do $$
declare
  v_col_num smallint;
  v_conname name;
  v_condef text;
  v_convalidated boolean;
  v_match_count integer := 0;
  v_literals text[];
  v_expected text[] := array['female', 'male'];
begin
  select attnum into v_col_num
  from pg_attribute
  where attrelid = 'public.profiles'::regclass and attname = 'gender' and not attisdropped;

  for v_conname, v_condef, v_convalidated in
    select c.conname, pg_get_constraintdef(c.oid), c.convalidated
    from pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.contype = 'c'
      and v_col_num = any(c.conkey)
  loop
    v_match_count := v_match_count + 1;
    select array_agg(distinct m[1] order by m[1]) into v_literals
    from regexp_matches(v_condef, $re$'([^']*)'$re$, 'g') as m;

    if v_literals is distinct from v_expected then
      raise exception 'convergence: public.profiles has an existing CHECK constraint % on column gender whose allowed values % do not exactly match the expected set %: %', v_conname, v_literals, v_expected, v_condef;
    end if;
    if not v_convalidated then
      execute format('alter table public.profiles validate constraint %I', v_conname);
    end if;
  end loop;

  if v_match_count = 0 then
    alter table public.profiles
      add constraint profiles_gender_check
      check (gender is null or gender in ('male', 'female')) not valid;
    alter table public.profiles validate constraint profiles_gender_check;
  elsif v_match_count > 1 then
    raise exception 'convergence: public.profiles has % CHECK constraints on column gender, expected at most 1', v_match_count;
  end if;
end $$;

do $$
declare
  v_col_num smallint;
  v_conname name;
  v_condef text;
  v_convalidated boolean;
  v_match_count integer := 0;
  v_literals text[];
  v_expected text[] := array['leo', 'mina', 'saya'];
begin
  select attnum into v_col_num
  from pg_attribute
  where attrelid = 'public.profiles'::regclass and attname = 'character' and not attisdropped;

  for v_conname, v_condef, v_convalidated in
    select c.conname, pg_get_constraintdef(c.oid), c.convalidated
    from pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.contype = 'c'
      and v_col_num = any(c.conkey)
  loop
    v_match_count := v_match_count + 1;
    select array_agg(distinct m[1] order by m[1]) into v_literals
    from regexp_matches(v_condef, $re$'([^']*)'$re$, 'g') as m;

    if v_literals is distinct from v_expected then
      raise exception 'convergence: public.profiles has an existing CHECK constraint % on column character whose allowed values % do not exactly match the expected set %: %', v_conname, v_literals, v_expected, v_condef;
    end if;
    if not v_convalidated then
      execute format('alter table public.profiles validate constraint %I', v_conname);
    end if;
  end loop;

  if v_match_count = 0 then
    alter table public.profiles
      add constraint profiles_character_check
      check (character is null or character in ('leo', 'mina', 'saya')) not valid;
    alter table public.profiles validate constraint profiles_character_check;
  elsif v_match_count > 1 then
    raise exception 'convergence: public.profiles has % CHECK constraints on column character, expected at most 1', v_match_count;
  end if;
end $$;

do $$
declare
  v_col_num smallint;
  v_conname name;
  v_condef text;
  v_convalidated boolean;
  v_match_count integer := 0;
  v_literals text[];
  v_expected text[] := array['gain_muscle', 'lose_weight', 'maintain'];
begin
  select attnum into v_col_num
  from pg_attribute
  where attrelid = 'public.profiles'::regclass and attname = 'fitness_goal' and not attisdropped;

  for v_conname, v_condef, v_convalidated in
    select c.conname, pg_get_constraintdef(c.oid), c.convalidated
    from pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.contype = 'c'
      and v_col_num = any(c.conkey)
  loop
    v_match_count := v_match_count + 1;
    select array_agg(distinct m[1] order by m[1]) into v_literals
    from regexp_matches(v_condef, $re$'([^']*)'$re$, 'g') as m;

    if v_literals is distinct from v_expected then
      raise exception 'convergence: public.profiles has an existing CHECK constraint % on column fitness_goal whose allowed values % do not exactly match the expected set %: %', v_conname, v_literals, v_expected, v_condef;
    end if;
    if not v_convalidated then
      execute format('alter table public.profiles validate constraint %I', v_conname);
    end if;
  end loop;

  if v_match_count = 0 then
    alter table public.profiles
      add constraint profiles_fitness_goal_check
      check (fitness_goal is null or fitness_goal in ('gain_muscle', 'lose_weight', 'maintain')) not valid;
    alter table public.profiles validate constraint profiles_fitness_goal_check;
  elsif v_match_count > 1 then
    raise exception 'convergence: public.profiles has % CHECK constraints on column fitness_goal, expected at most 1', v_match_count;
  end if;
end $$;

-- ============================================================================
-- 2. step_logs: converge table/columns/constraints/RLS/policy. user_id stays
--    nullable — Production's current shape is preserved as-is, not changed.
-- ============================================================================

create table if not exists public.step_logs (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid,
  date_id text not null,
  steps integer not null,
  created_at timestamptz default now()
);

do $$
declare
  v_data_type text;
  v_is_nullable text;
  v_col_default text;
begin
  select data_type, is_nullable, column_default into v_data_type, v_is_nullable, v_col_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'step_logs' and column_name = 'id';
  if not found or v_data_type <> 'uuid' or v_is_nullable <> 'NO' or v_col_default is distinct from 'gen_random_uuid()' then
    raise exception 'convergence: public.step_logs.id has unexpected definition (data_type=%, is_nullable=%, default=%)', v_data_type, v_is_nullable, v_col_default;
  end if;

  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'step_logs' and column_name = 'user_id';
  if not found then
    raise exception 'convergence: public.step_logs.user_id is unexpectedly absent after create table if not exists';
  elsif v_data_type <> 'uuid' or v_is_nullable <> 'YES' then
    raise exception 'convergence: public.step_logs.user_id has unexpected definition (data_type=%, is_nullable=%); this migration never changes its nullability', v_data_type, v_is_nullable;
  end if;

  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'step_logs' and column_name = 'date_id';
  if not found or v_data_type <> 'text' or v_is_nullable <> 'NO' then
    raise exception 'convergence: public.step_logs.date_id has unexpected definition (data_type=%, is_nullable=%)', v_data_type, v_is_nullable;
  end if;

  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'step_logs' and column_name = 'steps';
  if not found or v_data_type <> 'integer' or v_is_nullable <> 'NO' then
    raise exception 'convergence: public.step_logs.steps has unexpected definition (data_type=%, is_nullable=%)', v_data_type, v_is_nullable;
  end if;

  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'step_logs' and column_name = 'created_at';
  if not found or v_data_type <> 'timestamp with time zone' or v_is_nullable <> 'YES' then
    raise exception 'convergence: public.step_logs.created_at has unexpected definition (data_type=%, is_nullable=%)', v_data_type, v_is_nullable;
  end if;
end $$;

-- PRIMARY KEY(id): looked up structurally (constraint_type = 'PRIMARY KEY'
-- covering exactly the `id` column), not by assumed name. Added only if
-- entirely absent; if present on a different column set this raises rather
-- than being altered. If existing rows have duplicate/null `id` values, the
-- ADD CONSTRAINT below fails naturally and this migration's enclosing
-- transaction rolls back in full (no partial state is left behind).
do $$
declare
  v_pk_count integer;
begin
  select count(*) into v_pk_count
  from (
    select tc.constraint_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    where tc.table_schema = 'public' and tc.table_name = 'step_logs' and tc.constraint_type = 'PRIMARY KEY'
    group by tc.constraint_name
    having array_agg(kcu.column_name::text order by kcu.column_name::text) = array['id']::text[]
  ) matched;

  if v_pk_count = 0 then
    if exists (
      select 1 from information_schema.table_constraints
      where table_schema = 'public' and table_name = 'step_logs' and constraint_type = 'PRIMARY KEY'
    ) then
      raise exception 'convergence: public.step_logs has a PRIMARY KEY that does not cover exactly column id';
    end if;
    alter table public.step_logs add constraint step_logs_pkey primary key (id);
  end if;
end $$;

-- FOREIGN KEY user_id -> auth.users(id) ON DELETE CASCADE, looked up
-- structurally (target table + delete action), not by assumed name.
do $$
declare
  v_col_num smallint;
  v_fk_count integer;
  v_bad_fk_count integer;
begin
  select attnum into v_col_num
  from pg_attribute
  where attrelid = 'public.step_logs'::regclass and attname = 'user_id' and not attisdropped;

  select count(*) into v_fk_count
  from pg_constraint c
  where c.conrelid = 'public.step_logs'::regclass
    and c.contype = 'f'
    and c.confrelid = 'auth.users'::regclass
    and array[v_col_num] = c.conkey;

  select count(*) into v_bad_fk_count
  from pg_constraint c
  where c.conrelid = 'public.step_logs'::regclass
    and c.contype = 'f'
    and c.confrelid = 'auth.users'::regclass
    and array[v_col_num] = c.conkey
    and c.confdeltype <> 'c';

  if v_bad_fk_count > 0 then
    raise exception 'convergence: public.step_logs has a user_id -> auth.users foreign key without ON DELETE CASCADE';
  elsif v_fk_count = 0 then
    alter table public.step_logs
      add constraint step_logs_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- UNIQUE (user_id, date_id), looked up by the exact column set involved.
do $$
declare
  v_unique_count integer;
begin
  select count(*) into v_unique_count
  from (
    select tc.constraint_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    where tc.table_schema = 'public' and tc.table_name = 'step_logs' and tc.constraint_type = 'UNIQUE'
    group by tc.constraint_name
    having array_agg(kcu.column_name::text order by kcu.column_name::text) = array['date_id', 'user_id']::text[]
  ) matched;

  if v_unique_count = 0 then
    alter table public.step_logs add constraint step_logs_user_id_date_id_key unique (user_id, date_id);
  end if;
end $$;

alter table public.step_logs enable row level security;

drop policy if exists "Users can manage own step logs" on public.step_logs;
create policy "Users can manage own step logs" on public.step_logs
  for all to public using (auth.uid() = user_id);

-- ============================================================================
-- 3. blogs: converge table/columns/constraints/RLS/published-only SELECT
--    policy. Write privileges are NOT touched here — see 202608040002.
-- ============================================================================

create table if not exists public.blogs (
  id uuid not null default gen_random_uuid() primary key,
  slug text not null,
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

-- Codex follow-up fix: verify all 11 confirmed Production columns (the
-- original version of this migration only checked 3), each via
-- information_schema.columns (data_type / is_nullable / column_default —
-- the same pg_get_expr()-backed representation the catalog itself exposes,
-- so no separate pg_attrdef lookup is needed for a materially different
-- result). Column defaults are compared using PostgreSQL's own normalized
-- text form (e.g. 'true', '5', 'now()', 'gen_random_uuid()'), which is
-- stable for these simple literal/no-arg-function defaults.
do $$
declare
  v_data_type text;
  v_is_nullable text;
  v_col_default text;
begin
  select data_type, is_nullable, column_default into v_data_type, v_is_nullable, v_col_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'blogs' and column_name = 'id';
  if not found or v_data_type <> 'uuid' or v_is_nullable <> 'NO' or v_col_default is distinct from 'gen_random_uuid()' then
    raise exception 'convergence: public.blogs.id has unexpected definition (data_type=%, is_nullable=%, default=%)', v_data_type, v_is_nullable, v_col_default;
  end if;

  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'blogs' and column_name = 'slug';
  if not found or v_data_type <> 'text' or v_is_nullable <> 'NO' then
    raise exception 'convergence: public.blogs.slug has unexpected definition (data_type=%, is_nullable=%)', v_data_type, v_is_nullable;
  end if;

  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'blogs' and column_name = 'title';
  if not found or v_data_type <> 'text' or v_is_nullable <> 'NO' then
    raise exception 'convergence: public.blogs.title has unexpected definition (data_type=%, is_nullable=%)', v_data_type, v_is_nullable;
  end if;

  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'blogs' and column_name = 'description';
  if not found or v_data_type <> 'text' or v_is_nullable <> 'NO' then
    raise exception 'convergence: public.blogs.description has unexpected definition (data_type=%, is_nullable=%)', v_data_type, v_is_nullable;
  end if;

  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'blogs' and column_name = 'category';
  if not found or v_data_type <> 'text' or v_is_nullable <> 'NO' then
    raise exception 'convergence: public.blogs.category has unexpected definition (data_type=%, is_nullable=%)', v_data_type, v_is_nullable;
  end if;

  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'blogs' and column_name = 'published_at';
  if not found or v_data_type <> 'date' or v_is_nullable <> 'NO' then
    raise exception 'convergence: public.blogs.published_at has unexpected definition (data_type=%, is_nullable=%)', v_data_type, v_is_nullable;
  end if;

  select data_type, is_nullable, column_default into v_data_type, v_is_nullable, v_col_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'blogs' and column_name = 'reading_minutes';
  if not found or v_data_type <> 'integer' or v_is_nullable <> 'NO' or v_col_default is distinct from '5' then
    raise exception 'convergence: public.blogs.reading_minutes has unexpected definition (data_type=%, is_nullable=%, default=%)', v_data_type, v_is_nullable, v_col_default;
  end if;

  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'blogs' and column_name = 'content';
  if not found or v_data_type <> 'text' or v_is_nullable <> 'NO' then
    raise exception 'convergence: public.blogs.content has unexpected definition (data_type=%, is_nullable=%)', v_data_type, v_is_nullable;
  end if;

  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'blogs' and column_name = 'og_image';
  if not found or v_data_type <> 'text' or v_is_nullable <> 'YES' then
    raise exception 'convergence: public.blogs.og_image has unexpected definition (data_type=%, is_nullable=%)', v_data_type, v_is_nullable;
  end if;

  select data_type, is_nullable, column_default into v_data_type, v_is_nullable, v_col_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'blogs' and column_name = 'is_published';
  if not found or v_data_type <> 'boolean' or v_is_nullable <> 'NO' or v_col_default is distinct from 'true' then
    raise exception 'convergence: public.blogs.is_published has unexpected definition (data_type=%, is_nullable=%, default=%)', v_data_type, v_is_nullable, v_col_default;
  end if;

  select data_type, is_nullable, column_default into v_data_type, v_is_nullable, v_col_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'blogs' and column_name = 'created_at';
  if not found or v_data_type <> 'timestamp with time zone' or v_is_nullable <> 'NO' or v_col_default is distinct from 'now()' then
    raise exception 'convergence: public.blogs.created_at has unexpected definition (data_type=%, is_nullable=%, default=%)', v_data_type, v_is_nullable, v_col_default;
  end if;
end $$;

do $$
declare
  v_unique_count integer;
begin
  select count(*) into v_unique_count
  from (
    select tc.constraint_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    where tc.table_schema = 'public' and tc.table_name = 'blogs' and tc.constraint_type = 'UNIQUE'
    group by tc.constraint_name
    having array_agg(kcu.column_name::text order by kcu.column_name::text) = array['slug']::text[]
  ) matched;

  if v_unique_count = 0 then
    alter table public.blogs add constraint blogs_slug_key unique (slug);
  end if;
end $$;

-- PRIMARY KEY(id), same structural-lookup pattern as step_logs above.
do $$
declare
  v_pk_count integer;
begin
  select count(*) into v_pk_count
  from (
    select tc.constraint_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    where tc.table_schema = 'public' and tc.table_name = 'blogs' and tc.constraint_type = 'PRIMARY KEY'
    group by tc.constraint_name
    having array_agg(kcu.column_name::text order by kcu.column_name::text) = array['id']::text[]
  ) matched;

  if v_pk_count = 0 then
    if exists (
      select 1 from information_schema.table_constraints
      where table_schema = 'public' and table_name = 'blogs' and constraint_type = 'PRIMARY KEY'
    ) then
      raise exception 'convergence: public.blogs has a PRIMARY KEY that does not cover exactly column id';
    end if;
    alter table public.blogs add constraint blogs_pkey primary key (id);
  end if;
end $$;

alter table public.blogs enable row level security;

drop policy if exists "public read published" on public.blogs;
create policy "public read published" on public.blogs
  for select to public using (is_published = true);

-- ============================================================================
-- 4. food_items: converge the `reading` column and the reading trigger.
--    Function bodies (kata_to_hira / set_food_item_reading) are already
--    versioned by 202607240002 and are reused as-is here.
-- ============================================================================

do $$
declare
  v_data_type text;
  v_is_nullable text;
begin
  select data_type, is_nullable into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'food_items' and column_name = 'reading';
  if not found then
    alter table public.food_items add column reading text;
  elsif v_data_type <> 'text' or v_is_nullable <> 'YES' then
    raise exception 'convergence: public.food_items.reading has unexpected definition (data_type=%, is_nullable=%)', v_data_type, v_is_nullable;
  end if;
end $$;

-- Codex follow-up fix: strengthened beyond the original loose substring
-- check. tgfoid is verified against the exact expected function OID (via
-- ::regprocedure, a stable/documented cast, rather than relying only on the
-- function *name* appearing somewhere in the printed definition), tgenabled
-- is checked directly (a single well-known catalog character value, no
-- guesswork needed), and pg_get_triggerdef()'s text is matched with
-- anchored/negated patterns for BEFORE/INSERT/UPDATE/DELETE/FOR EACH
-- ROW/WHEN rather than loose unanchored substring checks. This migration
-- deliberately does NOT attempt to reconstruct pg_trigger.tgtype's bitmask
-- from memory (TRIGGER_TYPE_ROW/BEFORE/INSERT/UPDATE/... bit values) to
-- avoid asserting on a set of constants that cannot be verified without a
-- live Postgres instance this session — the text-based checks below,
-- combined with the tgfoid/tgenabled catalog-column checks, give equivalent
-- coverage without that risk. A duplicate-trigger check (same table, same
-- function, different name) is also added.
do $$
declare
  v_conname name;
  v_condef text;
  v_tgenabled "char";
  v_duplicate_count integer;
begin
  select t.tgname, pg_get_triggerdef(t.oid), t.tgenabled into v_conname, v_condef, v_tgenabled
  from pg_trigger t
  where t.tgrelid = 'public.food_items'::regclass
    and t.tgname = 'food_items_reading_trigger'
    and not t.tgisinternal
    and t.tgfoid = 'public.set_food_item_reading()'::regprocedure;

  if v_conname is null then
    -- Either entirely absent, or present with the wrong function -- tell
    -- those two cases apart before deciding whether it is safe to create.
    if exists (
      select 1 from pg_trigger t
      where t.tgrelid = 'public.food_items'::regclass
        and t.tgname = 'food_items_reading_trigger'
        and not t.tgisinternal
    ) then
      raise exception 'convergence: public.food_items has a food_items_reading_trigger that does not call public.set_food_item_reading()';
    end if;
    create trigger food_items_reading_trigger
      before insert or update on public.food_items
      for each row execute function public.set_food_item_reading();
  else
    if v_condef !~* 'BEFORE INSERT OR UPDATE' then
      raise exception 'convergence: public.food_items.food_items_reading_trigger is not exactly BEFORE INSERT OR UPDATE: %', v_condef;
    end if;
    if v_condef ~* '\yDELETE\y' or v_condef ~* '\yTRUNCATE\y' then
      raise exception 'convergence: public.food_items.food_items_reading_trigger unexpectedly fires on DELETE/TRUNCATE: %', v_condef;
    end if;
    if v_condef !~* 'FOR EACH ROW' then
      raise exception 'convergence: public.food_items.food_items_reading_trigger is not FOR EACH ROW: %', v_condef;
    end if;
    if v_condef ~* '\yWHEN\s*\(' then
      raise exception 'convergence: public.food_items.food_items_reading_trigger unexpectedly has a WHEN condition: %', v_condef;
    end if;
    if v_tgenabled <> 'O' then
      raise exception 'convergence: public.food_items.food_items_reading_trigger is not in the normal-enabled state (tgenabled=%)', v_tgenabled;
    end if;
  end if;

  select count(*) into v_duplicate_count
  from pg_trigger t
  where t.tgrelid = 'public.food_items'::regclass
    and not t.tgisinternal
    and t.tgfoid = 'public.set_food_item_reading()'::regprocedure;
  if v_duplicate_count > 1 then
    raise exception 'convergence: public.food_items has % triggers calling public.set_food_item_reading(), expected exactly 1', v_duplicate_count;
  end if;
end $$;

-- ============================================================================
-- 5. meal-photos Storage policies: normalize SELECT (already versioned by
--    202607240001, re-asserted/normalized here for consistency), and add
--    the not-yet-versioned INSERT/DELETE policies.
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

-- Read-only sanity check against the confirmed Production bucket
-- configuration. Never writes to storage.buckets — a mismatch here means
-- the bucket was reconfigured out-of-band since this migration was written,
-- and must be investigated (via scripts/manage-meal-photos-bucket.mjs /
-- the Storage API), not silently corrected by this SQL migration.
do $$
declare
  v_public boolean;
  v_file_size_limit bigint;
begin
  select public, file_size_limit into v_public, v_file_size_limit
  from storage.buckets
  where id = 'meal-photos';

  if not found then
    raise exception 'convergence: storage bucket meal-photos not found; this migration does not create Storage buckets';
  end if;
  if v_public is distinct from false then
    raise exception 'convergence: storage bucket meal-photos.public is % (expected false); this migration never modifies bucket settings, investigate out-of-band', v_public;
  end if;
  if v_file_size_limit is distinct from 2097152 then
    raise exception 'convergence: storage bucket meal-photos.file_size_limit is % (expected 2097152); this migration never modifies bucket settings, investigate out-of-band', v_file_size_limit;
  end if;
end $$;

commit;
