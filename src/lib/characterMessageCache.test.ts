import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { parseCacheEntry, storageKeyFor, getCachedResult, setCachedResult, removeCachedResult, readRawCacheEntry } from './characterMessageCache.ts'

// --- parseCacheEntry: pure TTL/parse logic, no localStorage involved -----

test('parseCacheEntry: absent (null raw) -> status "absent"', () => {
  assert.deepEqual(parseCacheEntry(null), { status: 'absent' })
})

test('parseCacheEntry: empty string raw -> status "absent" (falsy, same as null)', () => {
  assert.deepEqual(parseCacheEntry(''), { status: 'absent' })
})

test('parseCacheEntry: valid entry within TTL -> status "hit" with exact message/expression', () => {
  const raw = JSON.stringify({ message: 'hello', expression: 'happy', timestamp: Date.now() })
  const result = parseCacheEntry(raw)
  assert.equal(result.status, 'hit')
  if (result.status === 'hit') {
    assert.deepEqual(result.result, { message: 'hello', expression: 'happy' })
  }
})

test('parseCacheEntry: valid entry with no expression field -> hit, expression undefined', () => {
  const raw = JSON.stringify({ message: 'hi', timestamp: Date.now() })
  const result = parseCacheEntry(raw)
  assert.equal(result.status, 'hit')
  if (result.status === 'hit') {
    assert.equal(result.result.message, 'hi')
    assert.equal(result.result.expression, undefined)
  }
})

// Test-quality fix (Codex note, cache exception remediation phase): the
// exact-TTL-boundary test previously computed its fixture timestamp with a
// real Date.now() call and then relied on parseCacheEntry()'s own, separate
// Date.now() call landing on the exact same millisecond -- on a slow CI run
// the two calls could observe different milliseconds, making "exactly at
// the boundary" occasionally see itself as 1ms+ past it. mock.timers freezes
// Date.now() for the duration of the test so both reads are guaranteed
// identical. This is a test-only determinism fix; parseCacheEntry's runtime
// arithmetic is unchanged.
test('parseCacheEntry: entry exactly at the 6-hour TTL boundary is still a hit (not yet expired) [Date.now frozen for determinism]', () => {
  const TTL_MS = 6 * 60 * 60 * 1000
  const frozenNow = 1_700_000_000_000
  mock.timers.enable({ apis: ['Date'], now: frozenNow })
  try {
    const raw = JSON.stringify({ message: 'boundary', timestamp: frozenNow - TTL_MS })
    assert.equal(parseCacheEntry(raw).status, 'hit')
  } finally {
    mock.timers.reset()
  }
})

test('parseCacheEntry: entry 1ms past the 6-hour TTL -> "expired" [Date.now frozen for determinism]', () => {
  const TTL_MS = 6 * 60 * 60 * 1000
  const frozenNow = 1_700_000_000_000
  mock.timers.enable({ apis: ['Date'], now: frozenNow })
  try {
    const raw = JSON.stringify({ message: 'stale', timestamp: frozenNow - TTL_MS - 1 })
    assert.deepEqual(parseCacheEntry(raw), { status: 'expired' })
  } finally {
    mock.timers.reset()
  }
})

test('parseCacheEntry: malformed (non-JSON) raw -> "malformed", not "expired" (must not be treated as a TTL case)', () => {
  assert.deepEqual(parseCacheEntry('not json at all {{{'), { status: 'malformed' })
})

// Test-quality fix (Codex note): this test's name previously claimed the
// missing-timestamp case becomes "expired" via the NaN comparison, but the
// assertion below has always checked for status 'hit' -- NaN > TTL_MS is
// false, so the entry is NOT treated as expired; it falls through to a hit
// with message present and expression undefined. The name is corrected
// here to describe the actual (assert-verified) outcome; the runtime
// behavior itself is unchanged.
test('parseCacheEntry: valid JSON but missing timestamp field -> "hit" (NaN comparison is not "> TTL_MS", so it is NOT treated as expired; matches original try/catch-free arithmetic, not a thrown error)', () => {
  const raw = JSON.stringify({ message: 'no ts' })
  // Date.now() - undefined = NaN, and NaN > TTL_MS is false in JS, so the
  // ORIGINAL code's `if (Date.now() - entry.timestamp > TTL_MS)` would be
  // false here too -- this fixture proves parseCacheEntry preserves that
  // exact (slightly odd but original) arithmetic rather than defensively
  // treating a missing timestamp as instantly expired or malformed.
  assert.equal(parseCacheEntry(raw).status, 'hit')
})

