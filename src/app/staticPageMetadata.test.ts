import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Static-source checks only. These page.tsx files render JSX (the page
// component itself), which Node's built-in TypeScript stripping does not
// compile, so they can't be `import`-ed directly the way the pure seo/*.ts
// helpers are — same constraint as notFoundBehavior.test.ts /
// publicBlogCache.test.ts. Files are read fresh on every run.

const appDir = path.dirname(fileURLToPath(import.meta.url))

function readPage(relPath: string): string {
  return readFileSync(path.join(appDir, relPath), 'utf8')
}

// --- /, /privacy-policy, /terms, /contact: shared checks -------------------

const ALL_PAGES = {
  home: { file: 'page.tsx', url: 'https://www.fitmate.run' },
  privacyPolicy: { file: 'privacy-policy/page.tsx', url: 'https://www.fitmate.run/privacy-policy' },
  terms: { file: 'terms/page.tsx', url: 'https://www.fitmate.run/terms' },
  contact: { file: 'contact/page.tsx', url: 'https://www.fitmate.run/contact' },
} as const

for (const key of Object.keys(ALL_PAGES) as (keyof typeof ALL_PAGES)[]) {
  const { file } = ALL_PAGES[key]

  test(`${key}: openGraph.type is website and siteName is FitMate`, () => {
    const source = readPage(file)
    assert.match(source, /type:\s*'website',/)
    assert.match(source, /siteName:\s*'FitMate',/)
  })

  test(`${key}: openGraph and twitter both reference the shared OG image`, () => {
    const source = readPage(file)
    assert.match(source, /images:\s*\[\{\s*url:\s*'\/og-image\.png'/)
    assert.match(source, /images:\s*\['\/og-image\.png'\],/)
  })

  test(`${key}: twitter.card is summary_large_image`, () => {
    const source = readPage(file)
    assert.match(source, /card:\s*'summary_large_image',/)
  })

  test(`${key}: does not define its own robots override (stays on the root default of index, follow)`, () => {
    const source = readPage(file)
    assert.equal(source.includes('robots:'), false)
    assert.equal(source.includes('noindex'), false)
  })

  test(`${key}: does not touch the page component's own return/JSX (metadata-only diff)`, () => {
    const source = readPage(file)
    assert.match(source, /export default function \w+Page\(\)\s*\{\s*\n\s*return \(/)
  })
}

test('all four canonical URLs are distinct (no duplicates across pages)', () => {
  const urls = Object.values(ALL_PAGES).map((p) => p.url)
  assert.equal(new Set(urls).size, urls.length)
})

test('all four canonical URLs are absolute https URLs on the www production host', () => {
  for (const { url } of Object.values(ALL_PAGES)) {
    assert.match(url, /^https:\/\/www\.fitmate\.run/)
  }
})

// --- /: kept its pre-existing (already correct) literal canonical/url ------

test('home: keeps its existing correct canonical (unchanged), as a literal string (no URL const introduced here)', () => {
  const source = readPage('page.tsx')
  const matches = source.match(/alternates:\s*\{\s*canonical:\s*'https:\/\/www\.fitmate\.run'\s*\}/g) ?? []
  assert.equal(matches.length, 1)
})

test("home: openGraph.url and canonical both resolve to the site root (no mismatch)", () => {
  const source = readPage('page.tsx')
  assert.match(source, /openGraph:\s*\{[\s\S]*?url:\s*'https:\/\/www\.fitmate\.run',/)
})

test('home: openGraph/twitter title and description now reuse the page\'s own TITLE/DESCRIPTION constants (previously fell back to the root defaults, which differed from the <title> tag)', () => {
  const source = readPage('page.tsx')
  assert.match(source, /const TITLE = 'FitMate \| 無料筋トレ・ダイエット管理アプリ - カロリー計算・体重記録'/)
  const openGraphBlock = source.match(/openGraph:\s*\{[\s\S]*?\n  \},/)?.[0] ?? ''
  const twitterBlock = source.match(/twitter:\s*\{[\s\S]*?\n  \},/)?.[0] ?? ''
  assert.match(openGraphBlock, /title:\s*TITLE,/)
  assert.match(openGraphBlock, /description:\s*DESCRIPTION,/)
  assert.match(twitterBlock, /title:\s*TITLE,/)
  assert.match(twitterBlock, /description:\s*DESCRIPTION,/)
})

test('home: keeps its keywords array (unchanged)', () => {
  const source = readPage('page.tsx')
  assert.match(source, /keywords:\s*\[/)
})

test('home: pre-existing JSON-LD (SoftwareApplication + FAQPage) count is unchanged at 2 (no new JSON-LD added)', () => {
  const source = readPage('page.tsx')
  const matches = source.match(/application\/ld\+json/g) ?? []
  assert.equal(matches.length, 2)
})

// --- /privacy-policy, /terms, /contact: canonical + URL-const checks -------

const LEGAL_PAGES = {
  privacyPolicy: { file: 'privacy-policy/page.tsx', url: 'https://www.fitmate.run/privacy-policy' },
  terms: { file: 'terms/page.tsx', url: 'https://www.fitmate.run/terms' },
  contact: { file: 'contact/page.tsx', url: 'https://www.fitmate.run/contact' },
} as const

for (const key of Object.keys(LEGAL_PAGES) as (keyof typeof LEGAL_PAGES)[]) {
  const { file, url } = LEGAL_PAGES[key]

  test(`${key}: has exactly one canonical, matching its own absolute URL (previously missing entirely)`, () => {
    const source = readPage(file)
    const matches = source.match(/alternates:\s*\{\s*canonical:\s*URL\s*\}/g) ?? []
    assert.equal(matches.length, 1, `expected exactly one alternates.canonical in ${key}`)
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(source, new RegExp(`const URL = '${escaped}'`))
  })

  test(`${key}: openGraph.url uses the same URL constant as canonical (previously leaked the homepage's URL)`, () => {
    const source = readPage(file)
    assert.match(source, /openGraph:\s*\{[\s\S]*?url:\s*URL,/)
  })

  test(`${key}: openGraph/twitter title and description use this page's own TITLE/DESCRIPTION (previously fell back to the root/homepage defaults)`, () => {
    const source = readPage(file)
    const openGraphBlock = source.match(/openGraph:\s*\{[\s\S]*?\n  \},/)?.[0] ?? ''
    const twitterBlock = source.match(/twitter:\s*\{[\s\S]*?\n  \},/)?.[0] ?? ''
    assert.match(openGraphBlock, /title:\s*TITLE,/)
    assert.match(openGraphBlock, /description:\s*DESCRIPTION,/)
    assert.match(twitterBlock, /title:\s*TITLE,/)
    assert.match(twitterBlock, /description:\s*DESCRIPTION,/)
  })

  test(`${key}: does not add any JSON-LD (0 before, 0 after)`, () => {
    const source = readPage(file)
    assert.equal(source.includes('application/ld+json'), false)
  })
}
