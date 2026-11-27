import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Static source checks only, matching this repository's migration-test
// convention. This migration has never been applied to any database this
// session (no runtime Postgres environment is available) — these tests
// verify the migration's *text* (statement shape, scope, fail-closed
// guards, transaction wrapping) rather than its actual effect on a live
// catalog, which requires the Preview-environment verification described in
// docs/database/SCHEMA_MIGRATION_RUNBOOK.md.

const migrationPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '202608040001_converge_production_schema.sql'
)
const sql = readFileSync(migrationPath, 'utf8')

function stripLineComments(text) {
  return text
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--')
      return idx === -1 ? line : line.slice(0, idx)
    })
    .join('\n')
}
const code = stripLineComments(sql)
const lowerCode = code.toLowerCase()

// --- transaction wrapping ---------------------------------------------------

test('the entire migration is wrapped in a single explicit transaction (begin ... commit)', () => {
  const beginMatches = [...lowerCode.matchAll(/^\s*begin;\s*$/gm)]
  const commitMatches = [...lowerCode.matchAll(/^\s*commit;\s*$/gm)]
  assert.equal(beginMatches.length, 1)
  assert.equal(commitMatches.length, 1)
  assert.ok(beginMatches[0].index < commitMatches[0].index)
})

test('no CREATE INDEX CONCURRENTLY (non-transactional statement) is used anywhere', () => {
  assert.doesNotMatch(lowerCode, /concurrently/)
})

// --- fail-closed catalog assertions -----------------------------------------

test('at least 8 RAISE EXCEPTION statements exist (one fail-closed guard per converged object family)', () => {
  const matches = [...lowerCode.matchAll(/raise exception/g)]
  assert.ok(matches.length >= 8, `expected at least 8 RAISE EXCEPTION statements, found ${matches.length}`)
})

test('column convergence never silently ALTERs an existing column type/nullability -- every mismatch branch raises, none issues an ALTER COLUMN TYPE or SET/DROP NOT NULL', () => {
  assert.doesNotMatch(lowerCode, /alter column.*type/)
  assert.doesNotMatch(lowerCode, /set not null/)
  assert.doesNotMatch(lowerCode, /drop not null/)
})

test('profiles: all 6 additive columns are checked via information_schema.columns before any ADD COLUMN', () => {
  for (const col of ['gender', 'target_days', 'target_date', 'nickname', 'character', 'fitness_goal']) {
    assert.match(code, new RegExp(`table_name = 'profiles' and column_name = '${col}'`))
  }
})

test('profiles CHECK constraints are looked up by column reference (pg_attribute + conkey), not by an assumed constraint name', () => {
  const checkBlocks = [...code.matchAll(/attname = '(gender|character|fitness_goal)' and not attisdropped/g)]
  assert.equal(checkBlocks.length, 3)
  assert.match(code, /v_col_num = any\(c\.conkey\)/)
})

test('profiles CHECK constraints use NOT VALID followed by a separate VALIDATE CONSTRAINT, never a plain ADD CONSTRAINT', () => {
  const notValidCount = [...lowerCode.matchAll(/\) not valid;/g)].length
  const validateCount = [...lowerCode.matchAll(/validate constraint/g)].length
  assert.equal(notValidCount, 3)
  // 3 static "not-found -> add + validate" branches, plus 3 dynamic
  // "found but not yet validated -> validate" branches (one per CHECK,
  // via `execute format('alter table public.profiles validate constraint %I', ...)`)
  // = 6 total mentions of "validate constraint" in the file.
  assert.equal(validateCount, 6)
})

test('profiles CHECK constraints compare the exact set of allowed literal values (not substring containment), and check convalidated', () => {
  assert.match(code, /regexp_matches\(v_condef, \$re\$'\(\[\^'\]\*\)'\$re\$, 'g'\)/)
  assert.match(code, /v_literals is distinct from v_expected/)
  assert.match(code, /v_expected text\[\] := array\['female', 'male'\]/)
  assert.match(code, /v_expected text\[\] := array\['leo', 'mina', 'saya'\]/)
  assert.match(code, /v_expected text\[\] := array\['gain_muscle', 'lose_weight', 'maintain'\]/)
  assert.match(code, /c\.convalidated/)
  assert.match(code, /if not v_convalidated then/)
})

test('step_logs: table creation uses IF NOT EXISTS and user_id has no NOT NULL (nullable preserved, never converted)', () => {
  const tableMatch = code.match(/create table if not exists public\.step_logs \(([\s\S]*?)\);/)
  assert.ok(tableMatch, 'could not locate step_logs CREATE TABLE IF NOT EXISTS')
  assert.doesNotMatch(tableMatch[1], /user_id uuid[^,]*not null/i)
})

