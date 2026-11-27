import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

// Dynamic import via a computed file:// URL rather than a static
// `from './relatedArticles.ts'` specifier — avoids standalone `tsc --noEmit`
// TS5097 (see src/lib/security/revalidateAuth.test.ts for the same
// pattern/reasoning) while still exercising the real module under
// `node --test`.
const moduleUrl = pathToFileURL(path.resolve(import.meta.dirname, 'relatedArticles.ts')).href
const { getRelatedArticles } = await import(moduleUrl)

function post(slug: string, category: string) {
  return { slug, category }
}

test('same category only: excludes posts from other categories', () => {
  const allPosts = [post('a', 'ダイエット'), post('b', '筋トレ'), post('c', 'ダイエット')]
  const result = getRelatedArticles(allPosts, 'a', 'ダイエット')
  assert.deepEqual(result.map((p: { slug: string }) => p.slug), ['c'])
})

test('current article is always excluded, even if it would otherwise match', () => {
  const allPosts = [post('a', 'ダイエット'), post('b', 'ダイエット')]
  const result = getRelatedArticles(allPosts, 'a', 'ダイエット')
  assert.deepEqual(result.map((p: { slug: string }) => p.slug), ['b'])
})

test('max 3: caps the result even when more same-category matches exist', () => {
  const allPosts = [post('a', 'x'), post('b', 'ダイエット'), post('c', 'ダイエット'), post('d', 'ダイエット'), post('e', 'ダイエット')]
  const result = getRelatedArticles(allPosts, 'a', 'ダイエット')
  assert.equal(result.length, 3)
  assert.deepEqual(result.map((p: { slug: string }) => p.slug), ['b', 'c', 'd'])
})

test('no duplicates: distinct-slug input (the only shape Production data can produce, since blogs.slug is UNIQUE) never yields duplicate output', () => {
  const allPosts = [post('a', 'ダイエット'), post('b', 'ダイエット'), post('c', 'ダイエット')]
  const result = getRelatedArticles(allPosts, 'a', 'ダイエット')
  const slugs = result.map((p: { slug: string }) => p.slug)
  assert.equal(new Set(slugs).size, slugs.length)
})

test('a genuinely duplicated slug in allPosts (not possible from real data given the UNIQUE constraint, but exercised here for robustness) does not crash and is counted toward maxCount like any other match -- this helper intentionally has no dedupe logic of its own, since real input never needs it', () => {
  const dup = post('b', 'ダイエット')
  const allPosts = [post('a', 'ダイエット'), dup, dup, post('c', 'ダイエット')]
  const result = getRelatedArticles(allPosts, 'a', 'ダイエット')
  assert.deepEqual(result.map((p: { slug: string }) => p.slug), ['b', 'b', 'c'])
})

test('zero same-category articles -> empty array', () => {
  const allPosts = [post('a', 'ダイエット'), post('b', '筋トレ')]
  const result = getRelatedArticles(allPosts, 'a', 'ダイエット')
  assert.deepEqual(result, [])
})

test('one or two same-category matches -> only the available count is returned, not padded to 3', () => {
  const allPosts = [post('a', 'ダイエット'), post('b', 'ダイエット')]
  const result = getRelatedArticles(allPosts, 'a', 'ダイエット')
  assert.equal(result.length, 1)
  assert.equal(result[0].slug, 'b')
})

test('order is stable: preserves allPosts order (published_at DESC as fetched), not re-sorted', () => {
  const allPosts = [post('a', 'x'), post('b', 'ダイエット'), post('c', 'x'), post('d', 'ダイエット'), post('e', 'ダイエット')]
  const result = getRelatedArticles(allPosts, 'z', 'ダイエット')
  assert.deepEqual(result.map((p: { slug: string }) => p.slug), ['b', 'd', 'e'])
})

test('does not mutate the original allPosts array', () => {
  const allPosts = [post('a', 'ダイエット'), post('b', 'ダイエット'), post('c', 'ダイエット')]
  const snapshot = JSON.parse(JSON.stringify(allPosts))
  getRelatedArticles(allPosts, 'a', 'ダイエット')
  assert.deepEqual(allPosts, snapshot)
})

test('custom maxCount is respected', () => {
  const allPosts = [post('a', 'x'), post('b', 'ダイエット'), post('c', 'ダイエット'), post('d', 'ダイエット')]
  const result = getRelatedArticles(allPosts, 'a', 'ダイエット', 2)
  assert.equal(result.length, 2)
})
