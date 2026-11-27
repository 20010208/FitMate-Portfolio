import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getStaticSitemapEntries,
  parseValidSitemapDate,
  getLatestPublishedDate,
} from './staticSitemapEntries.ts'

// Pure function only. No network, no Supabase (blog post URLs are generated
// separately in src/app/sitemap.ts via getAllPosts() and are out of scope
// here on purpose).

test('/login is not in the static sitemap entries', () => {
  const urls = getStaticSitemapEntries().map((entry) => entry.url)
  assert.equal(urls.includes('https://www.fitmate.run/login'), false)
})

test('/signup is not in the static sitemap entries', () => {
  const urls = getStaticSitemapEntries().map((entry) => entry.url)
  assert.equal(urls.includes('https://www.fitmate.run/signup'), false)
})

test('the homepage is preserved', () => {
  const urls = getStaticSitemapEntries().map((entry) => entry.url)
  assert.ok(urls.includes('https://www.fitmate.run'))
})

test('/blog is preserved', () => {
  const urls = getStaticSitemapEntries().map((entry) => entry.url)
  assert.ok(urls.includes('https://www.fitmate.run/blog'))
})

test('legal/info pages are preserved (privacy-policy, terms, contact)', () => {
  const urls = getStaticSitemapEntries().map((entry) => entry.url)
  assert.ok(urls.includes('https://www.fitmate.run/privacy-policy'))
  assert.ok(urls.includes('https://www.fitmate.run/terms'))
  assert.ok(urls.includes('https://www.fitmate.run/contact'))
})

test('noindex app routes (dashboard/training/meal/weight/history/profile) are not present', () => {
  const urls = getStaticSitemapEntries().map((entry) => entry.url)
  for (const route of ['/dashboard', '/training', '/meal', '/weight', '/history', '/profile']) {
    assert.equal(urls.includes(`https://www.fitmate.run${route}`), false, `${route} unexpectedly in sitemap`)
  }
})

test('exactly 5 static entries remain (7 minus /login and /signup)', () => {
  assert.equal(getStaticSitemapEntries().length, 5)
})

test('no duplicate URLs among the static entries', () => {
  const urls = getStaticSitemapEntries().map((entry) => entry.url)
  assert.equal(new Set(urls).size, urls.length)
})

test('all static entry URLs are absolute https URLs on the production origin', () => {
  for (const entry of getStaticSitemapEntries()) {
    assert.match(entry.url, /^https:\/\/www\.fitmate\.run/)
  }
})

test('remaining entries keep their original changeFrequency and priority values', () => {
  const bySlug = Object.fromEntries(
    getStaticSitemapEntries().map((entry) => [entry.url, entry])
  )
  assert.equal(bySlug['https://www.fitmate.run'].changeFrequency, 'weekly')
  assert.equal(bySlug['https://www.fitmate.run'].priority, 1.0)
  assert.equal(bySlug['https://www.fitmate.run/blog'].changeFrequency, 'weekly')
  assert.equal(bySlug['https://www.fitmate.run/blog'].priority, 0.9)
  assert.equal(bySlug['https://www.fitmate.run/privacy-policy'].changeFrequency, 'yearly')
  assert.equal(bySlug['https://www.fitmate.run/privacy-policy'].priority, 0.3)
  assert.equal(bySlug['https://www.fitmate.run/terms'].changeFrequency, 'yearly')
  assert.equal(bySlug['https://www.fitmate.run/terms'].priority, 0.3)
  assert.equal(bySlug['https://www.fitmate.run/contact'].changeFrequency, 'yearly')
  assert.equal(bySlug['https://www.fitmate.run/contact'].priority, 0.4)
})

test('relative order of remaining entries is unchanged (/, /blog, /privacy-policy, /terms, /contact)', () => {
  const urls = getStaticSitemapEntries().map((entry) => entry.url)
  assert.deepEqual(urls, [
    'https://www.fitmate.run',
    'https://www.fitmate.run/blog',
    'https://www.fitmate.run/privacy-policy',
    'https://www.fitmate.run/terms',
    'https://www.fitmate.run/contact',
  ])
})