test('step_logs: user_id NOT NULL conversion is explicitly out of scope (no ALTER ... SET NOT NULL on step_logs anywhere)', () => {
  assert.doesNotMatch(lowerCode, /alter table public\.step_logs.*set not null/s)
})

test('step_logs: foreign key is looked up structurally (target table + ON DELETE CASCADE action), not by assumed constraint name', () => {
  assert.match(code, /c\.confrelid = 'auth\.users'::regclass/)
  assert.match(code, /c\.confdeltype <> 'c'/)
})

test('step_logs: UNIQUE(user_id, date_id) is looked up by column set via key_column_usage, not by assumed constraint name', () => {
  assert.match(code, /table_name = 'step_logs' and tc\.constraint_type = 'UNIQUE'/)
  assert.match(code, /array\['date_id', 'user_id'\]/)
})

test('step_logs: UNIQUE and PRIMARY KEY column-set comparisons cast both sides to text[] explicitly (Codex recommended fix: array type ambiguity)', () => {
  assert.match(code, /array_agg\(kcu\.column_name::text order by kcu\.column_name::text\) = array\['date_id', 'user_id'\]::text\[\]/)
  assert.match(code, /array_agg\(kcu\.column_name::text order by kcu\.column_name::text\) = array\['id'\]::text\[\]/)
})

test('step_logs: id and created_at columns are also verified (not just user_id/date_id/steps)', () => {
  assert.match(code, /table_name = 'step_logs' and column_name = 'id'/)
  assert.match(code, /v_col_default is distinct from 'gen_random_uuid\(\)'/)
  assert.match(code, /table_name = 'step_logs' and column_name = 'created_at'/)
})

test('step_logs: PRIMARY KEY(id) is verified structurally, added only if entirely absent, fail-closed if present on different columns', () => {
  assert.match(code, /table_name = 'step_logs' and tc\.constraint_type = 'PRIMARY KEY'/)
  assert.match(code, /add constraint step_logs_pkey primary key \(id\)/)
})

test('step_logs: RLS enabled and the own-data policy is normalized via DROP POLICY IF EXISTS + CREATE POLICY', () => {
  assert.match(lowerCode, /alter table public\.step_logs enable row level security;/)
  assert.match(code, /drop policy if exists "Users can manage own step logs" on public\.step_logs;/)
  assert.match(code, /create policy "Users can manage own step logs" on public\.step_logs\s*\n\s*for all to public using \(auth\.uid\(\) = user_id\);/)
})

