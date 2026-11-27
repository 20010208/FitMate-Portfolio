import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

// Importing generate-article.mjs must never trigger network calls, Supabase
// client construction, or process.exit -- all side-effecting work lives
// inside main(), which this file never calls.
const moduleUrl = pathToFileURL(path.resolve(import.meta.dirname, 'generate-article.mjs')).href
const { resolveExistingPosts } = await import(moduleUrl)

// resolveExistingPosts() is the exact decision logic main() runs on the raw
// Supabase { data, error } result for the existing-published-posts query.
// Exercising it directly with real execution (not just static-source
// checks) is what lets this test suite verify the fail-closed control flow
// without mocking the entire @supabase/supabase-js client / OpenAI SDK.

test('A: query success with published rows -> ok, posts returned unchanged', () => {
  const rows = [{ slug: 'abc', title: 'ABC' }, { slug: 'def', title: 'DEF' }]
  const result = resolveExistingPosts({ data: rows, error: null })
  assert.deepEqual(result, { ok: true, posts: rows })
})

test('E: query success with zero rows (data=[], error=null) is NOT treated as an error -- this is the normal "first article ever" case', () => {
  const result = resolveExistingPosts({ data: [], error: null })
  assert.deepEqual(result, { ok: true, posts: [] })
})

test('C/D: query error -> not ok, fail-closed (caller must stop before calling OpenAI or inserting)', () => {
  const result = resolveExistingPosts({ data: null, error: { message: 'connection refused' } })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'connection refused')
})

test('query error with a missing/empty message still fails closed with a safe fallback reason (never throws)', () => {
  assert.doesNotThrow(() => {
    const result = resolveExistingPosts({ data: null, error: {} })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'unknown_error')
  })
})

test('error takes priority even if data happens to be non-null alongside it (defensive: never trust data when error is set)', () => {
  const result = resolveExistingPosts({ data: [{ slug: 'x', title: 'X' }], error: { message: 'boom' } })
  assert.equal(result.ok, false)
})

test('a missing/undefined data on success is treated as an empty array, not a crash', () => {
  assert.doesNotThrow(() => {
    const result = resolveExistingPosts({ data: undefined, error: null })
    assert.deepEqual(result, { ok: true, posts: [] })
  })
})
