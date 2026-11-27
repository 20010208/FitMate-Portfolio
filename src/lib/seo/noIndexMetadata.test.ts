import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { NO_INDEX_METADATA } from './noIndexMetadata.ts'

// Pure static-metadata checks only. No network, no Supabase, no browser APIs.
// Route source files are read fresh on every run so these checks stay honest
// about what actually ships, not a copy pasted into this test.

const appDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../app/(dashboard)'
)

const authDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../app/(auth)'
)

const rootLayoutPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../app/layout.tsx'
)

test('robots.index is false', () => {
  assert.equal(NO_INDEX_METADATA.robots.index, false)
})

test('robots.follow is false', () => {
  assert.equal(NO_INDEX_METADATA.robots.follow, false)
})

test('robots.googleBot.index is false', () => {
  assert.equal(NO_INDEX_METADATA.robots.googleBot.index, false)
})

test('robots.googleBot.follow is false', () => {
  assert.equal(NO_INDEX_METADATA.robots.googleBot.follow, false)
})

test('does not define title', () => {
  assert.equal('title' in NO_INDEX_METADATA, false)
})

test('does not define description', () => {
  assert.equal('description' in NO_INDEX_METADATA, false)
})

test('does not define alternates/canonical', () => {
  assert.equal('alternates' in NO_INDEX_METADATA, false)
})

test('does not define openGraph', () => {
  assert.equal('openGraph' in NO_INDEX_METADATA, false)
})

test('does not define twitter', () => {
  assert.equal('twitter' in NO_INDEX_METADATA, false)
})

test('only defines the robots key, nothing else', () => {
  assert.deepEqual(Object.keys(NO_INDEX_METADATA), ['robots'])
})

const TARGET_ROUTES = [
  'dashboard/page.tsx',
  'training/page.tsx',
  'meal/page.tsx',
  'weight/page.tsx',
  'history/page.tsx',
]

for (const relPath of TARGET_ROUTES) {
  test(`${relPath} imports and applies NO_INDEX_METADATA inside its metadata export`, () => {
    const source = readFileSync(path.join(appDir, relPath), 'utf8')

    assert.match(
      source,
      /import\s*\{\s*NO_INDEX_METADATA\s*\}\s*from\s*['"]@\/lib\/seo\/noIndexMetadata['"]/,
      'missing NO_INDEX_METADATA import from the shared helper'
    )

    const metadataBlock = source.match(/export const metadata:\s*Metadata\s*=\s*\{[\s\S]*?\n\}/)
    assert.ok(metadataBlock, 'export const metadata block not found')
    assert.match(
      metadataBlock[0],
      /\.\.\.NO_INDEX_METADATA/,
      'metadata export does not spread NO_INDEX_METADATA'
    )
  })
}

test('blog listing page does not apply NO_INDEX_METADATA (stays indexable)', () => {
  const source = readFileSync(path.join(appDir, 'blog/page.tsx'), 'utf8')
  assert.equal(source.includes('NO_INDEX_METADATA'), false)
  assert.equal(/index:\s*false/.test(source), false)
})

test('blog detail page only applies NO_INDEX_METADATA to the missing-post branch, never to an existing (indexable) article', () => {
  const source = readFileSync(path.join(appDir, 'blog/[slug]/page.tsx'), 'utf8')
  // NO_INDEX_METADATA is legitimately used for the `if (!post)` case (see
  // blog/notFoundBehavior.test.ts), but must never be spread into the
  // metadata object returned for an article that actually exists.
  const missingCheck = 'if (!post) return { ...NO_INDEX_METADATA }'
  assert.match(source, /if \(!post\) return \{ \.\.\.NO_INDEX_METADATA \}/)
  const afterMissingCheck = source.slice(source.indexOf(missingCheck) + missingCheck.length)
  assert.equal(afterMissingCheck.includes('NO_INDEX_METADATA'), false, 'NO_INDEX_METADATA is referenced again after the missing-post branch')
  assert.equal(/type:\s*'article'[\s\S]*NO_INDEX_METADATA/.test(source), false)
})

test('shared (dashboard) layout defines no metadata of its own (no blanket noindex leaking to /blog)', () => {
  const source = readFileSync(path.join(appDir, 'layout.tsx'), 'utf8')
  assert.equal(source.includes('export const metadata'), false)
  assert.equal(source.includes('NO_INDEX_METADATA'), false)
})

test('(auth) layout imports and applies NO_INDEX_METADATA inside its metadata export (covers /login and /signup only)', () => {
  const source = readFileSync(path.join(authDir, 'layout.tsx'), 'utf8')

  assert.match(
    source,
    /import\s*\{\s*NO_INDEX_METADATA\s*\}\s*from\s*['"]@\/lib\/seo\/noIndexMetadata['"]/,
    'missing NO_INDEX_METADATA import from the shared helper'
  )

  const metadataBlock = source.match(/export const metadata:\s*Metadata\s*=\s*\{[\s\S]*?\n\}/)
  assert.ok(metadataBlock, 'export const metadata block not found')
  assert.match(
    metadataBlock[0],
    /\.\.\.NO_INDEX_METADATA/,
    'metadata export does not spread NO_INDEX_METADATA'
  )
  // title/description must survive the merge, not be replaced by the spread
  assert.match(metadataBlock[0], /title:/)
  assert.match(metadataBlock[0], /description:/)
})

test('the (auth) route group contains only login and signup (noindex cannot leak to a third route)', () => {
  const entries = readdirSync(authDir).filter((name) => name !== 'layout.tsx')
  assert.deepEqual(entries.sort(), ['login', 'signup'])
})

test('login page is unaffected: still a client component with no metadata export of its own', () => {
  const source = readFileSync(path.join(authDir, 'login/page.tsx'), 'utf8')
  assert.match(source, /^'use client'/)
  assert.equal(source.includes('NO_INDEX_METADATA'), false)
  assert.equal(source.includes('export const metadata'), false)
})

test('signup page is unaffected: still a client component with no metadata export of its own', () => {
  const source = readFileSync(path.join(authDir, 'signup/page.tsx'), 'utf8')
  assert.match(source, /^'use client'/)
  assert.equal(source.includes('NO_INDEX_METADATA'), false)
  assert.equal(source.includes('export const metadata'), false)
})

test("login page's post-login redirect (router.push('/dashboard')) is unchanged", () => {
  const source = readFileSync(path.join(authDir, 'login/page.tsx'), 'utf8')
  assert.match(source, /router\.push\('\/dashboard'\)/)
})

test('login/signup OAuth redirectTo (/auth/callback) is unchanged', () => {
  const login = readFileSync(path.join(authDir, 'login/page.tsx'), 'utf8')
  const signup = readFileSync(path.join(authDir, 'signup/page.tsx'), 'utf8')
  assert.match(login, /redirectTo:\s*`\$\{location\.origin\}\/auth\/callback`/)
  assert.match(signup, /redirectTo:\s*`\$\{location\.origin\}\/auth\/callback`/)
})

test('root layout keeps the sitewide default of index, follow (no accidental global noindex)', () => {
  const source = readFileSync(rootLayoutPath, 'utf8')
  assert.match(source, /robots:\s*\{\s*index:\s*true,\s*follow:\s*true\s*\}/)
})
