import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDateModified, buildArticleJsonLd } from './articleJsonLd.ts'
import { ORGANIZATION_ID, WEBSITE_ID } from './siteJsonLd.ts'

// --- resolveDateModified ---------------------------------------------------

test('a valid updatedAt wins over publishedAt', () => {
  const result = resolveDateModified('2026-07-20T00:00:00.000Z', '2026-07-01')
  assert.equal(result, '2026-07-20T00:00:00.000Z')
})

test('null updatedAt falls back to publishedAt (this is today\'s reality: no updated_at column exists)', () => {
  const result = resolveDateModified(null, '2026-07-01')
  assert.equal(result, new Date('2026-07-01').toISOString())
})

test('undefined updatedAt falls back to publishedAt', () => {
  const result = resolveDateModified(undefined, '2026-07-01')
  assert.equal(result, new Date('2026-07-01').toISOString())
})

test('empty-string updatedAt falls back to publishedAt', () => {
  const result = resolveDateModified('', '2026-07-01')
  assert.equal(result, new Date('2026-07-01').toISOString())
})

test('an invalid updatedAt falls back to publishedAt, not a fabricated/current date', () => {
  const result = resolveDateModified('not-a-date', '2026-07-01')
  assert.equal(result, new Date('2026-07-01').toISOString())
})

test('never returns the current wall-clock time or a build timestamp', () => {
  const before = Date.now()
  const result = resolveDateModified(undefined, '2020-01-01')
  const after = Date.now()
  const resultMs = new Date(result).getTime()
  assert.ok(resultMs < before, 'resolveDateModified must not return "now"')
  assert.ok(resultMs <= after)
  assert.equal(result, new Date('2020-01-01').toISOString())
})

test('returns ISO 8601 format', () => {
  const result = resolveDateModified('2026-07-20', '2026-07-01')
  assert.match(result, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
})

test('an unparseable publishedAt is returned as-is rather than throwing (last-resort fallback)', () => {
  const result = resolveDateModified(undefined, 'also-not-a-date')
  assert.equal(result, 'also-not-a-date')
})

// --- buildArticleJsonLd ------------------------------------------------

const BASE_INPUT = {
  canonicalUrl: 'https://www.fitmate.run/blog/myofascial-release-and-fitness-guide-2026',
  headline: '【2026年最新】筋膜リリースとフィットネスの効果とは？',
  description: '筋膜リリースがフィットネスに与える影響を科学的に解説。',
  imageUrl: 'https://www.fitmate.run/og-image.png',
  datePublished: '2026-07-24',
  dateModified: '2026-07-24T00:00:00.000Z',
  articleSection: '健康・美容',
  keywords: ['健康・美容'],
  organizationId: ORGANIZATION_ID,
  websiteId: WEBSITE_ID,
}

test('sets @context and @type: Article', () => {
  const result = buildArticleJsonLd(BASE_INPUT)
  assert.equal(result['@context'], 'https://schema.org')
  assert.equal(result['@type'], 'Article')
})

test('@id is a stable id derived from the canonical URL', () => {
  const result = buildArticleJsonLd(BASE_INPUT)
  assert.equal(result['@id'], `${BASE_INPUT.canonicalUrl}#article`)
})

test('url matches the canonical URL exactly', () => {
  const result = buildArticleJsonLd(BASE_INPUT)
  assert.equal(result.url, BASE_INPUT.canonicalUrl)
})

test('headline and description are passed through unchanged', () => {
  const result = buildArticleJsonLd(BASE_INPUT)
  assert.equal(result.headline, BASE_INPUT.headline)
  assert.equal(result.description, BASE_INPUT.description)
})

test('image is an absolute URL, passed through from the resolver output (no re-resolution)', () => {
  const result = buildArticleJsonLd(BASE_INPUT)
  assert.equal(result.image, BASE_INPUT.imageUrl)
  assert.match(result.image, /^https:\/\//)
})

test('datePublished and dateModified are passed through as given', () => {
  const result = buildArticleJsonLd(BASE_INPUT)
  assert.equal(result.datePublished, BASE_INPUT.datePublished)
  assert.equal(result.dateModified, BASE_INPUT.dateModified)
})

test('mainEntityOfPage is a WebPage matching the canonical URL', () => {
  const result = buildArticleJsonLd(BASE_INPUT)
  assert.deepEqual(result.mainEntityOfPage, { '@type': 'WebPage', '@id': BASE_INPUT.canonicalUrl })
})

test('articleSection is included when a real category is given', () => {
  const result = buildArticleJsonLd(BASE_INPUT)
  assert.equal(result.articleSection, '健康・美容')
})

test('articleSection is omitted (not an empty string / null) when there is no category', () => {
  const result = buildArticleJsonLd({ ...BASE_INPUT, articleSection: null })
  assert.equal('articleSection' in result, false)
})

test('keywords is included, deduplicated, when real values are given', () => {
  const result = buildArticleJsonLd({ ...BASE_INPUT, keywords: ['健康・美容', '健康・美容', 'ダイエット'] })
  assert.deepEqual(result.keywords, ['健康・美容', 'ダイエット'])
})

test('keywords is omitted entirely when there is no real data (never a fabricated/fixed list)', () => {
  const result = buildArticleJsonLd({ ...BASE_INPUT, keywords: null })
  assert.equal('keywords' in result, false)
})

test('keywords is omitted when given an empty array', () => {
  const result = buildArticleJsonLd({ ...BASE_INPUT, keywords: [] })
  assert.equal('keywords' in result, false)
})

test('author and publisher reference the Organization by @id (not a fabricated personal name)', () => {
  const result = buildArticleJsonLd(BASE_INPUT)
  assert.deepEqual(result.author, { '@type': 'Organization', '@id': ORGANIZATION_ID })
  assert.deepEqual(result.publisher, { '@type': 'Organization', '@id': ORGANIZATION_ID })
})

test('does not hardcode the organization/website ids: whatever is passed in is what comes out', () => {
  const result = buildArticleJsonLd({ ...BASE_INPUT, organizationId: 'https://example.com/#org', websiteId: 'https://example.com/#site' })
  assert.equal(result.author['@id'], 'https://example.com/#org')
  assert.equal(result.publisher['@id'], 'https://example.com/#org')
  assert.equal(result.isPartOf['@id'], 'https://example.com/#site')
})

test('isPartOf references the WebSite by @id', () => {
  const result = buildArticleJsonLd(BASE_INPUT)
  assert.deepEqual(result.isPartOf, { '@type': 'WebSite', '@id': WEBSITE_ID })
})

test('is valid JSON when stringified', () => {
  const result = buildArticleJsonLd(BASE_INPUT)
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(result)))
})

test('does not include raw article body HTML anywhere in the output', () => {
  const result = buildArticleJsonLd({ ...BASE_INPUT, headline: 'Title', description: 'Desc' })
  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes('<article'), false)
  assert.equal(serialized.includes('blog-content'), false)
})
