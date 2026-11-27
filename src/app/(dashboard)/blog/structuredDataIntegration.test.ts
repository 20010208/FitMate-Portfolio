import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Static-source checks for how blog/[slug]/page.tsx wires up the JSON-LD
// helpers (page.tsx is .tsx/JSX and can't be imported directly under Node's
// TypeScript stripping — see notFoundBehavior.test.ts for the same
// constraint). The helpers themselves (articleJsonLd.ts, breadcrumbJsonLd.ts,
// siteJsonLd.ts, safeJsonLd.ts) are covered by their own real-import tests.

const blogDir = path.dirname(fileURLToPath(import.meta.url))
const pageSource = readFileSync(path.join(blogDir, '[slug]/page.tsx'), 'utf8')
const notFoundSource = readFileSync(path.join(blogDir, '[slug]/not-found.tsx'), 'utf8')

test('page.tsx imports all four JSON-LD helpers plus the safe serializer', () => {
  assert.match(pageSource, /from '@\/lib\/seo\/articleJsonLd'/)
  assert.match(pageSource, /from '@\/lib\/seo\/breadcrumbJsonLd'/)
  assert.match(pageSource, /from '@\/lib\/seo\/siteJsonLd'/)
  assert.match(pageSource, /from '@\/lib\/seo\/safeJsonLd'/)
})

test('exactly 4 JSON-LD <script> tags are rendered for an existing article (Article, BreadcrumbList, Organization, WebSite)', () => {
  const matches = pageSource.match(/<script type="application\/ld\+json"/g) ?? []
  assert.equal(matches.length, 4)
})

test('every JSON-LD <script> tag uses the safe serializer, never a raw JSON.stringify', () => {
  const scriptLines = pageSource.split('\n').filter((line) => line.includes('type="application/ld+json"'))
  assert.equal(scriptLines.length, 4)
  for (const line of scriptLines) {
    assert.match(line, /toSafeJsonLdString\(/, `expected toSafeJsonLdString(...) in: ${line}`)
    assert.equal(line.includes('JSON.stringify('), false, `raw JSON.stringify found in: ${line}`)
  }
})

test('the BreadcrumbList is built from the real article title and the same canonicalUrl used elsewhere on the page', () => {
  assert.match(pageSource, /const canonicalUrl = `\$\{SITE_ORIGIN\}\/blog\/\$\{post\.slug\}`/)
  assert.match(pageSource, /buildArticleBreadcrumbJsonLd\(post\.title, canonicalUrl\)/)
})

test('the article image reuses the existing OG image resolver output (no second/duplicate image-resolution implementation)', () => {
  assert.match(pageSource, /const articleImageUrl = resolveBlogOgImage\(post\.ogImage, SITE_ORIGIN\)/)
  assert.match(pageSource, /imageUrl:\s*articleImageUrl/)
})

test('dateModified is computed via resolveDateModified, never new Date() or Date.now() directly', () => {
  assert.match(pageSource, /dateModified:\s*resolveDateModified\(/)
  assert.equal(pageSource.includes('new Date()'), false)
  assert.equal(pageSource.includes('Date.now()'), false)
})

test('articleSection and keywords are sourced from the real post.category, not a fabricated/fixed list', () => {
  assert.match(pageSource, /articleSection:\s*post\.category/)
  assert.match(pageSource, /keywords:\s*post\.category \? \[post\.category\] : null/)
})

test('author/publisher are not given a fabricated personal name in page.tsx (delegated to the Organization helper)', () => {
  assert.equal(pageSource.includes("name: 'FitMate'"), false)
})

test('article body HTML (post.content) is never passed into a JSON-LD builder call', () => {
  const jsonLdCallsBlock = pageSource.slice(
    pageSource.indexOf('const articleJsonLd = buildArticleJsonLd('),
    pageSource.indexOf('const breadcrumbJsonLd')
  )
  assert.equal(jsonLdCallsBlock.includes('post.content'), false)
})

test('DB access helpers are not called more times than before (still exactly one getPostBySlug and one getAllPosts call in the page component)', () => {
  const componentBody = pageSource.slice(pageSource.indexOf('export default async function BlogPostPage'))
  const getPostBySlugCalls = componentBody.match(/getPostBySlug\(/g) ?? []
  const getAllPostsCalls = componentBody.match(/getAllPosts\(/g) ?? []
  assert.equal(getPostBySlugCalls.length, 1)
  assert.equal(getAllPostsCalls.length, 1)
})

test('not-found.tsx renders no JSON-LD at all (no Article/BreadcrumbList/Organization/WebSite for missing slugs)', () => {
  assert.equal(notFoundSource.includes('application/ld+json'), false)
  assert.equal(notFoundSource.includes('buildArticleJsonLd'), false)
  assert.equal(notFoundSource.includes('buildArticleBreadcrumbJsonLd'), false)
  assert.equal(notFoundSource.includes('ORGANIZATION_JSON_LD'), false)
  assert.equal(notFoundSource.includes('WEBSITE_JSON_LD'), false)
})

test('the blog listing page (/blog) does not render article-specific JSON-LD', () => {
  const listingSource = readFileSync(path.join(blogDir, 'page.tsx'), 'utf8')
  assert.equal(listingSource.includes('buildArticleJsonLd'), false)
  assert.equal(listingSource.includes('application/ld+json'), false)
})