// --- Cache exception remediation (Codex Medium finding): parseCacheEntry
// must be total for any string input -- valid JSON that is not a plain
// object (null/array/number/string/boolean) must resolve to "malformed",
// never throw. Reproduces Codex's exact repro: parseCacheEntry('null')
// previously threw a TypeError because `entry.timestamp` was accessed
// without first confirming `entry` was an object. --------------------------

test('parseCacheEntry(\'null\'): valid JSON, not an object -> "malformed", does not throw', () => {
  assert.doesNotThrow(() => parseCacheEntry('null'))
  assert.deepEqual(parseCacheEntry('null'), { status: 'malformed' })
})

test('parseCacheEntry(\'[]\'): valid JSON array -> "malformed", does not throw', () => {
  assert.doesNotThrow(() => parseCacheEntry('[]'))
  assert.deepEqual(parseCacheEntry('[]'), { status: 'malformed' })
})

test('parseCacheEntry(\'123\'): valid JSON number -> "malformed", does not throw', () => {
  assert.doesNotThrow(() => parseCacheEntry('123'))
  assert.deepEqual(parseCacheEntry('123'), { status: 'malformed' })
})

test('parseCacheEntry(\'"abc"\'): valid JSON string -> "malformed", does not throw', () => {
  assert.doesNotThrow(() => parseCacheEntry('"abc"'))
  assert.deepEqual(parseCacheEntry('"abc"'), { status: 'malformed' })
})

test('parseCacheEntry(\'true\'): valid JSON boolean -> "malformed", does not throw', () => {
  assert.doesNotThrow(() => parseCacheEntry('true'))
  assert.deepEqual(parseCacheEntry('true'), { status: 'malformed' })
})

test('parseCacheEntry: invalid (non-parseable) JSON -> "malformed", does not throw', () => {
  assert.doesNotThrow(() => parseCacheEntry('not json at all {{{'))
  assert.deepEqual(parseCacheEntry('not json at all {{{'), { status: 'malformed' })
})

test('parseCacheEntry: a real, valid object-shaped entry is unaffected by the shape guard (regression guard against over-broadening the check)', () => {
  const raw = JSON.stringify({ message: 'still works', expression: 'happy', timestamp: Date.now() })
  const result = parseCacheEntry(raw)
  assert.equal(result.status, 'hit')
  if (result.status === 'hit') {
    assert.deepEqual(result.result, { message: 'still works', expression: 'happy' })
  }
})

// --- storageKeyFor ----------------------------------------------------------

test('storageKeyFor: exact prefix format unchanged (fitmate_char_<key>)', () => {
  assert.equal(storageKeyFor('dashboard_leo_20260829'), 'fitmate_char_dashboard_leo_20260829')
})

// --- getCachedResult / setCachedResult / removeCachedResult: localStorage-
// backed behavior, using a minimal fake localStorage (no jsdom available in
// this repo; a plain object satisfying getItem/setItem/removeItem is
// sufficient and does not require any new dependency). -----------------------

function withFakeBrowserGlobals<T>(fn: () => T): T {
  const store = new Map<string, string>()
  const fakeLocalStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  }
  const g = globalThis as unknown as { window?: unknown; localStorage?: unknown }
  const hadWindow = 'window' in g
  const prevWindow = g.window
  const prevLocalStorage = g.localStorage
  g.window = {}
  g.localStorage = fakeLocalStorage
  try {
    return fn()
  } finally {
    if (hadWindow) g.window = prevWindow
    else delete g.window
    g.localStorage = prevLocalStorage
  }
}

test('getCachedResult: no window (SSR) -> null, regardless of localStorage content', () => {
  const g = globalThis as unknown as { window?: unknown }
  assert.equal('window' in g, false, 'this test assumes no window global exists in the plain node:test environment')
  assert.equal(getCachedResult('any-key'), null)
})

