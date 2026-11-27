import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Static source checks only, matching this repository's migration-test
// convention. This migration has never been applied to any database this
// session — see docs/database/SCHEMA_MIGRATION_RUNBOOK.md for the required
// Preview-environment privilege runtime test before Production apply.

const migrationPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '202608040002_harden_database_privileges.sql'
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

// Joins wrapped `-- ...` comment lines into flowing prose, so a phrase that
// happens to wrap across lines (each new line re-prefixed with `--`) can
// still be matched as a single sentence rather than requiring every test to
// account for exactly where the source happened to wrap.
const prose = sql.replace(/\n--\s*/g, ' ')
const lowerProse = prose.toLowerCase()

test('the entire migration is wrapped in a single explicit transaction (begin ... commit)', () => {
  const beginMatches = [...lowerCode.matchAll(/^\s*begin;\s*$/gm)]
  const commitMatches = [...lowerCode.matchAll(/^\s*commit;\s*$/gm)]
  assert.equal(beginMatches.length, 1)
  assert.equal(commitMatches.length, 1)
  assert.ok(beginMatches[0].index < commitMatches[0].index)
})

// --- blogs -------------------------------------------------------------------

test('blogs: REVOKE INSERT/UPDATE/DELETE/TRUNCATE from anon and authenticated, exactly once', () => {
  const matches = [...lowerCode.matchAll(/revoke insert,\s*update,\s*delete,\s*truncate\s+on table public\.blogs\s+from anon,\s*authenticated;/g)]
  assert.equal(matches.length, 1)
})

test('blogs: GRANT SELECT to anon and authenticated, exactly once', () => {
  const matches = [...lowerCode.matchAll(/grant select\s+on table public\.blogs\s+to anon,\s*authenticated;/g)]
  assert.equal(matches.length, 1)
})

test('blogs: service_role is never named in any REVOKE statement anywhere in this migration', () => {
  const revokeStatements = [...code.matchAll(/revoke[\s\S]*?;/gi)]
  for (const stmt of revokeStatements) {
    assert.doesNotMatch(stmt[0].toLowerCase(), /service_role/)
  }
})

test('blogs: no ALTER/DROP TABLE, no DELETE/UPDATE DML against blogs data (privilege-only migration)', () => {
  assert.doesNotMatch(lowerCode, /alter table public\.blogs\s+(add|drop|alter) column/)
  assert.doesNotMatch(lowerCode, /drop table public\.blogs/)
  assert.doesNotMatch(lowerCode, /delete from public\.blogs/)
  assert.doesNotMatch(lowerCode, /update public\.blogs\s+set/)
})

// --- set_food_item_reading -----------------------------------------------

test('set_food_item_reading: EXECUTE revoked from PUBLIC, anon, and authenticated in one statement', () => {
  assert.match(lowerCode, /revoke execute on function public\.set_food_item_reading\(\) from public, anon, authenticated;/)
})

test('get_brand_categories: no REVOKE statement targets it (grant preserved, not touched by this migration)', () => {
  const revokeStatements = [...code.matchAll(/revoke[\s\S]*?;/gi)].map((m) => m[0].toLowerCase())
  for (const stmt of revokeStatements) {
    assert.doesNotMatch(stmt, /get_brand_categories/)
  }
})

test('get_brand_categories grant is asserted (has_function_privilege checks), not re-issued as a new GRANT', () => {
  assert.match(code, /has_function_privilege\('anon', 'public\.get_brand_categories\(text\)', 'execute'\)/)
  assert.match(code, /has_function_privilege\('authenticated', 'public\.get_brand_categories\(text\)', 'execute'\)/)
  assert.doesNotMatch(lowerCode, /grant execute on function public\.get_brand_categories/)
})

test('kata_to_hira is not touched anywhere in this migration (no GRANT, no REVOKE, no assertion)', () => {
  assert.doesNotMatch(lowerCode, /kata_to_hira/)
})

