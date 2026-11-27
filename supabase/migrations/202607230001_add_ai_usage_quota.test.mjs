import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// STATIC SQL INVARIANT TEST — plain string/regex checks against the
// migration's own text only. There is no authorized runtime PostgreSQL
// instance available to this test (per this repository's Production-DB
// safety rules), so this file does NOT and cannot exercise real transaction
// concurrency, row locking, or timing behavior — it only locks the *source*
// so that a future refactor of this migration's SQL cannot silently drop one
// of these security-relevant invariants without a test failing. This is
// explicitly not a SQL CONCURRENCY TEST.
//
// Follows the same plain-regex, no-SQL-parser-dependency convention as
// supabase/migrations/202607240002_harden_public_functions.test.mjs. The
// migration file is read fresh on every run — no SQL is copied into this
// test file.

const migrationPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '202607230001_add_ai_usage_quota.sql'
)
const sql = readFileSync(migrationPath, 'utf8')

// Strips `-- ...` line comments so count/structure-based checks below aren't
// tripped up by this file's own explanatory prose (which necessarily
// mentions things like "3 requests/minute" or "auth.uid()" in English).
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

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractFunctionBlock(sourceCode, signature) {
  const headerRe = new RegExp(`create or replace function\\s+${escapeRegex(signature)}`, 'gi')
  const matches = [...sourceCode.matchAll(headerRe)]
  assert.equal(
    matches.length,
    1,
    `expected exactly one "create or replace function ${signature}", found ${matches.length}`
  )
  const start = matches[0].index
  const rest = sourceCode.slice(start)
  const endMatch = rest.match(/\n\$\$;/)
  assert.ok(endMatch, `could not find a closing "$$;" for function ${signature}`)
  return rest.slice(0, endMatch.index + endMatch[0].length)
}

// Extracts exactly one `if <condition> then ... end if;` block (bounded by
// the next `end if;` after the header - the function bodies this is used
// against contain only simple, non-nested if/end if statements, never an
// `if` nested inside another `if`'s branch, so this simple "next end if;
// wins" scan is sound here without needing a real SQL parser). Used to tie a
// specific enforcement comparison to the specific rejection reason returned
// from *that same branch*, rather than asserting the two independently
// (which a Codex review correctly flagged as a false-positive risk: either
// fact could exist elsewhere in the function without actually being wired
// together).
function extractIfBlock(sourceCode, conditionRegexSource) {
  const headerRe = new RegExp(`if\\s+${conditionRegexSource}\\s*then`, 'gi')
  const matches = [...sourceCode.matchAll(headerRe)]
  assert.equal(
    matches.length,
    1,
    `expected exactly one "if ${conditionRegexSource} then", found ${matches.length}`
  )
  const start = matches[0].index
  const rest = sourceCode.slice(start)
  const endMatch = rest.match(/\n\s*end if;/)
  assert.ok(endMatch, `could not find a closing "end if;" for condition ${conditionRegexSource}`)
  return rest.slice(0, endMatch.index + endMatch[0].length)
}

// Extracts the column names on the left-hand side of each comma-separated
// assignment, for EVERY `update public.ai_usage_state set <...> where ...`
// statement found in the given source (not just the first) - one array of
// column names per UPDATE found. Codex follow-up: a single `.match()` here
// previously inspected only the first UPDATE inside release_ai_usage, so a
// second UPDATE appended afterward (e.g. a disguised quota-refund mutation)
// would silently escape this check entirely, regardless of what columns it
// touched. Using `matchAll` finds every occurrence, so the caller can assert
// how many UPDATEs actually exist before trusting any single one's targets.
// Only handles the simple, comma-free-value-expression shape actually used
// by this migration's UPDATE statements (no nested function calls
// containing a comma) - sufficient for this file, not a general SQL parser.
function extractAllUpdateSetTargetGroups(sourceCode) {
  const re = /update public\.ai_usage_state\s*\n\s*set\s+([\s\S]*?)\n\s*where/gi
  const matches = [...sourceCode.matchAll(re)]
  return matches.map((match) =>
    match[1]
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => part.split('=')[0].trim())
  )
}