test('getCachedResult/setCachedResult round-trip: a freshly-set entry is returned as-is', () => {
  withFakeBrowserGlobals(() => {
    setCachedResult('k1', 'msg', 'happy')
    assert.deepEqual(getCachedResult('k1'), { message: 'msg', expression: 'happy' })
  })
})

test('getCachedResult: expired entry returns null AND removes the underlying localStorage entry (side effect preserved)', () => {
  withFakeBrowserGlobals(() => {
    const TTL_MS = 6 * 60 * 60 * 1000
    localStorage.setItem(storageKeyFor('k2'), JSON.stringify({ message: 'old', timestamp: Date.now() - TTL_MS - 1 }))
    assert.equal(getCachedResult('k2'), null)
    assert.equal(localStorage.getItem(storageKeyFor('k2')), null, 'expired entry must be removed from localStorage')
  })
})

test('getCachedResult: malformed entry returns null and does NOT remove the localStorage entry (matches original behavior)', () => {
  withFakeBrowserGlobals(() => {
    localStorage.setItem(storageKeyFor('k3'), 'not json')
    assert.equal(getCachedResult('k3'), null)
    assert.equal(localStorage.getItem(storageKeyFor('k3')), 'not json', 'malformed entries are left in place, only expired ones are cleaned up')
  })
})

test('removeCachedResult: removes the exact storage key', () => {
  withFakeBrowserGlobals(() => {
    setCachedResult('k4', 'msg')
    removeCachedResult('k4')
    assert.equal(getCachedResult('k4'), null)
    assert.equal(localStorage.getItem(storageKeyFor('k4')), null)
  })
})

// --- readRawCacheEntry: the single safe-read path used by CharacterSidebar's
// render-time useSyncExternalStore snapshot (Codex Medium finding). A
// blocked/unavailable Storage (localStorage.getItem throwing) must NOT
// escape as a render-time exception -- it must be treated as a cache miss
// (null), exactly like getCachedResult() already did via its own try/catch.
// --------------------------------------------------------------------------

function withThrowingLocalStorageGetItem<T>(fn: () => T): T {
  const throwingLocalStorage = {
    getItem: () => { throw new Error('Storage is blocked/unavailable') },
    setItem: () => { throw new Error('Storage is blocked/unavailable') },
    removeItem: () => { throw new Error('Storage is blocked/unavailable') },
  }
  const g = globalThis as unknown as { window?: unknown; localStorage?: unknown }
  const hadWindow = 'window' in g
  const prevWindow = g.window
  const prevLocalStorage = g.localStorage
  g.window = {}
  g.localStorage = throwingLocalStorage
  try {
    return fn()
  } finally {
    if (hadWindow) g.window = prevWindow
    else delete g.window
    g.localStorage = prevLocalStorage
  }
}

test('readRawCacheEntry: localStorage.getItem() throwing does not throw and returns null (safe cache-miss fallback)', () => {
  withThrowingLocalStorageGetItem(() => {
    assert.doesNotThrow(() => readRawCacheEntry('any-key'))
    assert.equal(readRawCacheEntry('any-key'), null)
  })
})

test('readRawCacheEntry: no window (SSR) -> null, without touching localStorage at all', () => {
  const g = globalThis as unknown as { window?: unknown }
  assert.equal('window' in g, false, 'this test assumes no window global exists in the plain node:test environment')
  assert.equal(readRawCacheEntry('any-key'), null)
})

test('readRawCacheEntry: normal case still returns the exact raw stored string (safe path does not change existing behavior)', () => {
  withFakeBrowserGlobals(() => {
    setCachedResult('k5', 'hello', 'happy')
    const raw = readRawCacheEntry('k5')
    assert.equal(typeof raw, 'string')
    assert.deepEqual(JSON.parse(raw as string).message, 'hello')
  })
})

test('getCachedResult: still safely returns null (not a throw) when localStorage.getItem() throws (getCachedResult\'s own try/catch plus the shared safe-read path both cover this)', () => {
  withThrowingLocalStorageGetItem(() => {
    assert.doesNotThrow(() => getCachedResult('any-key'))
    assert.equal(getCachedResult('any-key'), null)
  })
})
