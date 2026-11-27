import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Plain string/regex checks only, matching this repository's convention for
// migration tests (e.g. supabase/migrations/202607240002_harden_public_functions.test.mjs).
// This file is not a versioned migration and is never applied to any
// database this session — these tests verify the artifact's *text* (scope,
// forbidden statements, presence of every required object) rather than its
// runtime effect, which cannot be verified without a live Postgres instance.

const filePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '20260804_production_schema.sql'
)
const sql = readFileSync(filePath, 'utf8')

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

// Joins wrapped `-- ...` comment lines into flowing prose, so a phrase that
// happens to wrap across lines (each new line re-prefixed with `--`) can
// still be matched as a single sentence.
const prose = sql.replace(/\n--\s*/g, ' ')
const lowerProse = prose.toLowerCase()

// --- scope / safety -----------------------------------------------------

test('baseline artifact header explicitly forbids applying it to the existing Production project', () => {
  assert.match(sql, /DO NOT APPLY THIS FILE TO THE EXISTING FITMATE PRODUCTION PROJECT/)
  assert.match(sql, /fresh Supabase project/i)
})

test('baseline artifact does not live under supabase/migrations/ (confirmed by its own path, checked here as a guard against future accidental move)', () => {
  assert.doesNotMatch(filePath.replace(/\\/g, '/'), /supabase\/migrations\//)
})

test('baseline artifact never creates or modifies Storage system tables (storage.buckets/storage.objects DDL, or bucket INSERT/UPDATE)', () => {
  assert.doesNotMatch(lowerCode, /create table storage\./)
  assert.doesNotMatch(lowerCode, /insert into storage\.buckets/)
  assert.doesNotMatch(lowerCode, /update storage\.buckets/)
})

test('baseline artifact never creates auth.users or any other auth.* object', () => {
  assert.doesNotMatch(lowerCode, /create table auth\./)
})

test('baseline artifact contains no CREATE EXTENSION statement', () => {
  assert.doesNotMatch(lowerCode, /create extension/)
})

test('baseline artifact contains no DROP TABLE / DROP SCHEMA / TRUNCATE DML statement (the word "truncate" as a REVOKE privilege name on blogs is expected and allowed)', () => {
  assert.doesNotMatch(lowerCode, /drop table/)
  assert.doesNotMatch(lowerCode, /drop schema/)
  assert.doesNotMatch(lowerCode, /^\s*truncate\s+table/m)
  assert.doesNotMatch(lowerCode, /^\s*truncate\s+public\./m)
})

// --- tables ---------------------------------------------------------------

test('baseline artifact defines exactly the 8 confirmed public tables, each exactly once', () => {
  const tables = ['profiles', 'trainings', 'weight_records', 'meal_logs', 'step_logs', 'food_items', 'blogs', 'ai_usage_state']
  for (const t of tables) {
    const matches = [...lowerCode.matchAll(new RegExp(`create table public\\.${t}\\s*\\(`, 'g'))]
    assert.equal(matches.length, 1, `expected exactly one "create table public.${t}(", found ${matches.length}`)
  }
})

test('profiles: all 6 additive columns present with CHECK constraints for gender/character/fitness_goal', () => {
  assert.match(code, /gender text,/)
  assert.match(code, /target_days integer,/)
  assert.match(code, /target_date date,/)
  assert.match(code, /nickname text,/)
  assert.match(code, /character text,/)
  assert.match(code, /fitness_goal text,/)
  assert.match(code, /profiles_gender_check check \(gender is null or gender in \('male', 'female'\)\)/)
  assert.match(code, /profiles_character_check check \(character is null or character in \('leo', 'mina', 'saya'\)\)/)
  assert.match(code, /profiles_fitness_goal_check check \(\s*fitness_goal is null or fitness_goal in \('gain_muscle', 'lose_weight', 'maintain'\)\s*\)/)
})

test('trainings: memo column present alongside the original columns', () => {
  assert.match(code, /memo text default ''/)
})

test('meal_logs: photo_url column present', () => {
  assert.match(code, /photo_url text,/)
})

test('step_logs: user_id is nullable (no NOT NULL), matching confirmed Production shape', () => {
  const tableMatch = code.match(/create table public\.step_logs \(([\s\S]*?)\);/)
  assert.ok(tableMatch, 'could not locate step_logs table definition')
  assert.doesNotMatch(tableMatch[1], /user_id uuid[^,]*not null/i)
  assert.match(tableMatch[1], /unique \(user_id, date_id\)/)
})

test('food_items: reading column present', () => {
  assert.match(code, /reading text\n\);/)
})