const reserveFn = extractFunctionBlock(code, 'public.reserve_ai_usage(p_route text, p_request_id uuid)')
const releaseFn = extractFunctionBlock(code, 'public.release_ai_usage(p_route text, p_request_id uuid)')
const lowerReserveFn = reserveFn.toLowerCase()
const lowerReleaseFn = releaseFn.toLowerCase()

test('table: ai_usage_state has user_id as primary key (per-user identity, one row per user)', () => {
  assert.match(lowerCode, /create table if not exists public\.ai_usage_state\s*\(/)
  assert.match(lowerCode, /user_id uuid primary key references auth\.users\(id\)/)
})

test('table: RLS is enabled on ai_usage_state', () => {
  assert.match(lowerCode, /alter table public\.ai_usage_state enable row level security/)
})

test('table: direct privileges are revoked from public/anon/authenticated (reachable only via the SECURITY DEFINER RPCs)', () => {
  assert.match(lowerCode, /revoke all on table public\.ai_usage_state from public/)
  assert.match(lowerCode, /revoke all on table public\.ai_usage_state from anon/)
  assert.match(lowerCode, /revoke all on table public\.ai_usage_state from authenticated/)
})

test('reserve_ai_usage: identifies the caller exclusively via auth.uid() (no client-supplied identity parameter)', () => {
  assert.match(lowerReserveFn, /v_user_id\s*:=\s*auth\.uid\(\)/)
  assert.match(reserveFn, /^create or replace function public\.reserve_ai_usage\(p_route text, p_request_id uuid\)/m)
  // The only parameters are p_route and p_request_id - no user-id-shaped argument.
  assert.doesNotMatch(reserveFn, /p_user_id|p_uid|p_auth_id/i)
})

test('reserve_ai_usage: fails closed (unauthorized) when auth.uid() is null', () => {
  assert.match(lowerReserveFn, /if v_user_id is null then\s*\n\s*return jsonb_build_object\('allowed', false, 'reason', 'unauthorized'/)
})

test('reserve_ai_usage: uses INSERT ... ON CONFLICT (user_id) DO NOTHING to seed a row exactly once per user', () => {
  assert.match(lowerReserveFn, /insert into public\.ai_usage_state/)
  assert.match(lowerReserveFn, /on conflict \(user_id\) do nothing/)
})

test('reserve_ai_usage: locks the row with SELECT ... FOR UPDATE before checking/consuming quota', () => {
  assert.match(lowerReserveFn, /select \* into v_row\s*\n\s*from public\.ai_usage_state\s*\n\s*where user_id = v_user_id\s*\n\s*for update/)
})

test('reserve_ai_usage: fixed limits are 3/minute and 20/day, declared as constants (not RPC arguments)', () => {
  assert.match(lowerReserveFn, /c_minute_limit constant integer := 3/)
  assert.match(lowerReserveFn, /c_day_limit constant integer := 20/)
})

// Codex MEDIUM follow-up: the two tests above only prove the constants are
// *declared*, not that they actually gate anything - a regression that
// deleted "if v_minute_count >= c_minute_limit then ... return ... reason
// minute_limit ... end if;" entirely (or kept the constant unused) would
// still pass every check above. These two tests instead extract the actual
// `if <comparison> then ... end if;` block by its condition text and assert
// the corresponding rejection reason is returned from *within that same
// block* - so both "the comparison exists" and "it is this branch that
// rejects with this reason" are proven together, not independently.
test('reserve_ai_usage: v_minute_count >= c_minute_limit is live enforcement logic that rejects with reason=minute_limit', () => {
  const block = extractIfBlock(lowerReserveFn, escapeRegex('v_minute_count >= c_minute_limit'))
  assert.match(block, /'reason',\s*'minute_limit'/)
  assert.match(block, /'allowed',\s*false/)
})

test('reserve_ai_usage: v_day_count >= c_day_limit is live enforcement logic that rejects with reason=day_limit', () => {
  const block = extractIfBlock(lowerReserveFn, escapeRegex('v_day_count >= c_day_limit'))
  assert.match(block, /'reason',\s*'day_limit'/)
  assert.match(block, /'allowed',\s*false/)
})

// Mutation self-check (Codex-requested): demonstrates against a disposable,
// hand-written synthetic string - never the real migration file - that
// extractIfBlock() genuinely fails closed if either enforcement comparison
// were removed, rather than passing vacuously regardless of input.
test('mutation self-check: extractIfBlock rejects a synthetic body with the minute-limit comparison removed', () => {
  const mutated = `
    if v_row.active_until is not null then
      return jsonb_build_object('allowed', false, 'reason', 'concurrent');
    end if;

    if v_day_count >= c_day_limit then
      return jsonb_build_object('allowed', false, 'reason', 'day_limit');
    end if;
  `.toLowerCase()
  assert.throws(() => extractIfBlock(mutated, escapeRegex('v_minute_count >= c_minute_limit')))
})

test('mutation self-check: extractIfBlock rejects a synthetic body with the day-limit comparison removed', () => {
  const mutated = `
    if v_minute_count >= c_minute_limit then
      return jsonb_build_object('allowed', false, 'reason', 'minute_limit');
    end if;
  `.toLowerCase()
  assert.throws(() => extractIfBlock(mutated, escapeRegex('v_day_count >= c_day_limit')))
})

test('mutation self-check: the tied assertion rejects a synthetic body where the comparison survives but no longer returns its reason (e.g. reason left unchanged from a prior branch)', () => {
  const mutated = `
    if v_minute_count >= c_minute_limit then
      return jsonb_build_object('allowed', false, 'reason', 'concurrent');
    end if;
  `.toLowerCase()
  const block = extractIfBlock(mutated, escapeRegex('v_minute_count >= c_minute_limit'))
  assert.throws(() => assert.match(block, /'reason',\s*'minute_limit'/))
})

test('reserve_ai_usage: minute-limit rejection is a FIXED 60-second window (not a rolling/sliding window)', () => {
  // The window only resets when now - window_start >= 1 minute has elapsed
  // since the window's own start, and a fresh window always starts at "now"
  // for a brand-new/expired window - i.e. a fixed window, not a per-request
  // sliding one.
  assert.match(lowerReserveFn, /if v_now - v_row\.minute_window_start >= interval '1 minute' then/)
  assert.match(lowerReserveFn, /v_minute_window_start := v_now/)
})

test('reserve_ai_usage: the daily boundary is computed in Asia/Tokyo, not UTC or server-local time', () => {
  const matches = [...lowerCode.matchAll(/at time zone 'asia\/tokyo'/g)]
  assert.ok(matches.length >= 1, 'expected at least one "at time zone \'Asia/Tokyo\'" reference')
})

test('reserve_ai_usage: the concurrency reservation has a fixed 45-second expiry', () => {
  assert.match(lowerReserveFn, /c_active_seconds constant integer := 45/)
  assert.match(lowerReserveFn, /active_until = v_now \+ make_interval\(secs => c_active_seconds\)/)
})

test('reserve_ai_usage: p_route is validated against an allowlist of exactly the 3 AI routes', () => {
  assert.match(
    lowerReserveFn,
    /p_route not in \('analyze-meal', 'character-message', 'training-calorie'\)/
  )
})

test('reserve_ai_usage and release_ai_usage: both are SECURITY DEFINER with an empty search_path (search-path-hijack hardening)', () => {
  for (const fn of [reserveFn, releaseFn]) {
    const lower = fn.toLowerCase()
    assert.match(lower, /language plpgsql/)
    assert.match(lower, /security definer/)
    assert.match(lower, /set search_path = ''/)
  }
})

test('reserve_ai_usage and release_ai_usage: table references inside the function bodies are schema-qualified (public.ai_usage_state)', () => {
  for (const fn of [reserveFn, releaseFn]) {
    assert.match(fn, /public\.ai_usage_state/)
    // With search_path = '', an unqualified bare "ai_usage_state" reference
    // would fail to resolve at all - so every reference must carry the
    // schema prefix explicitly.
    assert.doesNotMatch(fn, /[^.]\bai_usage_state\b/)
  }
})

test('reserve_ai_usage and release_ai_usage: EXECUTE is revoked from public/anon and granted only to authenticated', () => {
  assert.match(lowerCode, /revoke all on function public\.reserve_ai_usage\(text, uuid\) from public/)
  assert.match(lowerCode, /revoke all on function public\.reserve_ai_usage\(text, uuid\) from anon/)
  assert.match(lowerCode, /grant execute on function public\.reserve_ai_usage\(text, uuid\) to authenticated/)
  assert.match(lowerCode, /revoke all on function public\.release_ai_usage\(text, uuid\) from public/)
  assert.match(lowerCode, /revoke all on function public\.release_ai_usage\(text, uuid\) from anon/)
  assert.match(lowerCode, /grant execute on function public\.release_ai_usage\(text, uuid\) to authenticated/)
})

test('release_ai_usage: identifies the caller exclusively via auth.uid(), and only releases a reservation matching the caller\'s own request id/route', () => {
  assert.match(lowerReleaseFn, /v_user_id\s*:=\s*auth\.uid\(\)/)
  assert.match(
    lowerReleaseFn,
    /where user_id = v_user_id\s*\n\s*and active_request_id = p_request_id\s*\n\s*and active_route = p_route/
  )
})

// Codex MEDIUM follow-up (round 1): the original version of this test only
// blacklisted one specific subtraction syntax (`minute_count = minute_count
// - ...`), so a regression that zeroed the counters directly
// (`minute_count = 0`) or used a different decrement shape
// (`greatest(minute_count - 1, 0)`) would have slipped through undetected.
// Fixed by extracting every column release_ai_usage's UPDATE statement
// actually assigns to, and allowlisting exactly the concurrency-reservation
// fields it is supposed to clear (plus updated_at) - any other target, in
// any expression form, fails the test.
//
// Codex MEDIUM follow-up (round 2): that fix still inspected only the FIRST
// `update public.ai_usage_state ... set ... where` found in release_ai_usage
// (extractUpdateSetTargets used a single `.match()`). A SECOND UPDATE
// appended after the legitimate one - e.g. a disguised
// `update public.ai_usage_state set minute_count = 0 where ...;` - would
// never be inspected at all and the test would incorrectly pass. Fixed by
// asserting release_ai_usage contains EXACTLY ONE such UPDATE (matching its
// actual, intentional current shape - see extractAllUpdateSetTargetGroups
// above) before trusting that UPDATE's SET targets; a second UPDATE of any
// kind now fails this test immediately, regardless of what it sets.
//
// Codex MEDIUM follow-up (round 3): the round-2 UPDATE-count check above
// still only recognizes the specific
// "update public.ai_usage_state\n  set ...\n  where" line-break/indentation
// shape this migration currently happens to use. Realistic PostgreSQL
// formatting variants - UPDATE and the table name on separate lines, a
// table alias, the whole statement on one line, or irregular spacing -
// would not match that pattern, so a second UPDATE written in any of those
// forms could hide from the round-2 check entirely. Layer 1 below fixes
// this by counting literal `update` keyword occurrences directly (no
// table-name/SET/WHERE shape assumed at all) within the extracted
// release_ai_usage body, which is already comment-stripped (via
// stripLineComments() applied to `code` before extractFunctionBlock() runs
// on it) so a stray "UPDATE" inside a `-- ...` comment cannot cause a false
// positive; release_ai_usage also contains no dynamic SQL string literals,
// so there is no other source of a spurious "update" match. Layer 2 (the
// round-2 SET-target allowlist, retained unchanged below) still separately
// verifies the one legitimate UPDATE's own targets are exactly the approved
// reservation-only columns.
const RELEASE_ALLOWED_SET_TARGETS = new Set(['active_request_id', 'active_route', 'active_until', 'updated_at'])

// Counts literal keyword occurrences (case-insensitive via the caller's
// already-lowercased source, word-boundary only) - independent of
// whitespace, newlines, table alias/name, clause placement, or
// one-line-vs-multiline formatting. Intentionally not a SQL parser: it only
// counts a keyword, so it cannot itself confirm what a matched statement
// targets - Layer 2 below does that, applied only once Layer 1 has
// confirmed there is exactly one UPDATE for Layer 2 to inspect.
function countKeyword(sourceCode, keyword) {
  return [...sourceCode.matchAll(new RegExp(`\\b${keyword}\\b`, 'g'))].length
}
const countUpdateKeywords = (sourceCode) => countKeyword(sourceCode, 'update')

test('release_ai_usage [Layer 1 - format-independent]: contains exactly one UPDATE keyword, regardless of formatting', () => {
  const count = countUpdateKeywords(lowerReleaseFn)
  assert.equal(
    count,
    1,
    `expected exactly one "update" keyword inside release_ai_usage, found ${count} - a second UPDATE statement, ` +
      'in any formatting (newlines, alias, one-line, extra whitespace), must not be able to hide from this check'
  )
})

// Mutation self-checks for Layer 1 (Codex round-3 request): a legitimate
// release UPDATE plus a second, disguised UPDATE written in realistic
// PostgreSQL formatting variants that the round-2, shape-specific scanner
// could miss. Only the format-independent keyword count is exercised here -
// disposable synthetic strings only, the real migration is never touched.
const LEGITIMATE_RELEASE_UPDATE = `
  update public.ai_usage_state
  set active_request_id = null,
      active_route = null,
      active_until = null,
      updated_at = now()
  where user_id = v_user_id
    and active_request_id = p_request_id
    and active_route = p_route;
`

test('mutation self-check [Layer 1]: rejects a second UPDATE with UPDATE and the table name on separate lines', () => {
  const mutated = (
    LEGITIMATE_RELEASE_UPDATE +
    `
    update
    public.ai_usage_state
    set minute_count = 0
    where user_id = v_user_id;
  `
  ).toLowerCase()
  assert.equal(countUpdateKeywords(mutated), 2, 'expected the synthetic mutation to actually contain two UPDATE keywords')
  assert.notEqual(countUpdateKeywords(mutated), 1, 'the exactly-one-UPDATE-keyword invariant must reject this')
})

test('mutation self-check [Layer 1]: rejects a second UPDATE using a table alias', () => {
  const mutated = (
    LEGITIMATE_RELEASE_UPDATE +
    `
    update public.ai_usage_state as usage
    set day_count = greatest(day_count - 1, 0)
    where usage.user_id = v_user_id;
  `
  ).toLowerCase()
  assert.equal(countUpdateKeywords(mutated), 2, 'expected the synthetic mutation to actually contain two UPDATE keywords')
  assert.notEqual(countUpdateKeywords(mutated), 1, 'the exactly-one-UPDATE-keyword invariant must reject this')
})

test('mutation self-check [Layer 1]: rejects a second UPDATE written entirely on one line', () => {
  const mutated = (
    LEGITIMATE_RELEASE_UPDATE +
    `
    update public.ai_usage_state set minute_count = 0 where user_id = v_user_id;
  `
  ).toLowerCase()
  assert.equal(countUpdateKeywords(mutated), 2, 'expected the synthetic mutation to actually contain two UPDATE keywords')
  assert.notEqual(countUpdateKeywords(mutated), 1, 'the exactly-one-UPDATE-keyword invariant must reject this')
})

test('mutation self-check [Layer 1]: rejects a second UPDATE with irregular extra spacing around UPDATE/SET/WHERE and uppercase keywords', () => {
  const mutated = (
    LEGITIMATE_RELEASE_UPDATE +
    `
    UPDATE     public.ai_usage_state
    SET minute_count = 0
    WHERE user_id = v_user_id;
  `
  ).toLowerCase()
  assert.equal(countUpdateKeywords(mutated), 2, 'expected the synthetic mutation to actually contain two UPDATE keywords')
  assert.notEqual(countUpdateKeywords(mutated), 1, 'the exactly-one-UPDATE-keyword invariant must reject this')
})

test('mutation self-check [Layer 1]: rejects a second, disguised UPDATE placed BEFORE the legitimate one', () => {
  const mutated = (
    `
    update public.ai_usage_state set minute_count = 0 where user_id = v_user_id;
  ` + LEGITIMATE_RELEASE_UPDATE
  ).toLowerCase()
  assert.equal(countUpdateKeywords(mutated), 2, 'expected the synthetic mutation to actually contain two UPDATE keywords')
  assert.notEqual(countUpdateKeywords(mutated), 1, 'the exactly-one-UPDATE-keyword invariant must reject this regardless of ordering')
})

test('mutation self-check [Layer 1]: also rejects the legitimate UPDATE being removed entirely (count=0, not just count>1)', () => {
  const mutated = `
    return v_updated > 0;
  `.toLowerCase()
  assert.equal(countUpdateKeywords(mutated), 0)
  assert.notEqual(countUpdateKeywords(mutated), 1, 'the exactly-one-UPDATE-keyword invariant must also reject zero UPDATEs')
})

test('release_ai_usage [Layer 2 - format-specific detail]: the one legitimate UPDATE statement only ever sets the concurrency-reservation fields (never minute_count/day_count, in any form)', () => {
  const updateGroups = extractAllUpdateSetTargetGroups(lowerReleaseFn)
  assert.equal(
    updateGroups.length,
    1,
    `expected exactly one "update public.ai_usage_state ... set ... where" inside release_ai_usage, found ${updateGroups.length} - ` +
      'a second UPDATE (e.g. a disguised quota-refund mutation) must not be able to hide from this check by appearing after the legitimate one'
  )

  const targets = updateGroups[0]
  assert.ok(targets.length > 0, 'expected at least one SET target in release_ai_usage\'s UPDATE statement')
  for (const target of targets) {
    assert.ok(
      RELEASE_ALLOWED_SET_TARGETS.has(target),
      `release_ai_usage's UPDATE sets an unexpected column "${target}" - only ${[...RELEASE_ALLOWED_SET_TARGETS].join(', ')} are allowed`
    )
  }
  // Sanity check that the allowlist itself isn't accidentally satisfied by
  // an empty/degenerate extraction - the three reservation fields the
  // migration is known to clear must actually be present.
  assert.ok(targets.includes('active_request_id'))
  assert.ok(targets.includes('active_route'))
  assert.ok(targets.includes('active_until'))
})

// Mutation self-checks (Codex-requested): demonstrate, against disposable
// hand-written synthetic function bodies only, that the invariant above
// genuinely rejects representative unsafe variants rather than passing
// vacuously - including forms both the original blacklist-based test and
// the round-1 single-UPDATE-aware fix would have missed.
test('mutation self-check: rejects a synthetic release UPDATE that zeroes minute_count directly (single-UPDATE mutation)', () => {
  const mutated = `
    update public.ai_usage_state
    set active_request_id = null,
        active_route = null,
        active_until = null,
        minute_count = 0,
        updated_at = now()
    where user_id = v_user_id
  `.toLowerCase()
  const groups = extractAllUpdateSetTargetGroups(mutated)
  assert.equal(groups.length, 1)
  assert.ok(!groups[0].every((t) => RELEASE_ALLOWED_SET_TARGETS.has(t)), 'expected the allowlist check to detect the injected minute_count = 0')
})

test('mutation self-check: rejects a synthetic release UPDATE that decrements day_count via greatest(...) (single-UPDATE mutation)', () => {
  const mutated = `
    update public.ai_usage_state
    set active_request_id = null,
        active_route = null,
        active_until = null,
        day_count = greatest(day_count - 1, 0),
        updated_at = now()
    where user_id = v_user_id
  `.toLowerCase()
  const groups = extractAllUpdateSetTargetGroups(mutated)
  assert.equal(groups.length, 1)
  assert.ok(!groups[0].every((t) => RELEASE_ALLOWED_SET_TARGETS.has(t)), 'expected the allowlist check to detect the injected day_count decrement')
})

test('mutation self-check: accepts the legitimate reservation-only fields with no false positive', () => {
  const legitimate = `
    update public.ai_usage_state
    set active_request_id = null,
        active_route = null,
        active_until = null,
        updated_at = now()
    where user_id = v_user_id
  `.toLowerCase()
  const groups = extractAllUpdateSetTargetGroups(legitimate)
  assert.equal(groups.length, 1)
  assert.ok(groups[0].every((t) => RELEASE_ALLOWED_SET_TARGETS.has(t)))
})

// Mutation self-checks for the round-2 (second-UPDATE) gap specifically:
// a legitimate release UPDATE followed by a second, disguised UPDATE that
// mutates minute_count/day_count. The exactly-one-UPDATE assertion above
// must reject both, purely from the UPDATE *count* - before even looking at
// what the second UPDATE's SET targets are.
test('mutation self-check: rejects a synthetic release_ai_usage body with a legitimate UPDATE followed by a second UPDATE that zeroes minute_count', () => {
  const mutated = `
    update public.ai_usage_state
    set active_request_id = null,
        active_route = null,
        active_until = null,
        updated_at = now()
    where user_id = v_user_id
      and active_request_id = p_request_id
      and active_route = p_route;

    update public.ai_usage_state
    set minute_count = 0
    where user_id = v_user_id;
  `.toLowerCase()
  const groups = extractAllUpdateSetTargetGroups(mutated)
  assert.equal(groups.length, 2, 'expected the synthetic mutation to actually contain two UPDATE statements')
  assert.notEqual(groups.length, 1, 'the exactly-one-UPDATE assertion must reject this - a second UPDATE must not be able to hide')
})

test('mutation self-check: rejects a synthetic release_ai_usage body with a legitimate UPDATE followed by a second UPDATE that decrements day_count via greatest(...)', () => {
  const mutated = `
    update public.ai_usage_state
    set active_request_id = null,
        active_route = null,
        active_until = null,
        updated_at = now()
    where user_id = v_user_id
      and active_request_id = p_request_id
      and active_route = p_route;

    update public.ai_usage_state
    set day_count = greatest(day_count - 1, 0)
    where user_id = v_user_id;
  `.toLowerCase()
  const groups = extractAllUpdateSetTargetGroups(mutated)
  assert.equal(groups.length, 2, 'expected the synthetic mutation to actually contain two UPDATE statements')
  assert.notEqual(groups.length, 1, 'the exactly-one-UPDATE assertion must reject this - a second UPDATE must not be able to hide')
})

// Codex MEDIUM follow-up (round 4): Layers 1-2 above only ever look for
// UPDATE statements. A regression that added an entirely different kind of
// state-changing statement to release_ai_usage - most concretely, a
// `delete from public.ai_usage_state where user_id = v_user_id;` appended
// after the legitimate UPDATE - would leave the UPDATE count at exactly 1
// and the one UPDATE's own SET targets untouched, so Layers 1-2 would both
// still pass even though the quota row itself had just been deleted (which
// lets the very next reserve_ai_usage call recreate a fresh row via its own
// `insert ... on conflict do nothing`, silently resetting that user's
// minute/day counters - the same practical effect as directly refunding
// quota, just via a different statement type).
//
// Layer 3 closes this by asserting the release function's intentional,
// narrow mutation contract directly: exactly one UPDATE (Layers 1-2,
// unchanged above) and ZERO of any other state-changing statement type -
// INSERT, DELETE, MERGE, TRUNCATE - plus EXECUTE, prohibited specifically
// because dynamic SQL built from a string could otherwise hide a DML
// keyword from this same direct-keyword approach (e.g.
// `execute 'delete from ...'` contains the word "delete" only inside a
// string literal, which a keyword-boundary count still happens to catch
// here, but must not be relied on to catch in general - EXECUTE itself is
// what must never appear in this function, regardless of what is inside
// any string passed to it).
//
// This is still a targeted regression guard for release_ai_usage's current,
// deliberately narrow architecture (a single UPDATE and nothing else) - not
// a general SQL parser, and not an attempt to analyze SELECTs, called
// functions, control flow, or triggers, none of which the current function
// contains.
const RELEASE_PROHIBITED_DML_KEYWORDS = ['insert', 'delete', 'merge', 'truncate', 'execute']

test('release_ai_usage [Layer 3 - prohibited DML/dynamic SQL]: contains zero INSERT/DELETE/MERGE/TRUNCATE/EXECUTE keywords', () => {
  for (const keyword of RELEASE_PROHIBITED_DML_KEYWORDS) {
    const count = countKeyword(lowerReleaseFn, keyword)
    assert.equal(
      count,
      0,
      `expected zero "${keyword}" keyword occurrences inside release_ai_usage, found ${count} - this function's only ` +
        'allowed mutation is its single, already-verified UPDATE statement (Layers 1-2 above); any other state-changing ' +
        'statement type, or dynamic SQL execution, must not be able to hide a quota reset/refund from these static checks'
    )
  }
})

test('mutation self-check [Layer 3]: rejects the exact Codex-identified bypass - a DELETE appended after the legitimate UPDATE', () => {
  const mutated = (
    LEGITIMATE_RELEASE_UPDATE +
    `
    delete from public.ai_usage_state
    where user_id = v_user_id;
  `
  ).toLowerCase()
  // Confirms this mutation genuinely passes Layers 1-2 (as Codex reported)
  // before confirming Layer 3 is what actually catches it.
  assert.equal(countUpdateKeywords(mutated), 1, 'the UPDATE count must remain 1 - this bypass does not touch the UPDATE at all')
  assert.equal(countKeyword(mutated, 'delete'), 1, 'expected the synthetic mutation to actually contain one DELETE keyword')
  assert.notEqual(countKeyword(mutated, 'delete'), 0, 'the zero-DELETE invariant must reject this exact bypass')
})

test('mutation self-check [Layer 3]: rejects a DELETE formatting variant (keyword and table name on separate lines, uppercase)', () => {
  const mutated = (
    LEGITIMATE_RELEASE_UPDATE +
    `
    DELETE
    FROM public.ai_usage_state
    WHERE user_id = v_user_id;
  `
  ).toLowerCase()
  assert.equal(countKeyword(mutated, 'delete'), 1)
  assert.notEqual(countKeyword(mutated, 'delete'), 0, 'the zero-DELETE invariant must reject this formatting variant too')
})

test('mutation self-check [Layer 3]: rejects an INSERT added to release_ai_usage (e.g. future row-recreation/reset logic)', () => {
  const mutated = (
    LEGITIMATE_RELEASE_UPDATE +
    `
    insert into public.ai_usage_state (user_id, minute_window_start, day_key)
    values (v_user_id, v_now, v_day_key)
    on conflict (user_id) do nothing;
  `
  ).toLowerCase()
  assert.equal(countKeyword(mutated, 'insert'), 1)
  assert.notEqual(countKeyword(mutated, 'insert'), 0, 'the zero-INSERT invariant must reject this')
})

test('mutation self-check [Layer 3]: rejects dynamic SQL via EXECUTE, even when the DML keyword inside the string would itself also be caught', () => {
  const mutated = (
    LEGITIMATE_RELEASE_UPDATE +
    `
    execute 'delete from public.ai_usage_state where user_id = ''' || v_user_id || '''';
  `
  ).toLowerCase()
  // The essential invariant is EXECUTE=0 - not reliance on the DML keyword
  // that happens to also appear inside the dynamic SQL string.
  assert.equal(countKeyword(mutated, 'execute'), 1)
  assert.notEqual(countKeyword(mutated, 'execute'), 0, 'the zero-EXECUTE invariant must reject this regardless of what the dynamic SQL string contains')
})

test('mutation self-check [Layer 3]: rejects MERGE and TRUNCATE additions', () => {
  const mergeMutated = (LEGITIMATE_RELEASE_UPDATE + `\n    merge into public.ai_usage_state using (select 1) as x on true when matched then do nothing;\n  `).toLowerCase()
  assert.equal(countKeyword(mergeMutated, 'merge'), 1)
  assert.notEqual(countKeyword(mergeMutated, 'merge'), 0)

  const truncateMutated = (LEGITIMATE_RELEASE_UPDATE + `\n    truncate public.ai_usage_state;\n  `).toLowerCase()
  assert.equal(countKeyword(truncateMutated, 'truncate'), 1)
  assert.notEqual(countKeyword(truncateMutated, 'truncate'), 0)
})

test('mutation self-check [Layer 3]: the legitimate release function alone (no DML additions) has zero prohibited keywords - no false positive', () => {
  for (const keyword of RELEASE_PROHIBITED_DML_KEYWORDS) {
    assert.equal(countKeyword(LEGITIMATE_RELEASE_UPDATE.toLowerCase(), keyword), 0)
  }
})

test('reserve_ai_usage: quota is consumed (day_count + 1, minute_count + 1) at reservation time, before any OpenAI call could occur, and is not refunded on this path', () => {
  assert.match(
    lowerReserveFn,
    /minute_count = v_minute_count \+ 1,\s*\n\s*day_key = v_day_key,\s*\n\s*day_count = v_day_count \+ 1/
  )
})