// --- lastModified: no fabricated timestamps ---------------------------

test('pages with no real update-time data source have no lastModified at all (never the current/build time)', () => {
  const entries = getStaticSitemapEntries()
  const bySlug = Object.fromEntries(entries.map((entry) => [entry.url, entry]))
  assert.equal('lastModified' in bySlug['https://www.fitmate.run'], false)
  assert.equal('lastModified' in bySlug['https://www.fitmate.run/privacy-policy'], false)
  assert.equal('lastModified' in bySlug['https://www.fitmate.run/terms'], false)
  assert.equal('lastModified' in bySlug['https://www.fitmate.run/contact'], false)
})

test('/blog has no lastModified when no blogLastModified is passed in (no fabricated fallback)', () => {
  const entries = getStaticSitemapEntries()
  const blog = entries.find((entry) => entry.url === 'https://www.fitmate.run/blog')
  assert.ok(blog, 'expected a /blog entry in the static sitemap entries')
  assert.equal('lastModified' in blog, false)
})

test('/blog uses the given blogLastModified when provided, and only /blog gets it', () => {
  const date = new Date('2026-07-20T00:00:00.000Z')
  const entries = getStaticSitemapEntries(date)
  const bySlug = Object.fromEntries(entries.map((entry) => [entry.url, entry]))
  assert.equal(bySlug['https://www.fitmate.run/blog'].lastModified, date)
  assert.equal('lastModified' in bySlug['https://www.fitmate.run'], false)
  assert.equal('lastModified' in bySlug['https://www.fitmate.run/privacy-policy'], false)
})

// --- parseValidSitemapDate ----------------------------------------------

test('parseValidSitemapDate: a valid date string returns a Date', () => {
  const result = parseValidSitemapDate('2026-07-24')
  assert.ok(result instanceof Date)
  assert.equal(result.getTime(), new Date('2026-07-24').getTime())
})

test('parseValidSitemapDate: null/undefined/empty return undefined', () => {
  assert.equal(parseValidSitemapDate(null), undefined)
  assert.equal(parseValidSitemapDate(undefined), undefined)
  assert.equal(parseValidSitemapDate(''), undefined)
})

test('parseValidSitemapDate: an invalid date string returns undefined, not "Invalid Date"', () => {
  const result = parseValidSitemapDate('not-a-real-date')
  assert.equal(result, undefined)
})

test('parseValidSitemapDate: never returns the current wall-clock time', () => {
  // assert.equal(result, undefined) below already fully proves this: if
  // parseValidSitemapDate had fabricated a fallback Date (e.g. `new Date()`),
  // this equality would fail. A follow-up `result?.getTime() !== before`
  // check is redundant with -- and, once `result` is narrowed to `undefined`
  // by the assertion above, unreachable after -- that proof.
  const result = parseValidSitemapDate('garbage')
  assert.equal(result, undefined)
})

// --- getLatestPublishedDate ----------------------------------------------

test('getLatestPublishedDate: returns the latest of several valid dates, regardless of input order', () => {
  const inOrder = getLatestPublishedDate(['2026-07-01', '2026-07-24', '2026-07-10'])
  const reversed = getLatestPublishedDate(['2026-07-10', '2026-07-24', '2026-07-01'])
  assert.equal(inOrder?.getTime(), new Date('2026-07-24').getTime())
  assert.equal(reversed?.getTime(), new Date('2026-07-24').getTime())
})

test('getLatestPublishedDate: invalid/missing entries are ignored, not treated as "latest"', () => {
  const result = getLatestPublishedDate(['2026-07-01', 'not-a-date', null, undefined, '2026-07-10'])
  assert.equal(result?.getTime(), new Date('2026-07-10').getTime())
})

test('getLatestPublishedDate: returns undefined when the list is empty (0 published posts)', () => {
  assert.equal(getLatestPublishedDate([]), undefined)
})

test('getLatestPublishedDate: returns undefined when every entry is invalid', () => {
  assert.equal(getLatestPublishedDate(['not-a-date', null, undefined, '']), undefined)
})