test('blogs: slug UNIQUE, is_published default true, published_at date not null', () => {
  const tableMatch = code.match(/create table public\.blogs \(([\s\S]*?)\);/)
  assert.ok(tableMatch)
  assert.match(tableMatch[1], /slug text not null unique/)
  assert.match(tableMatch[1], /is_published boolean not null default true/)
  assert.match(tableMatch[1], /published_at date not null/)
})

// --- indexes ---------------------------------------------------------------

test('all 3 confirmed application indexes are present', () => {
  assert.match(code, /create index trainings_user_date on public\.trainings\(user_id, date_id\);/)
  assert.match(code, /create index weight_user_date on public\.weight_records\(user_id, date_id\);/)
  assert.match(code, /create index meal_user_date on public\.meal_logs\(user_id, date_id\);/)
})

// --- RLS / policies ---------------------------------------------------------

test('RLS is enabled on all 8 tables', () => {
  const tables = ['profiles', 'trainings', 'weight_records', 'meal_logs', 'step_logs', 'food_items', 'blogs', 'ai_usage_state']
  for (const t of tables) {
    assert.match(lowerCode, new RegExp(`alter table public\\.${t} enable row level security;`))
  }
})

test('own-data policies exist for profiles/trainings/weight_records/meal_logs/step_logs, each "for all using (auth.uid() = user_id)"', () => {
  for (const t of ['profiles', 'trainings', 'weight_records', 'meal_logs']) {
    assert.match(code, new RegExp(`create policy "${t}: own data" on public\\.${t}\\s*\\n\\s*for all using \\(auth\\.uid\\(\\) = user_id\\);`))
  }
  assert.match(code, /create policy "Users can manage own step logs" on public\.step_logs\s*\n\s*for all using \(auth\.uid\(\) = user_id\);/)
})

test('food_items has a public-read-only policy (no write policy anywhere for food_items)', () => {
  assert.match(code, /create policy "public_read_food_items" on public\.food_items\s*\n\s*for select to public using \(true\);/)
})

test('blogs has exactly one policy, SELECT-only, is_published = true', () => {
  const blogsPolicies = [...code.matchAll(/create policy [^\n]* on public\.blogs/g)]
  assert.equal(blogsPolicies.length, 1)
  assert.match(code, /create policy "public read published" on public\.blogs\s*\n\s*for select to public using \(is_published = true\);/)
})

test('ai_usage_state has zero CREATE POLICY statements (RLS enabled, policy-less by design)', () => {
  assert.doesNotMatch(lowerCode, /create policy[^\n]*public\.ai_usage_state/)
})

// --- functions ---------------------------------------------------------------

test('all 6 confirmed public functions are defined exactly once', () => {
  const signatures = [
    'public.get_brand_categories(brand_name text)',
    'public.kata_to_hira(t text)',
    'public.set_food_item_reading()',
    'public.handle_new_user()',
    'public.reserve_ai_usage(p_route text, p_request_id uuid)',
    'public.release_ai_usage(p_route text, p_request_id uuid)',
  ]
  for (const sig of signatures) {
    const matches = [...lowerCode.matchAll(new RegExp(`create or replace function\\s+${sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`.toLowerCase(), 'g'))]
    assert.equal(matches.length, 1, `expected exactly one definition of ${sig}, found ${matches.length}`)
  }
})

test('every function sets search_path to the empty string (6 occurrences)', () => {
  const clauses = [...code.matchAll(/set search_path\s*=\s*'([^']*)'/gi)].map((m) => m[1])
  assert.equal(clauses.length, 6)
  for (const value of clauses) {
    assert.equal(value, '')
  }
})

test('SECURITY DEFINER is used only for handle_new_user, reserve_ai_usage, release_ai_usage', () => {
  const definerCount = (lowerCode.match(/security definer/g) ?? []).length
  assert.equal(definerCount, 3)
})

test('SECURITY INVOKER is used only for get_brand_categories, kata_to_hira, set_food_item_reading', () => {
  const invokerCount = (lowerCode.match(/security invoker/g) ?? []).length
  assert.equal(invokerCount, 3)
})

test('baseline artifact contains no dynamic SQL (EXECUTE format) and no DO blocks', () => {
  assert.doesNotMatch(lowerCode, /execute\s+format/)
  assert.doesNotMatch(lowerCode, /\bdo\s+\$\$/)
})

// --- triggers ---------------------------------------------------------------

test('exactly 2 triggers are created: on_auth_user_created and food_items_reading_trigger', () => {
  const matches = [...lowerCode.matchAll(/create trigger/g)]
  assert.equal(matches.length, 2)
  assert.match(code, /create trigger on_auth_user_created\s*\n\s*after insert on auth\.users\s*\n\s*for each row execute procedure public\.handle_new_user\(\);/)
  assert.match(code, /create trigger food_items_reading_trigger\s*\n\s*before insert or update on public\.food_items\s*\n\s*for each row execute function public\.set_food_item_reading\(\);/)
})

