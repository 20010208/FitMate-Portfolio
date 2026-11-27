import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Static-source checks for how blog/[slug]/page.tsx wires up related
// articles (page.tsx is .tsx/JSX and can't be imported directly under
// Node's TypeScript stripping -- see structuredDataIntegration.test.ts for
// the same constraint). getRelatedArticles() itself is covered by its own
// real-import tests in src/lib/seo/relatedArticles.test.ts.

const blogDir = path.dirname(fileURLToPath(import.meta.url))
const pageSource = readFileSync(path.join(blogDir, '[slug]/page.tsx'), 'utf8')

test('page.tsx imports getRelatedArticles from the pure helper module', () => {
  assert.match(pageSource, /import \{ getRelatedArticles \} from '@\/lib\/seo\/relatedArticles'/)
})

test('getRelatedArticles is called exactly once, with this post\'s own slug and category (excludes self by construction)', () => {
  const componentBody = pageSource.slice(pageSource.indexOf('export default async function BlogPostPage'))
  const calls = componentBody.match(/getRelatedArticles\(/g) ?? []
  assert.equal(calls.length, 1)
  assert.match(componentBody, /getRelatedArticles\(allPosts, post\.slug, post\.category\)/)
})

test('related articles reuse the already-fetched allPosts array -- no new getAllPosts()/Supabase call was added', () => {
  const componentBody = pageSource.slice(pageSource.indexOf('export default async function BlogPostPage'))
  const getAllPostsCalls = componentBody.match(/getAllPosts\(/g) ?? []
  assert.equal(getAllPostsCalls.length, 1)
})

test('chronological prev/next navigation is still present, unchanged by the related-articles addition', () => {
  assert.match(pageSource, /const prevPost = currentIndex > 0 \? allPosts\[currentIndex - 1\] : null/)
  assert.match(pageSource, /const nextPost = currentIndex < allPosts\.length - 1 \? allPosts\[currentIndex \+ 1\] : null/)
  assert.match(pageSource, /前の記事/)
  assert.match(pageSource, /次の記事/)
})

test('a "関連記事" section is rendered, only when relatedArticles is non-empty', () => {
  assert.match(pageSource, /関連記事/)
  assert.match(pageSource, /\{relatedArticles\.length > 0 && \(/)
})

test('the related-articles section uses semantic HTML: a <section> with a heading and a list', () => {
  const sectionStart = pageSource.indexOf('Related articles')
  const sectionEnd = pageSource.indexOf('Back to blog')
  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart)
  const section = pageSource.slice(sectionStart, sectionEnd)
  assert.match(section, /<section/)
  assert.match(section, /<h2/)
  assert.match(section, /<ul/)
  assert.match(section, /<li/)
})

test('each related-article link points to /blog/<slug> and uses the article title as anchor text (no "こちら"-style weak anchor)', () => {
  const sectionStart = pageSource.indexOf('Related articles')
  const sectionEnd = pageSource.indexOf('Back to blog')
  const section = pageSource.slice(sectionStart, sectionEnd)
  assert.match(section, /href=\{`\/blog\/\$\{related\.slug\}`\}/)
  assert.match(section, /\{related\.title\}/)
  assert.equal(section.includes('こちら'), false)
})
