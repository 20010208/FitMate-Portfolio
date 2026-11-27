import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FITMATE_DARK_STORAGE_KEY, shouldBeDarkAtHour, readSavedDarkPreference } from './themePreference.ts'

// --- shouldBeDarkAtHour: pure clock-based determination, no Date/timezone
// mocking needed since it takes an explicit hour. Preserves the exact
// original `h >= 19 || h < 6` condition. ------------------------------------

test('shouldBeDarkAtHour: hour 0 -> dark', () => {
  assert.equal(shouldBeDarkAtHour(0), true)
})

test('shouldBeDarkAtHour: hour 5 -> dark', () => {
  assert.equal(shouldBeDarkAtHour(5), true)
})

test('shouldBeDarkAtHour: hour 6 -> light (start of daytime)', () => {
  assert.equal(shouldBeDarkAtHour(6), false)
})

test('shouldBeDarkAtHour: hour 18 -> light (last daytime hour)', () => {
  assert.equal(shouldBeDarkAtHour(18), false)
})

test('shouldBeDarkAtHour: hour 19 -> dark (start of night)', () => {
  assert.equal(shouldBeDarkAtHour(19), true)
})

test('shouldBeDarkAtHour: hour 23 -> dark', () => {
  assert.equal(shouldBeDarkAtHour(23), true)
})

// --- FITMATE_DARK_STORAGE_KEY: exact key unchanged -------------------------

test('FITMATE_DARK_STORAGE_KEY: exact literal unchanged', () => {
  assert.equal(FITMATE_DARK_STORAGE_KEY, 'fitmate-dark')
})

// --- readSavedDarkPreference: safe (never-throwing) raw read ---------------

function withFakeBrowserGlobals<T>(localStorageImpl: {
  getItem: (k: string) => string | null
}, fn: () => T): T {
  const g = globalThis as unknown as { window?: unknown; localStorage?: unknown }
  const hadWindow = 'window' in g
  const prevWindow = g.window
  const prevLocalStorage = g.localStorage
  g.window = {}
  g.localStorage = localStorageImpl
  try {
    return fn()
  } finally {
    if (hadWindow) g.window = prevWindow
    else delete g.window
    g.localStorage = prevLocalStorage
  }
}

test('readSavedDarkPreference: no window (SSR) -> null', () => {
  const g = globalThis as unknown as { window?: unknown }
  assert.equal('window' in g, false, 'this test assumes no window global exists in the plain node:test environment')
  assert.equal(readSavedDarkPreference(), null)
})

test('readSavedDarkPreference: no saved key -> null', () => {
  withFakeBrowserGlobals({ getItem: () => null }, () => {
    assert.equal(readSavedDarkPreference(), null)
  })
})

test("readSavedDarkPreference: saved 'true' -> returns 'true' verbatim", () => {
  withFakeBrowserGlobals({ getItem: (k) => (k === FITMATE_DARK_STORAGE_KEY ? 'true' : null) }, () => {
    assert.equal(readSavedDarkPreference(), 'true')
  })
})

test("readSavedDarkPreference: saved 'false' -> returns 'false' verbatim", () => {
  withFakeBrowserGlobals({ getItem: (k) => (k === FITMATE_DARK_STORAGE_KEY ? 'false' : null) }, () => {
    assert.equal(readSavedDarkPreference(), 'false')
  })
})

test('readSavedDarkPreference: localStorage.getItem throws -> null, does not throw', () => {
  withFakeBrowserGlobals(
    {
      getItem: () => {
        throw new Error('Storage is blocked/unavailable')
      },
    },
    () => {
      assert.doesNotThrow(() => readSavedDarkPreference())
      assert.equal(readSavedDarkPreference(), null)
    }
  )
})