// --- grants (final least-privilege state) -----------------------------------

test('ai_usage_state: all direct table access revoked from public/anon/authenticated', () => {
  assert.match(lowerCode, /revoke all on table public\.ai_usage_state from public;/)
  assert.match(lowerCode, /revoke all on table public\.ai_usage_state from anon;/)
  assert.match(lowerCode, /revoke all on table public\.ai_usage_state from authenticated;/)
})

test('reserve_ai_usage/release_ai_usage: authenticated-only EXECUTE, anon/public revoked', () => {
  for (const fn of ['reserve_ai_usage', 'release_ai_usage']) {
    assert.match(lowerCode, new RegExp(`revoke all on function public\\.${fn}\\(text, uuid\\) from public;`))
    assert.match(lowerCode, new RegExp(`revoke all on function public\\.${fn}\\(text, uuid\\) from anon;`))
    assert.match(lowerCode, new RegExp(`grant execute on function public\\.${fn}\\(text, uuid\\) to authenticated;`))
  }
})

test('handle_new_user and set_food_item_reading: direct EXECUTE revoked from public/anon/authenticated (trigger-only)', () => {
  for (const fn of ['handle_new_user\\(\\)', 'set_food_item_reading\\(\\)']) {
    assert.match(lowerCode, new RegExp(`revoke execute on function public\\.${fn} from public;`))
    assert.match(lowerCode, new RegExp(`revoke execute on function public\\.${fn} from anon;`))
    assert.match(lowerCode, new RegExp(`revoke execute on function public\\.${fn} from authenticated;`))
  }
})

test('get_brand_categories and kata_to_hira: EXECUTE explicitly granted to anon and authenticated', () => {
  for (const fn of ['get_brand_categories\\(text\\)', 'kata_to_hira\\(text\\)']) {
    assert.match(lowerCode, new RegExp(`grant execute on function public\\.${fn} to anon;`))
    assert.match(lowerCode, new RegExp(`grant execute on function public\\.${fn} to authenticated;`))
  }
})

test('blogs: write privileges revoked from anon/authenticated, SELECT explicitly granted, service_role never named', () => {
  assert.match(lowerCode, /revoke insert, update, delete, truncate on table public\.blogs from anon, authenticated;/)
  assert.match(lowerCode, /grant select on table public\.blogs to anon, authenticated;/)
  assert.doesNotMatch(lowerCode, /service_role/)
})

// --- Storage policies --------------------------------------------------------

test('meal-photos SELECT/INSERT/DELETE policies are all present, authenticated-only, own-folder scoped, and DROP-then-CREATE for idempotency', () => {
  for (const [name, clause] of [
    ['meal-photos select', 'using'],
    ['meal-photos insert', 'with check'],
    ['meal-photos delete', 'using'],
  ]) {
    assert.match(lowerCode, new RegExp(`drop policy if exists "${name}" on storage\\.objects;`))
    const block = code.slice(code.toLowerCase().indexOf(`create policy "${name}"`))
    assert.match(block, /to authenticated/)
    assert.match(block, new RegExp(clause.replace(/\s+/g, '\\s+'), 'i'))
    assert.match(block, /bucket_id = 'meal-photos'/)
    assert.match(block, /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/)
  }
})

test('no UPDATE policy is defined for meal-photos (matches confirmed Production, which has none)', () => {
  assert.doesNotMatch(lowerCode, /create policy "meal-photos update"/)
})

// --- transaction wrapping (Codex follow-up fix, High #2 related) -----------

test('the entire baseline artifact is wrapped in a single explicit transaction (begin ... commit), so a mid-apply failure leaves no partial schema behind', () => {
  const beginMatches = [...lowerCode.matchAll(/^\s*begin;\s*$/gm)]
  const commitMatches = [...lowerCode.matchAll(/^\s*commit;\s*$/gm)]
  assert.equal(beginMatches.length, 1)
  assert.equal(commitMatches.length, 1)
  assert.ok(beginMatches[0].index < commitMatches[0].index)
  // begin; must be the first non-comment statement, and commit; the last.
  const firstStatement = code.trim().split('\n').find((l) => l.trim().length > 0)
  assert.equal(firstStatement.trim(), 'begin;')
  const lastStatement = [...code.trim().split('\n')].reverse().find((l) => l.trim().length > 0)
  assert.equal(lastStatement.trim(), 'commit;')
})

test('no CREATE INDEX CONCURRENTLY (non-transactional statement) appears anywhere', () => {
  assert.doesNotMatch(lowerCode, /concurrently/)
})

test('no Storage bucket INSERT/UPDATE and no Supabase-internal schema CREATE appear anywhere (both forbidden inside the transaction)', () => {
  assert.doesNotMatch(lowerCode, /insert into storage\.buckets/)
  assert.doesNotMatch(lowerCode, /update storage\.buckets/)
  assert.doesNotMatch(lowerCode, /create (table|schema) (storage|auth)\./)
})

