import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildArticleBreadcrumbJsonLd } from './breadcrumbJsonLd.ts'

const TITLE = '【2026年最新】筋膜リリースとフィットネスの効果とは？科学的に解説！'
const CANONICAL = 'https://www.fitmate.run/blog/myofascial-release-and-fitness-guide-2026'

test('has exactly 3 levels', () => {
  const result = buildArticleBreadcrumbJsonLd(TITLE, CANONICAL)
  assert.equal(result.itemListElement.length, 3)
})

test('positions are 1, 2, 3 in order', () => {
  const result = buildArticleBreadcrumbJsonLd(TITLE, CANONICAL)
  assert.deepEqual(result.itemListElement.map((i) => i.position), [1, 2, 3])
})

test('all item URLs are absolute', () => {
  const result = buildArticleBreadcrumbJsonLd(TITLE, CANONICAL)
  for (const item of result.itemListElement) {
    assert.match(item.item, /^https:\/\//)
  }
})

test('level 1 is Home at the site origin, level 2 is the blog listing', () => {
  const result = buildArticleBreadcrumbJsonLd(TITLE, CANONICAL)
  assert.equal(result.itemListElement[0].item, 'https://www.fitmate.run')
  assert.equal(result.itemListElement[1].item, 'https://www.fitmate.run/blog')
})

test('level 3 uses the real, untruncated article title and its canonical URL', () => {
  const result = buildArticleBreadcrumbJsonLd(TITLE, CANONICAL)
  assert.equal(result.itemListElement[2].name, TITLE)
  assert.equal(result.itemListElement[2].item, CANONICAL)
})

test('the canonical URL passed in matches the level-3 item exactly (no re-derivation)', () => {
  const customCanonical = 'https://www.fitmate.run/blog/some-other-slug'
  const result = buildArticleBreadcrumbJsonLd('Some Other Title', customCanonical)
  assert.equal(result.itemListElement[2].item, customCanonical)
})

test('is a valid @type BreadcrumbList', () => {
  const result = buildArticleBreadcrumbJsonLd(TITLE, CANONICAL)
  assert.equal(result['@type'], 'BreadcrumbList')
  assert.equal(result['@context'], 'https://schema.org')
})
