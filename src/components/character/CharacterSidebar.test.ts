import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Static-source check only: this is a .tsx file containing JSX, which
// Node's built-in TypeScript stripping does not compile (same reason as
// publicBlogCache.test.ts and the other .tsx-adjacent checks in this repo).

const dir = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(dir, 'CharacterSidebar.tsx'), 'utf8')

// Codex-audit fix: CharacterSidebar picked its fallback expression/message
// with Math.random() inside a useMemo that runs during render. SSR and the
// client's first render happen at different moments (and Math.random() is
// obviously not seeded identically), so the two passes could pick different
// fallbacks -- a real React hydration error #418 in the logged-in dashboard.

test('CharacterSidebar never calls Math.random() (fallback expression/message must be deterministic across SSR and client first render)', () => {
  // Strip comment-only lines first so an explanatory comment that happens to
  // mention "Math.random()" in prose doesn't produce a false positive here.
  const codeOnly = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  assert.equal(codeOnly.includes('Math.random('), false)
})

test('CharacterSidebar no longer imports getRandomExpression (the only call site was the render-time Math.random() picker that was removed)', () => {
  assert.equal(source.includes('getRandomExpression'), false)
})

test('the fallback expression defaults to a fixed literal instead of a random pick', () => {
  assert.match(source, /const fallbackExpression = useMemo\(\(\) => expressionProp \?\? 'normal', \[expressionProp\]\)/)
})

test('the fallback message defaults to the first entry of defaultMessages instead of a random pick', () => {
  assert.match(source, /const fallbackMessage = useMemo\(\(\) => char\.defaultMessages\[0\], \[char\]\)/)
})

// --- Phase 1D (react-hooks/set-state-in-effect fix): static wiring checks --
// These are STATIC source assertions only, not runtime component/hook
// tests -- this repo has no jsdom/Testing Library, and Node's runtime
// TypeScript support cannot import a .tsx file containing JSX (verified:
// importing this file's own CharacterSidebar.tsx via `node --input-type=module`
// fails with "Unknown file extension .tsx"). The actual dedup/cache
// runtime behavior is covered separately by real (non-static) node:test
// suites against the plain .ts modules it imports:
// src/lib/characterMessageRequest.test.ts and
// src/lib/characterMessageCache.test.ts.

test('CharacterSidebar uses useSyncExternalStore (the hydration-safe mechanism replacing the removed synchronous cache-hit setState)', () => {
  assert.match(source, /useSyncExternalStore/)
})

test('CharacterSidebar no longer contains a synchronous setAiMessage/setAiExpression call directly in an effect body (the exact pattern react-hooks/set-state-in-effect flagged)', () => {
  // Strip comment-only lines first so this file's own explanatory comments
  // (which mention the old setAiMessage/setAiExpression names in prose to
  // describe what changed) don't produce a false positive.
  const codeOnly = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  assert.equal(codeOnly.includes('setAiMessage'), false)
  assert.equal(codeOnly.includes('setAiExpression'), false)
})

test('CharacterSidebar no longer declares its own inFlightCharacterMessages Map (dedup logic now lives in and is imported from characterMessageRequest.ts, not duplicated)', () => {
  assert.equal(source.includes('inFlightCharacterMessages'), false)
  assert.match(source, /from '@\/lib\/characterMessageRequest'/)
  assert.match(source, /getOrCreateCharacterMessageRequest/)
})

test('CharacterSidebar still calls the dedup helper (getOrCreateCharacterMessageRequest) rather than calling a raw request function directly', () => {
  assert.match(source, /getOrCreateCharacterMessageRequest\(/)
})

test('CharacterSidebar\'s effect still declares and returns a `cancelled` flag (stale-response guard preserved)', () => {
  assert.match(source, /let cancelled = false/)
  assert.match(source, /return \(\) => \{\s*cancelled = true\s*\}/)
})

test('CharacterSidebar\'s async result handling checks `cancelled` before applying setFetchedResult (stale responses for a superseded key/unmount must not update state)', () => {
  assert.match(source, /if \(cancelled \|\| !result\) return/)
})

test('the async fetch result is tagged with the exact cacheKey it was fetched for (setFetchedResult({ key: cacheKey, ...}))', () => {
  assert.match(source, /setFetchedResult\(\{ key: cacheKey, message: result\.message, expression: result\.expression \}\)/)
})

test('no setTimeout/Promise.resolve/queueMicrotask-based lint evasion was introduced around state updates', () => {
  assert.equal(source.includes('setTimeout'), false)
  assert.equal(source.includes('queueMicrotask'), false)
  assert.equal(/Promise\.resolve\(\)\s*\.then/.test(source), false)
})

test('no eslint-disable for react-hooks/set-state-in-effect or react-hooks/purity was added (the pre-existing @next/next/no-img-element disables are unrelated and unaffected)', () => {
  const disableLines = source.split('\n').filter((line) => line.includes('eslint-disable'))
  assert.ok(disableLines.length > 0, 'sanity check: the pre-existing no-img-element disables must still be present')
  for (const line of disableLines) {
    assert.equal(/set-state-in-effect|react-hooks\/purity/.test(line), false, `unexpected disable: ${line}`)
  }
})

// --- Cache exception remediation (Codex Medium finding): the render-time
// cache snapshot must go through the one safe-read helper, never call
// localStorage.getItem() directly (a throw there would previously crash
// rendering). ----------------------------------------------------------------

test('CharacterSidebar\'s render-time cache snapshot uses the safe readRawCacheEntry() helper, not a direct localStorage.getItem() call', () => {
  assert.equal(source.includes('localStorage.getItem'), false, 'a direct localStorage.getItem() call in this file can throw during render and crash the component')
  assert.match(source, /from '@\/lib\/characterMessageCache'/)
  assert.match(source, /readRawCacheEntry/)
  assert.match(source, /\(\) => \(cacheKey \? readRawCacheEntry\(cacheKey\) : null\)/)
})
