import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Static-source check only: this is a .tsx file containing JSX, which
// Node's built-in TypeScript stripping does not compile (same reason as
// CharacterSidebar.test.ts). This repo has no jsdom/Testing Library, so a
// real hydration/render/DOM test is genuinely not possible here -- these
// assertions verify the source wiring, not runtime React behavior. Actual
// runtime coverage for the extracted pure logic lives in
// src/lib/themePreference.test.ts.

const dir = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(dir, 'ThemeProvider.tsx'), 'utf8')

function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

// --- Phase 1E (react-hooks/set-state-in-effect fix): core wiring -----------

test('ThemeProvider uses useSyncExternalStore (the hydration-safe mechanism replacing the removed synchronous setDark-in-effect)', () => {
  assert.match(source, /useSyncExternalStore/)
})

test('ThemeProvider no longer uses useState for the dark value (no independent React state to desync from the store)', () => {
  // Strip comment-only lines first: an explanatory comment describing what
  // changed legitimately mentions the old `useState(false)` pattern in
  // prose, which must not be mistaken for a real (code) useState call.
  const stripped = codeOnly(source)
  assert.equal(stripped.includes('useState'), false)
  assert.equal(stripped.includes('setDark'), false)
})

test('ThemeProvider\'s server snapshot returns exactly false (preserves the original SSR/first-client-render value)', () => {
  assert.match(source, /function getServerThemeSnapshot\(\): boolean \{\s*return false\s*\}/)
})

test('the effective theme snapshot is wired through the safe, never-throwing readSavedDarkPreference() helper, not a direct localStorage.getItem() call', () => {
  assert.equal(source.includes('localStorage.getItem'), false, 'a direct localStorage.getItem() call in the snapshot path can throw during render and crash the component')
  assert.match(source, /from '@\/lib\/themePreference'/)
  assert.match(source, /readSavedDarkPreference/)
  assert.match(source, /getThemeSnapshot/)
})

test('the snapshot falls back to shouldBeDarkAtHour(new Date().getHours()) when nothing is saved, matching the original clock-based auto logic', () => {
  assert.match(source, /shouldBeDarkAtHour\(new Date\(\)\.getHours\(\)\)/)
})

test('no direct synchronous React state setter remains inside any effect body (the exact pattern react-hooks/set-state-in-effect flagged)', () => {
  // useState itself is gone from this file (verified in the previous test),
  // so there is no destructured `[value, setValue]` React setter that could
  // possibly be called from an effect body. A broad "any set*(...)" regex
  // would produce false positives against legitimate, unrelated Web APIs
  // this file still calls (setAttribute, setInterval, setItem) -- those are
  // not React state setters and are exactly what the lint rule's own
  // guidance allows an effect body to do ("update external systems").
  const stripped = codeOnly(source)
  assert.equal(stripped.includes('useState'), false, 'no useState means no React setter identifier can exist to call')
  assert.equal(/const \[\s*\w+\s*,\s*set\w+\s*\]\s*=\s*useState/.test(stripped), false, 'no destructured useState setter is declared anywhere')
})

test('no eslint-disable for react-hooks/set-state-in-effect or react-hooks/purity was added', () => {
  const disableLines = source.split('\n').filter((line) => line.includes('eslint-disable'))
  for (const line of disableLines) {
    assert.equal(/set-state-in-effect|react-hooks\/purity/.test(line), false, `unexpected disable: ${line}`)
  }
})

// --- DOM / data-dark contract (unchanged) -----------------------------------

test('applyDark still sets the exact data-dark attribute contract (unchanged selector)', () => {
  assert.match(source, /document\.documentElement\.setAttribute\(\s*'data-dark',\s*isDark \? 'true' : 'false'\s*\)/)
})

test('DOM synchronization happens in a dedicated effect keyed on the derived dark value, calling only applyDark (no React state setter -- the pattern the lint rule itself allows)', () => {
  assert.match(source, /useEffect\(\(\) => \{\s*applyDark\(dark\)\s*\}, \[dark\]\)/)
})

// --- Clock-boundary / interval contract (unchanged) -------------------------

test('the 60-second interval cadence is unchanged', () => {
  assert.match(source, /60_000/)
})

test('the exact 6:00/19:00 minute-0 boundary condition is unchanged', () => {
  assert.match(source, /m === 0 && \(h === 6 \|\| h === 19\)/)
})

test('the boundary branch still removes the saved preference key (returns to clock-driven auto mode)', () => {
  assert.match(source, /localStorage\.removeItem\(FITMATE_DARK_STORAGE_KEY\)/)
})

test('interval cleanup (clearInterval) is preserved', () => {
  assert.match(source, /return \(\) => clearInterval\(interval\)/)
})

// --- toggleDark / manual override contract (unchanged) ----------------------

test('toggleDark still persists String(next) to the storage key', () => {
  assert.match(source, /localStorage\.setItem\(FITMATE_DARK_STORAGE_KEY, String\(next\)\)/)
})

test('toggleDark inverts the current effective dark value (const next = !dark)', () => {
  assert.match(source, /const next = !dark/)
})

// --- Public context shape (unchanged) ---------------------------------------

test('ThemeContext still exposes exactly { dark, toggleDark }', () => {
  assert.match(source, /ThemeContext\.Provider value=\{\{ dark, toggleDark \}\}/)
})

test('useTheme() is still exported and still wraps useContext(ThemeContext)', () => {
  assert.match(source, /export function useTheme\(\) \{\s*return useContext\(ThemeContext\)\s*\}/)
})

// --- No new, out-of-scope features were added -------------------------------

test('no OS/system-theme feature (prefers-color-scheme / matchMedia) was added', () => {
  assert.equal(source.includes('prefers-color-scheme'), false)
  assert.equal(source.includes('matchMedia'), false)
})

test('no storage event / cross-tab listener was added', () => {
  assert.equal(source.includes("addEventListener('storage'"), false)
  assert.equal(source.includes('addEventListener("storage"'), false)
})

test('no setTimeout/queueMicrotask-based lint evasion was introduced', () => {
  assert.equal(source.includes('setTimeout'), false)
  assert.equal(source.includes('queueMicrotask'), false)
})

test('no mounted/hydrated state was added', () => {
  const stripped = codeOnly(source).toLowerCase()
  assert.equal(stripped.includes('mounted'), false)
  assert.equal(stripped.includes('hydrated'), false)
})