test('reserve_ai_usage / release_ai_usage / handle_new_user grants are only asserted via has_function_privilege, never re-issued as GRANT/REVOKE', () => {
  for (const fn of ['reserve_ai_usage', 'release_ai_usage', 'handle_new_user']) {
    assert.match(lowerCode, new RegExp(`has_function_privilege\\([^)]*${fn}`))
  }
  assert.doesNotMatch(lowerCode, /grant execute on function public\.reserve_ai_usage/)
  assert.doesNotMatch(lowerCode, /grant execute on function public\.release_ai_usage/)
  assert.doesNotMatch(lowerCode, /revoke.*handle_new_user/)
})

// --- default privileges --------------------------------------------------
//
// Codex follow-up fix (High #1, SQL round): a schema-specific
// `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public ...` REVOKE alone does not
// remove a pre-existing *global* default ACL entry for role postgres, so
// both statement forms are issued. Both remain in the SQL unchanged.
//
// Codex follow-up fix (explanatory round 2, 2026-08-04): the migration's
// own comment previously mischaracterized *why* both statements are
// needed, in two successive wrong ways that this round corrects together:
//   1. (round-3 wording) it described the schema-specific REVOKE as a
//      protective "override" that stops a hypothetical future global GRANT
//      from "reopening" this schema.
//   2. (a second wrong framing found by Codex in round 3's own fix) it
//      described the schema-specific entry as "what actually applies"
//      for objects created in that schema, implying precedence/replacement
//      over the global entry.
// Neither is how PostgreSQL default privileges work. Per PostgreSQL's
// documented behavior, schema-specific default privileges are *added to*
// the global default privileges for that object type -- they do not
// override, replace, or take precedence over the global setting, and a
// schema-specific REVOKE cannot cancel/negate/"deny" a privilege a global
// GRANT (built-in or explicit) separately confers, because REVOKE only
// removes ACL entries that were themselves granted -- it never adds a
// blocking/deny entry. The schema-specific REVOKE here exists only because
// Production's metadata confirmed an already-existing, explicit
// schema-specific default ACL entry that needed converging/removing, not
// as future-proofing or as a second symmetric line of defense. The tests
// below verify the corrected (additive-model) explanation is present and
// that neither incorrect framing (override/deny/precedence, or "both
// required together" as a protective pair) is reintroduced anywhere in
// this file's full text.

test('default privileges: BOTH a global (no IN SCHEMA) and a schema-specific (IN SCHEMA public) REVOKE exist, each FOR ROLE postgres, each exactly once (SQL unchanged by the explanatory-only fix)', () => {
  const globalMatches = [...lowerCode.matchAll(/alter default privileges for role postgres\s*\n\s*revoke execute on functions from public, anon, authenticated;/g)]
  const schemaSpecificMatches = [...lowerCode.matchAll(/alter default privileges for role postgres in schema public\s*\n\s*revoke execute on functions from public, anon, authenticated;/g)]
  assert.equal(globalMatches.length, 1, 'expected exactly one global (no IN SCHEMA) ALTER DEFAULT PRIVILEGES REVOKE')
  assert.equal(schemaSpecificMatches.length, 1, 'expected exactly one schema-specific (IN SCHEMA public) ALTER DEFAULT PRIVILEGES REVOKE')
})

test('the global ALTER DEFAULT PRIVILEGES statement genuinely has no "in schema" clause anywhere between "for role postgres" and its own "revoke"', () => {
  const globalStart = lowerCode.match(/alter default privileges for role postgres\s*\n\s*revoke/)
  assert.ok(globalStart, 'could not locate the global-form statement with nothing between "for role postgres" and "revoke"')
})

test('default privileges: only FUNCTIONS are affected by either statement (no TABLES or SEQUENCES default privilege change)', () => {
  assert.doesNotMatch(lowerCode, /alter default privileges.*on tables/is)
  assert.doesNotMatch(lowerCode, /alter default privileges.*on sequences/is)
})

