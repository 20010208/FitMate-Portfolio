import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAllPostsResult, parsePostBySlugResult } from './blogResultParser.ts'

const ROW = {
  slug: 'sample-post',
  title: 'Sample',
  description: 'desc',
  category: '筋トレ',
  published_at: '2026-07-01',
  reading_minutes: 5,
  content: '<p>hi</p>',
  og_image: null,
}

// --- parseAllPostsResult ----------------------------------------------------

test('parseAllPostsResult: data present, no error -> returns the rows unchanged', () => {
  const result = parseAllPostsResult({ data: [ROW], error: null })
  assert.deepEqual(result, [ROW])
})

test('parseAllPostsResult: no data, no error -> [] (a genuine "zero published posts" state)', () => {
  assert.deepEqual(parseAllPostsResult({ data: null, error: null }), [])
  assert.deepEqual(parseAllPostsResult({ data: [], error: null }), [])
})

test('parseAllPostsResult: error present -> throws, even if data happens to be non-null', () => {
  assert.throws(() => parseAllPostsResult({ data: null, error: { message: 'connection refused' } }))
  assert.throws(() => parseAllPostsResult({ data: [ROW], error: { message: 'connection refused' } }))
})

test('parseAllPostsResult: thrown error message is fixed and does not leak the raw Supabase error', () => {
  try {
    parseAllPostsResult({ data: null, error: { message: 'password authentication failed for user "postgres"', code: '28P01' } })
    assert.fail('expected a throw')
  } catch (e) {
    const message = (e as Error).message
    assert.equal(message, 'Failed to load blog posts')
    assert.equal(message.includes('postgres'), false)
    assert.equal(message.includes('28P01'), false)
  }
})

// --- parsePostBySlugResult ---------------------------------------------------

test('parsePostBySlugResult: data present, no error -> returns the row unchanged', () => {
  assert.deepEqual(parsePostBySlugResult({ data: ROW, error: null }), ROW)
})

test('parsePostBySlugResult: no data, no error -> undefined (a genuine "post not found")', () => {
  assert.equal(parsePostBySlugResult({ data: null, error: null }), undefined)
})

test('parsePostBySlugResult: error present -> throws instead of resolving to "not found"', () => {
  assert.throws(() => parsePostBySlugResult({ data: null, error: { message: 'network error' } }))
})

test('parsePostBySlugResult: maybeSingle() duplicate-row error also throws (not treated as "not found")', () => {
  // Supabase's maybeSingle() sets `error` (PGRST116-style) when more than one
  // row matches, even though a caller might expect `data` to just be null.
  assert.throws(() => parsePostBySlugResult({ data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } }))
})

test('parsePostBySlugResult: thrown error message is fixed and does not leak the raw Supabase error', () => {
  try {
    parsePostBySlugResult({ data: null, error: { message: 'relation "blogs" does not exist' } })
    assert.fail('expected a throw')
  } catch (e) {
    const message = (e as Error).message
    assert.equal(message, 'Failed to load blog post')
    assert.equal(message.includes('relation'), false)
  }
})