// --- default privileges (Codex follow-up fix, High #1) ----------------------

test('baseline: BOTH a global (no IN SCHEMA) and a schema-specific (IN SCHEMA public) default-EXECUTE REVOKE exist, each FOR ROLE postgres', () => {
  const globalMatches = [...lowerCode.matchAll(/alter default privileges for role postgres\s*\n\s*revoke execute on functions from public, anon, authenticated;/g)]
  const schemaSpecificMatches = [...lowerCode.matchAll(/alter default privileges for role postgres in schema public\s*\n\s*revoke execute on functions from public, anon, authenticated;/g)]
  assert.equal(globalMatches.length, 1)
  assert.equal(schemaSpecificMatches.length, 1)
})

test('baseline default privileges: only FUNCTIONS are affected, no TABLE/SEQUENCE default privilege change', () => {
  assert.doesNotMatch(lowerCode, /alter default privileges.*on tables/is)
  assert.doesNotMatch(lowerCode, /alter default privileges.*on sequences/is)
})

test('baseline default privileges section appears after the function grants and Storage policy sections, near the end of the file, immediately before commit;', () => {
  const defaultPrivIndex = lowerCode.indexOf('alter default privileges for role postgres')
  const commitIndex = lowerCode.lastIndexOf('commit;')
  const mealPhotosDeleteIndex = lowerCode.indexOf('create policy "meal-photos delete"')
  assert.ok(defaultPrivIndex > mealPhotosDeleteIndex)
  assert.ok(defaultPrivIndex < commitIndex)
})

test('baseline comment states the global REVOKE is the central hardening action', () => {
  assert.match(prose, /global\*\* REVOKE[\s\S]{0,60}is the central hardening action/)
})

test('baseline comment states the additive model: per-schema default privileges are added to the global default, not a replacement/override/precedence', () => {
  assert.match(lowerProse, /schema-specific default privileges are added to whatever the/)
  assert.match(lowerProse, /they do not replace or take/)
  assert.match(lowerProse, /precedence over the global setting/)
  assert.match(lowerProse, /cannot cancel or "deny" a privilege a global grant separately confers/)
})

test('baseline comment states the schema-specific REVOKE is a convergence-only, non-symmetric statement (not a second line of defense)', () => {
  assert.match(lowerProse, /not a second, symmetric line of defense/)
})

test('baseline comment does NOT claim the schema-specific REVOKE overrides, blocks, "denies", or takes precedence (the incorrect framing removed across rounds 3 and 4)', () => {
  assert.doesNotMatch(lowerProse, /schema-specific revoke additionally records/)
  assert.doesNotMatch(lowerProse, /override so that a future/)
  assert.doesNotMatch(lowerProse, /records an? explicit `public`-schema override/)
  assert.doesNotMatch(lowerProse, /takes precedence over/)
  assert.doesNotMatch(lowerProse, /is what actually applies there/)
})

test('baseline comment does NOT claim both REVOKE statements are "required together" as a symmetric protective pair anywhere in the full file text', () => {
  assert.doesNotMatch(lowerProse, /required together/)
  assert.doesNotMatch(lowerProse, /both.{0,40}required/s)
  assert.doesNotMatch(lowerProse, /prove both/)
  assert.doesNotMatch(lowerProse, /restore both/)
})

test('baseline comment clarifies fresh bucket creation is Dashboard/Storage-API-only and the existing management script cannot create a bucket', () => {
  assert.match(lowerProse, /created via the supabase dashboard storage ui or the formal storage api's bucket-creation call/)
  assert.match(lowerProse, /cannot create a bucket/)
  assert.match(lowerProse, /it only calls the storage api's `getbucket`\/`updatebucket` operations/)
})

test('the full file text contains none of the banned default-privilege phrases anywhere (not limited to the sections checked above)', () => {
  const bannedEnglish = [
    'both are required',
    'both defaults are required',
    'prove both',
    'restore both',
    'override global',
    'deny global',
    'prevent a future global grant',
    'schema-specific entry takes precedence',
    'schema-specific revoke cancels global grant',
    'is what actually applies there',
    'takes precedence over',
    'required together',
  ]
  for (const phrase of bannedEnglish) {
    assert.doesNotMatch(lowerProse, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `found banned phrase: "${phrase}"`)
  }
  const bannedJapanese = ['両方が必要', '両方を復元', '両方とも必要', 'globalを打ち消す', 'globalを上書き']
  for (const phrase of bannedJapanese) {
    assert.doesNotMatch(sql, new RegExp(phrase), `found banned Japanese phrase: "${phrase}"`)
  }
})
