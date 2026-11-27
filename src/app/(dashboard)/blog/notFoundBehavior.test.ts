import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Static-source checks only. page.tsx / not-found.tsx (both here and under
// [slug]/) are .tsx files containing JSX, which Node's built-in TypeScript
// stripping does not compile — they cannot be `import`-ed directly the way
// the other seo/*.ts pure helpers are, so this file follows the same
// regex-based approach already used in noIndexMetadata.test.ts for the
// (dashboard)/(auth) route checks. Files are read fresh on every run.
//
// This test file deliberately lives in blog/ rather than blog/[slug]/:
// Node's test runner CLI treats file arguments as glob patterns, and `[slug]`
// is a valid glob character class, so a test file placed inside that
// directory can never be found by `node --test <path>`. fs.readFileSync
// below takes plain literal paths, so reading files under [slug]/ is fine.

const blogDir = path.dirname(fileURLToPath(import.meta.url))
const slugDir = path.join(blogDir, '[slug]')

const pageSource = readFileSync(path.join(slugDir, 'page.tsx'), 'utf8')
const notFoundPath = path.join(slugDir, 'not-found.tsx')

// --- missing article: notFound() call site -----------------------------

test('notFound() is called directly in the page body, not inside a try/catch', () => {
  assert.match(pageSource, /if \(!post\) notFound\(\)/)
  const beforeNotFound = pageSource.slice(0, pageSource.indexOf('if (!post) notFound()'))
  const openTryCount = (beforeNotFound.match(/\btry\s*\{/g) ?? []).length
  const closeCount = (beforeNotFound.match(/\}\s*catch/g) ?? []).length
  assert.equal(openTryCount, closeCount, 'an unclosed try block precedes notFound() — it would swallow the NEXT_NOT_FOUND signal')
})

test('the page component never reaches article rendering when the post is missing (notFound() precedes JSON-LD/JSX construction)', () => {
  const notFoundIdx = pageSource.indexOf('if (!post) notFound()')
  const schemaIdx = pageSource.indexOf('buildArticleJsonLd(')
  assert.ok(notFoundIdx > -1 && schemaIdx > -1)
  assert.ok(notFoundIdx < schemaIdx, 'Article JSON-LD is constructed before the missing-post check')
})

// --- missing article: generateMetadata ----------------------------------

test('generateMetadata returns NO_INDEX_METADATA (not an empty object) when the post is missing', () => {
  assert.match(
    pageSource,
    /import\s*\{\s*NO_INDEX_METADATA\s*\}\s*from\s*['"]@\/lib\/seo\/noIndexMetadata['"]/,
    'missing NO_INDEX_METADATA import'
  )
  assert.match(pageSource, /if \(!post\) return \{ \.\.\.NO_INDEX_METADATA \}/)
})

test('the missing-post generateMetadata branch returns before any canonical/OG/article-specific fields are built', () => {
  const returnIdx = pageSource.indexOf('if (!post) return { ...NO_INDEX_METADATA }')
  const canonicalIdx = pageSource.indexOf('alternates: { canonical:')
  const ogImageIdx = pageSource.indexOf('resolveBlogOgImage(')
  assert.ok(returnIdx > -1 && canonicalIdx > -1 && ogImageIdx > -1)
  assert.ok(returnIdx < canonicalIdx, 'canonical is built even when the post might be missing')
  assert.ok(returnIdx < ogImageIdx, 'OG image resolution runs even when the post might be missing')
})

// --- existing article: metadata generation is unchanged ------------------

test('existing-article metadata still sets type: article, canonical, and OG images', () => {
  assert.match(pageSource, /type:\s*'article'/)
  assert.match(pageSource, /alternates:\s*\{\s*canonical:\s*`https:\/\/www\.fitmate\.run\/blog\/\$\{post\.slug\}`\s*\}/)
  assert.match(pageSource, /images:\s*\[\{\s*url:\s*ogImageUrl/)
})

test('existing-article page rendering still builds the Article JSON-LD schema, safely serialized', () => {
  assert.match(pageSource, /import\s*\{\s*buildArticleJsonLd,\s*resolveDateModified\s*\}\s*from\s*['"]@\/lib\/seo\/articleJsonLd['"]/)
  assert.match(pageSource, /const articleJsonLd = buildArticleJsonLd\(/)
  assert.match(pageSource, /dangerouslySetInnerHTML=\{\{\s*__html:\s*toSafeJsonLdString\(articleJsonLd\)\s*\}\}/)
})

// --- not-found.tsx: scoped, minimal, matches the required UI checklist ---

test('a dedicated not-found.tsx exists for /blog/[slug] (scoped to this segment only)', () => {
  assert.ok(existsSync(notFoundPath), 'src/app/(dashboard)/blog/[slug]/not-found.tsx is missing')
})

test('not-found.tsx applies NO_INDEX_METADATA via its own metadata export', () => {
  const source = readFileSync(notFoundPath, 'utf8')
  assert.match(
    source,
    /import\s*\{\s*NO_INDEX_METADATA\s*\}\s*from\s*['"]@\/lib\/seo\/noIndexMetadata['"]/
  )
  const metadataBlock = source.match(/export const metadata:\s*Metadata\s*=\s*\{[\s\S]*?\n\}/)
  assert.ok(metadataBlock, 'export const metadata block not found')
  assert.match(metadataBlock[0], /\.\.\.NO_INDEX_METADATA/)
})

test('not-found.tsx links back to /blog', () => {
  const source = readFileSync(notFoundPath, 'utf8')
  assert.match(source, /href="\/blog"/)
})

test('not-found.tsx has an accessible heading and no login/signup prompt or ads', () => {
  const source = readFileSync(notFoundPath, 'utf8')
  assert.match(source, /<h1[^>]*>/)
  assert.equal(source.includes('/signup'), false)
  assert.equal(source.includes('/login'), false)
})

// --- /blog listing: Suspense scoped locally, no cross-segment loading.tsx -

test('/blog and /blog/[slug] no longer have file-convention loading.tsx boundaries', () => {
  assert.equal(existsSync(path.join(blogDir, 'loading.tsx')), false, 'blog/loading.tsx still exists and will wrap /blog/[slug] too')
  assert.equal(existsSync(path.join(slugDir, 'loading.tsx')), false, 'blog/[slug]/loading.tsx still exists')
})

test('a reusable BlogListSkeleton component exists', () => {
  assert.ok(existsSync(path.join(blogDir, 'BlogListSkeleton.tsx')))
})

test('/blog scopes its own Suspense boundary around the data-fetching child component', () => {
  const source = readFileSync(path.join(blogDir, 'page.tsx'), 'utf8')
  assert.match(source, /import\s*\{\s*Suspense\s*\}\s*from\s*['"]react['"]/)
  assert.match(source, /<Suspense fallback=\{<BlogListSkeleton \/>\}>/)
  assert.match(source, /<BlogList\s*\/>/)
  assert.match(source, /async function BlogList\(\)/)
})

test('/blog still revalidates hourly and keeps its own indexable canonical/OG metadata', () => {
  const source = readFileSync(path.join(blogDir, 'page.tsx'), 'utf8')
  assert.match(source, /export const revalidate = 3600/)
  assert.match(source, /alternates:\s*\{\s*canonical:\s*'https:\/\/www\.fitmate\.run\/blog'\s*\}/)
  assert.equal(source.includes('NO_INDEX_METADATA'), false)
})

test('the default-exported /blog page component is not itself async (data fetching lives in the Suspense-wrapped child)', () => {
  const source = readFileSync(path.join(blogDir, 'page.tsx'), 'utf8')
  assert.match(source, /export default function BlogIndexPage\(\)/)
  assert.doesNotMatch(source, /export default async function BlogIndexPage/)
})