test('blogs: table creation uses IF NOT EXISTS, is_published default true is verified (not changed)', () => {
  assert.match(code, /create table if not exists public\.blogs \(/)
  assert.match(code, /column_name = 'is_published'/)
  assert.match(code, /v_col_default is distinct from 'true'/)
})

test('blogs: no write-privilege GRANT/REVOKE statement anywhere in this migration (privilege changes are 202608040002-only)', () => {
  assert.doesNotMatch(lowerCode, /revoke.*on table public\.blogs/)
  assert.doesNotMatch(lowerCode, /grant.*on table public\.blogs/)
})

test('blogs: slug UNIQUE is looked up by column set, RLS enabled, and the published-only SELECT policy is normalized via DROP + CREATE', () => {
  assert.match(code, /table_name = 'blogs' and tc\.constraint_type = 'UNIQUE'/)
  assert.match(code, /array\['slug'\]/)
  assert.match(lowerCode, /alter table public\.blogs enable row level security;/)
  assert.match(code, /drop policy if exists "public read published" on public\.blogs;/)
  assert.match(code, /create policy "public read published" on public\.blogs\s*\n\s*for select to public using \(is_published = true\);/)
})

test('blogs: all 11 confirmed Production columns are individually verified (Codex recommended fix: previously only 3 of 11 were checked)', () => {
  const columns = [
    'id', 'slug', 'title', 'description', 'category', 'published_at',
    'reading_minutes', 'content', 'og_image', 'is_published', 'created_at',
  ]
  for (const col of columns) {
    assert.match(code, new RegExp(`table_name = 'blogs' and column_name = '${col}'`), `blogs.${col} is not verified`)
  }
})

test('blogs: reading_minutes default 5 and created_at default now() are both verified, not just is_published', () => {
  assert.match(code, /v_col_default is distinct from '5'/)
  assert.match(code, /v_col_default is distinct from 'now\(\)'/)
})

test('blogs: PRIMARY KEY(id) is verified structurally, added only if entirely absent, fail-closed if present on different columns', () => {
  assert.match(code, /table_name = 'blogs' and tc\.constraint_type = 'PRIMARY KEY'/)
  assert.match(code, /add constraint blogs_pkey primary key \(id\)/)
})

test('food_items: reading column is added only if absent, never re-defines the function bodies (no CREATE OR REPLACE FUNCTION anywhere in this migration)', () => {
  assert.match(code, /table_name = 'food_items' and column_name = 'reading'/)
  assert.doesNotMatch(lowerCode, /create or replace function/)
})

test('food_items_reading_trigger: looked up via pg_trigger (tgrelid + tgisinternal = false), created only if absent, verified via pg_get_triggerdef', () => {
  assert.match(code, /from pg_trigger t\s*\n\s*where t\.tgrelid = 'public\.food_items'::regclass/)
  assert.match(code, /not t\.tgisinternal/)
  assert.match(code, /pg_get_triggerdef\(t\.oid\)/)
})

test('food_items_reading_trigger: tgfoid is checked against the exact function via ::regprocedure (Codex recommended fix), not just the function name appearing in the printed text', () => {
  const matches = [...code.matchAll(/'public\.set_food_item_reading\(\)'::regprocedure/g)]
  assert.ok(matches.length >= 2, `expected at least 2 ::regprocedure comparisons (lookup + duplicate check), found ${matches.length}`)
})

test('food_items_reading_trigger: tgenabled is checked directly (single catalog char column, no tgtype bitmask reconstruction)', () => {
  assert.match(code, /v_tgenabled "char"/)
  assert.match(code, /t\.tgenabled into v_conname, v_condef, v_tgenabled/)
  assert.match(code, /v_tgenabled <> 'O'/)
})

test('food_items_reading_trigger: verifies DELETE/TRUNCATE are absent, FOR EACH ROW is present, and no WHEN clause exists', () => {
  assert.match(code, /v_condef ~\* '\\yDELETE\\y' or v_condef ~\* '\\yTRUNCATE\\y'/)
  assert.match(code, /v_condef !~\* 'FOR EACH ROW'/)
  assert.match(code, /v_condef ~\* '\\yWHEN\\s\*\\\('/)
})

test('food_items_reading_trigger: detects a duplicate trigger calling the same function on the same table', () => {
  assert.match(code, /v_duplicate_count > 1/)
  assert.match(code, /expected exactly 1/)
})

test('food_items_reading_trigger: this migration deliberately avoids reconstructing pg_trigger.tgtype bitmask constants from memory (documented, not silently omitted)', () => {
  assert.match(sql, /does NOT attempt to reconstruct pg_trigger\.tgtype's bitmask/)
})

// --- meal-photos policies ----------------------------------------------------

test('meal-photos: SELECT/INSERT/DELETE policies are all present and normalized via DROP POLICY IF EXISTS + CREATE POLICY, no UPDATE policy is added', () => {
  for (const name of ['meal-photos select', 'meal-photos insert', 'meal-photos delete']) {
    assert.match(code, new RegExp(`drop policy if exists "${name}" on storage\\.objects;`))
  }
  assert.doesNotMatch(lowerCode, /"meal-photos update"/)
})

test('storage.buckets is never written by this migration (no INSERT/UPDATE), only read for a sanity assertion', () => {
  assert.doesNotMatch(lowerCode, /insert into storage\.buckets/)
  assert.doesNotMatch(lowerCode, /update storage\.buckets/)
  assert.match(code, /select public, file_size_limit into v_public, v_file_size_limit\s*\n\s*from storage\.buckets/)
})

test('the bucket sanity assertion checks the exact confirmed Production values (public = false, file_size_limit = 2097152) and raises rather than corrects on mismatch', () => {
  assert.match(code, /v_public is distinct from false/)
  assert.match(code, /v_file_size_limit is distinct from 2097152/)
})

// --- explicit non-scope -------------------------------------------------------

test('this migration never touches ai_usage_state, reserve_ai_usage, or release_ai_usage (already versioned by 202607230001)', () => {
  assert.doesNotMatch(lowerCode, /ai_usage_state/)
  assert.doesNotMatch(lowerCode, /reserve_ai_usage/)
  assert.doesNotMatch(lowerCode, /release_ai_usage/)
})

test('this migration never touches published_at filtering or the is_published default value (deferred per the runbook)', () => {
  assert.doesNotMatch(lowerCode, /published_at\s*<=\s*current_date/)
  assert.doesNotMatch(lowerCode, /alter column is_published/)
})

test('no application data DML (no top-level INSERT/UPDATE/DELETE against user data tables outside the catalog-metadata queries)', () => {
  const dataTables = ['profiles', 'trainings', 'weight_records', 'meal_logs', 'step_logs', 'food_items', 'blogs']
  for (const t of dataTables) {
    assert.doesNotMatch(lowerCode, new RegExp(`insert into public\\.${t}\\b`))
    assert.doesNotMatch(lowerCode, new RegExp(`update public\\.${t}\\b`))
    assert.doesNotMatch(lowerCode, new RegExp(`delete from public\\.${t}\\b`))
  }
})
