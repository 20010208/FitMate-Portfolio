import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Codex-audit fix: getExpressionFromContext() used Math.random() in its
// 17-21h branch. DashboardClient calls this during its initial render (both
// SSR and the client's first render), so a random pick there could return a
// different expression/character image between the two passes -- a real
// React hydration error #418. getExpressionFromContext() must therefore be
// a pure, deterministic function: same input -> always the same output.
//
// This repo's tsconfig (moduleResolution: "bundler") rejects a relative
// import with an explicit ".ts" extension (TS5097), while node's built-in
// test runner requires that same explicit extension to resolve a relative
// ESM import at runtime -- a structural gap already present in every
// existing *.test.ts file that imports a sibling module (see
// dashboardDateId.test.ts). To exercise the real, shipped implementation
// here without adding another such import, the exact function source is
// extracted from characters.ts and executed via `new Function(...)`
// (same technique as DashboardClient.calcAge.test.ts).

const dir = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(dir, 'characters.ts'), 'utf8')

const match = source.match(
  /export function getExpressionFromContext\(\{([\s\S]*?)\}: \{[\s\S]*?\}\): ExpressionId \{([\s\S]*?)\n\}/
)
assert.ok(match, 'getExpressionFromContext source not found in characters.ts')
const destructuredParams = match![1]
const body = match![2]

const codeOnly = body.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
assert.equal(codeOnly.includes('Math.random('), false)
assert.equal(codeOnly.includes('Date.now('), false)
assert.equal(codeOnly.includes('crypto.randomUUID'), false)

const getExpressionFromContext = new Function(`{ ${destructuredParams} }`, body) as (input: {
  currentHour: number
  todayEntryCount: number
  daysSinceLastEntry: number
}) => string

test('getExpressionFromContext contains no Math.random()/Date.now()/crypto.randomUUID (must not introduce randomness into the initial-render path)', () => {
  // Assertion already ran above at module scope; this test exists so the
  // check shows up in the test report explicitly.
  assert.equal(codeOnly.includes('Math.random('), false)
})

test('same input always returns the same expression, called repeatedly', () => {
  const input = { currentHour: 18, todayEntryCount: 1, daysSinceLastEntry: 2 }
  const results = new Set(Array.from({ length: 50 }, () => getExpressionFromContext(input)))
  assert.equal(results.size, 1)
})

test('7+ days since last entry always yields angry, regardless of hour/entry count', () => {
  for (const currentHour of [0, 9, 18, 23]) {
    for (const todayEntryCount of [0, 1, 2, 3]) {
      assert.equal(getExpressionFromContext({ currentHour, todayEntryCount, daysSinceLastEntry: 7 }), 'angry')
      assert.equal(getExpressionFromContext({ currentHour, todayEntryCount, daysSinceLastEntry: 30 }), 'angry')
    }
  }
})

test('2+ entries today always yields fun (when not overridden by the 7-day-inactive rule)', () => {
  for (const currentHour of [0, 9, 18, 23]) {
    assert.equal(getExpressionFromContext({ currentHour, todayEntryCount: 2, daysSinceLastEntry: 0 }), 'fun')
    assert.equal(getExpressionFromContext({ currentHour, todayEntryCount: 5, daysSinceLastEntry: 3 }), 'fun')
  }
})

test('21-24h band: happy with an entry today, sad with none', () => {
  assert.equal(getExpressionFromContext({ currentHour: 21, todayEntryCount: 1, daysSinceLastEntry: 0 }), 'happy')
  assert.equal(getExpressionFromContext({ currentHour: 23, todayEntryCount: 1, daysSinceLastEntry: 0 }), 'happy')
  assert.equal(getExpressionFromContext({ currentHour: 21, todayEntryCount: 0, daysSinceLastEntry: 1 }), 'sad')
})

test('17-21h band: deterministic fixed picks (no randomness) for 1 entry vs. 0 entries', () => {
  assert.equal(getExpressionFromContext({ currentHour: 17, todayEntryCount: 1, daysSinceLastEntry: 0 }), 'normal')
  assert.equal(getExpressionFromContext({ currentHour: 20, todayEntryCount: 1, daysSinceLastEntry: 0 }), 'normal')
  assert.equal(getExpressionFromContext({ currentHour: 17, todayEntryCount: 0, daysSinceLastEntry: 1 }), 'sad')
  assert.equal(getExpressionFromContext({ currentHour: 20, todayEntryCount: 0, daysSinceLastEntry: 3 }), 'sad')
})

test('0-17h band: always normal', () => {
  for (const currentHour of [0, 6, 12, 16]) {
    assert.equal(getExpressionFromContext({ currentHour, todayEntryCount: 0, daysSinceLastEntry: 1 }), 'normal')
    assert.equal(getExpressionFromContext({ currentHour, todayEntryCount: 1, daysSinceLastEntry: 0 }), 'normal')
  }
})

// --- Codex監査 修正: daysSinceLastEntryのDST依存(push blocker) -------------
// Codexの再現例: latestDate 2026-03-02, referenceDate 2026-03-09 は
// calendarDayDifference()で常に7(暦日差)になることを dashboardDateId.test.ts
// の実import経由のテストで独立に検証済み("2026-03-02 -> 2026-03-09 is 7
// (Codex-reported DST-start repro case)")。ここではその7という値を
// getExpressionFromContext()へ渡した場合に、timezoneに関係なく常にangryへ
// 決定的に分岐することを確認する。旧実装(ローカルmidnight差÷86,400,000)では
// America/Los_Angeles相当のtimezoneで6日と誤算出されえたため、対比として
// daysSinceLastEntry=6の場合は7日ルールが適用されずangryにならないことも
// 確認し、7日境界が実際に意味を持つことを示す。

test('Codex repro: latestDate 2026-03-02 / referenceDate 2026-03-09 (daysSinceLastEntry=7 via calendarDayDifference), todayEntryCount=1, currentHour=18 -> always angry', () => {
  assert.equal(getExpressionFromContext({ currentHour: 18, todayEntryCount: 1, daysSinceLastEntry: 7 }), 'angry')
})

test('the old miscalculated value (6 days, as DST-affected timezones could have produced under the removed getTime()-division implementation) does NOT trigger the 7-day-inactive angry rule -- proves the 7-day boundary is load-bearing', () => {
  const result = getExpressionFromContext({ currentHour: 18, todayEntryCount: 1, daysSinceLastEntry: 6 })
  assert.notEqual(result, 'angry')
})

test('identical time-band/entry-count/last-entry-date combinations always agree with each other (exhaustive small grid)', () => {
  for (let currentHour = 0; currentHour < 24; currentHour++) {
    for (let todayEntryCount = 0; todayEntryCount < 4; todayEntryCount++) {
      for (const daysSinceLastEntry of [0, 1, 6, 7, 8]) {
        const input = { currentHour, todayEntryCount, daysSinceLastEntry }
        const a = getExpressionFromContext(input)
        const b = getExpressionFromContext({ ...input })
        assert.equal(a, b)
      }
    }
  }
})