test('both default privileges REVOKE statements explicitly include PUBLIC alongside anon/authenticated (not anon/authenticated alone)', () => {
  const matches = [...code.matchAll(/alter default privileges for role postgres(?: in schema public)?\s*\n\s*revoke execute on functions from ([^;]+);/gi)]
  assert.equal(matches.length, 2)
  for (const match of matches) {
    const grantees = match[1].split(',').map((g) => g.trim().toLowerCase())
    assert.deepEqual(grantees.sort(), ['anon', 'authenticated', 'public'])
  }
})

test('migration comment states the GLOBAL REVOKE is the central hardening action, removing PostgreSQL\'s built-in default PUBLIC EXECUTE grant', () => {
  assert.match(prose, /is the \*central\* hardening action/)
  assert.match(prose, /built-in default/)
  assert.match(prose, /grant EXECUTE on new functions to PUBLIC/)
})

test('migration comment states PUBLIC applies to every role, which is why revoking it (not just anon/authenticated individually) matters', () => {
  assert.match(prose, /PUBLIC applies to every role/)
})

test('migration comment states the additive model: per-schema default privileges are added to the global default, not a replacement/override/precedence', () => {
  assert.match(prose, /schema-specific default privileges are \*\*added to\*\*/)
  assert.match(prose, /do not replace, override, or take precedence over the global setting/)
})

test('migration comment states a schema-specific REVOKE cannot cancel/negate/deny a privilege a global GRANT confers', () => {
  assert.match(prose, /schema-specific REVOKE cannot cancel, negate, or "deny" a privilege/)
})

test('migration comment states the schema-specific REVOKE converges an existing, explicit, confirmed Production entry, not a protective/symmetric mechanism', () => {
  assert.match(prose, /this statement exists solely to converge and remove that specific, already-present entry/)
  assert.match(prose, /not a second, symmetric line of defense/)
})

test('migration comment does NOT claim the schema-specific entry "takes precedence" or "is what actually applies" (the round-3 incorrect framing removed this round)', () => {
  assert.doesNotMatch(lowerProse, /takes precedence/)
  assert.doesNotMatch(lowerProse, /is what actually applies there/)
  assert.doesNotMatch(lowerProse, /schema-specific revoke additionally records/)
  assert.doesNotMatch(lowerProse, /cannot silently reopen/)
  assert.doesNotMatch(lowerProse, /override so that a future/)
})

test('migration comment does NOT claim both REVOKE statements are "required together" as a symmetric protective pair anywhere in the full file text', () => {
  assert.doesNotMatch(lowerProse, /required together/)
  assert.doesNotMatch(lowerProse, /both.{0,40}required/s)
  assert.doesNotMatch(lowerProse, /prove both/)
  assert.doesNotMatch(lowerProse, /restore both/)
})

test('migration comment states future public RPCs must include an explicit GRANT in their own migration (unchanged requirement)', () => {
  assert.match(sql, /MUST include its own explicit/)
  assert.match(sql, /grant execute on function \.\.\. to anon, authenticated;/)
})

test('migration comment documents the A-vs-B decision and grounds it in this repo\'s actual code, not just a generic best practice', () => {
  assert.match(sql, /Scope decision \(A vs B from the task\)/)
  assert.match(sql, /supabase\.from\(\.\.\.\)/)
})

// --- non-scope -------------------------------------------------------------

test('this migration never writes to storage.buckets or step_logs/food_items/profiles (privilege-only, no schema DDL)', () => {
  assert.doesNotMatch(lowerCode, /storage\.buckets/)
  assert.doesNotMatch(lowerCode, /alter table public\.step_logs/)
  assert.doesNotMatch(lowerCode, /alter table public\.food_items/)
  assert.doesNotMatch(lowerCode, /alter table public\.profiles/)
})

test('no dangerous rollback-style GRANT (INSERT/UPDATE/DELETE/TRUNCATE to anon/authenticated on blogs) appears anywhere in this file', () => {
  assert.doesNotMatch(lowerCode, /grant insert.*to anon/)
  assert.doesNotMatch(lowerCode, /grant.*truncate.*to anon, authenticated/)
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
