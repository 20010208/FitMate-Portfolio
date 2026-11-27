import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

// Importing generate-article.mjs must never trigger network calls, Supabase
// client construction, or process.exit -- all side-effecting work lives
// inside main(), which this file never calls.
const moduleUrl = pathToFileURL(path.resolve(import.meta.dirname, 'generate-article.mjs')).href
const {
  classifyInternalBlogLinkHref,
  validateInternalBlogLinks,
  unwrapInvalidInternalBlogLinks,
  sanitizeArticleHtml,
  buildInternalLinkCandidateList,
} = await import(moduleUrl)

const scriptSource = readFileSync(path.resolve(import.meta.dirname, 'generate-article.mjs'), 'utf8')

const SITE_ORIGIN = 'https://www.fitmate.run'

// ── classifyInternalBlogLinkHref ─────────────────────────────────────────

test('classify: relative /blog/<slug> -> candidate', () => {
  assert.deepEqual(classifyInternalBlogLinkHref('/blog/abc', SITE_ORIGIN), { kind: 'candidate', slug: 'abc' })
})

test('classify: /blog itself (the index page, no trailing slash) -> not_applicable, never touched', () => {
  assert.deepEqual(classifyInternalBlogLinkHref('/blog', SITE_ORIGIN), { kind: 'not_applicable' })
})

test('classify: /blog/ alone (empty slug segment) -> invalid malformed_path', () => {
  assert.deepEqual(classifyInternalBlogLinkHref('/blog/', SITE_ORIGIN), { kind: 'invalid', reason: 'malformed_path' })
})

test('classify: nested path /blog/abc/def -> invalid malformed_path', () => {
  assert.deepEqual(classifyInternalBlogLinkHref('/blog/abc/def', SITE_ORIGIN), { kind: 'invalid', reason: 'malformed_path' })
})

test('classify: query string /blog/abc?x=1 -> candidate slug "abc" (query ignored for identity)', () => {
  assert.deepEqual(classifyInternalBlogLinkHref('/blog/abc?x=1', SITE_ORIGIN), { kind: 'candidate', slug: 'abc' })
})

test('classify: hash /blog/abc#section -> candidate slug "abc" (hash ignored for identity)', () => {
  assert.deepEqual(classifyInternalBlogLinkHref('/blog/abc#section', SITE_ORIGIN), { kind: 'candidate', slug: 'abc' })
})

test('classify: absolute canonical https://www.fitmate.run/blog/abc -> candidate slug "abc" (allowed, same as relative)', () => {
  assert.deepEqual(classifyInternalBlogLinkHref('https://www.fitmate.run/blog/abc', SITE_ORIGIN), { kind: 'candidate', slug: 'abc' })
})

test('classify: external host with a /blog path (https://example.com/blog/abc) -> not_applicable, left to existing sanitize policy', () => {
  assert.deepEqual(classifyInternalBlogLinkHref('https://example.com/blog/abc', SITE_ORIGIN), { kind: 'not_applicable' })
})

test('classify: a Preview/Vercel-style hostname is treated the same as any other non-canonical origin -> not_applicable', () => {
  assert.deepEqual(
    classifyInternalBlogLinkHref('https://fit-mate-web-git-fix-branch.vercel.app/blog/abc', SITE_ORIGIN),
    { kind: 'not_applicable' }
  )
})

test('classify: a real external reference URL (not /blog-shaped at all) -> not_applicable', () => {
  assert.deepEqual(classifyInternalBlogLinkHref('https://www.mhlw.go.jp/stf/newpage_08517.html', SITE_ORIGIN), { kind: 'not_applicable' })
})

test('classify: malformed href that throws inside URL parsing -> handled safely as not_applicable, never crashes', () => {
  assert.doesNotThrow(() => {
    const result = classifyInternalBlogLinkHref('http://', SITE_ORIGIN)
    assert.deepEqual(result, { kind: 'not_applicable' })
  })
})

test('classify: non-string / null / undefined href -> not_applicable, never crashes', () => {
  assert.deepEqual(classifyInternalBlogLinkHref(null, SITE_ORIGIN), { kind: 'not_applicable' })
  assert.deepEqual(classifyInternalBlogLinkHref(undefined, SITE_ORIGIN), { kind: 'not_applicable' })
  assert.deepEqual(classifyInternalBlogLinkHref('', SITE_ORIGIN), { kind: 'not_applicable' })
})

test('classify: uppercase or underscore slug segment -> invalid malformed_path (same character class as validateSlug)', () => {
  assert.deepEqual(classifyInternalBlogLinkHref('/blog/ABC', SITE_ORIGIN), { kind: 'invalid', reason: 'malformed_path' })
  assert.deepEqual(classifyInternalBlogLinkHref('/blog/abc_def', SITE_ORIGIN), { kind: 'invalid', reason: 'malformed_path' })
})

// ── validateInternalBlogLinks (read-only report) ─────────────────────────

test('validateInternalBlogLinks: reports a real existing slug as valid', () => {
  const html = '<p>See <a href="/blog/abc">this article</a>.</p>'
  const result = validateInternalBlogLinks(html, new Set(['abc']))
  assert.deepEqual(result, [{ slug: 'abc', valid: true }])
})

test('validateInternalBlogLinks: reports a nonexistent slug as invalid', () => {
  const html = '<p>See <a href="/blog/missing">this article</a>.</p>'
  const result = validateInternalBlogLinks(html, new Set(['abc']))
  assert.deepEqual(result, [{ slug: 'missing', valid: false }])
})

test('validateInternalBlogLinks: a prefix collision (existing "abc-extra", href "/blog/abc") is invalid -- exact match only, no prefix match', () => {
  const html = '<p>See <a href="/blog/abc">this article</a>.</p>'
  const result = validateInternalBlogLinks(html, new Set(['abc-extra']))
  assert.deepEqual(result, [{ slug: 'abc', valid: false }])
})

test('validateInternalBlogLinks: external links and non-blog links are not reported at all', () => {
  const html = '<p><a href="https://example.com/blog/abc">external</a> and <a href="/signup">signup</a> and <a href="/blog">index</a>.</p>'
  const result = validateInternalBlogLinks(html, new Set(['abc']))
  assert.deepEqual(result, [])
})

test('validateInternalBlogLinks: does not mutate the input HTML (read-only)', () => {
  const html = '<p>See <a href="/blog/missing">this article</a>.</p>'
  validateInternalBlogLinks(html, new Set(['abc']))
  assert.equal(html, '<p>See <a href="/blog/missing">this article</a>.</p>')
})

// ── unwrapInvalidInternalBlogLinks (the actual publish-time transform) ───

test('A: a real existing slug is preserved (href unchanged, already canonical)', () => {
  const html = '<p>See <a href="/blog/abc">この記事</a>で詳しく解説しています。</p>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, '<p>See <a href="/blog/abc">この記事</a>で詳しく解説しています。</p>')
})

test('B: a nonexistent slug is unwrapped -- the link is removed but the anchor text remains in the body', () => {
  const html = '<p>See <a href="/blog/missing">プロテイン摂取タイミング</a>で詳しく解説しています。</p>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, '<p>See プロテイン摂取タイミングで詳しく解説しています。</p>')
})

test('C: a prefix collision is treated as invalid and unwrapped (not silently accepted as "close enough")', () => {
  const html = '<a href="/blog/abc">関連記事</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc-extra']))
  assert.equal(result, '関連記事')
})

test('D: a valid slug with a query string is normalized to the clean relative form (query dropped)', () => {
  const html = '<a href="/blog/abc?x=1">この記事</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, '<a href="/blog/abc">この記事</a>')
})

test('E: a valid slug with a hash fragment is normalized to the clean relative form (hash dropped)', () => {
  const html = '<a href="/blog/abc#section">この記事</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, '<a href="/blog/abc">この記事</a>')
})

test('F: a valid slug referenced via the absolute canonical URL is normalized down to the relative form', () => {
  const html = '<a href="https://www.fitmate.run/blog/abc">この記事</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, '<a href="/blog/abc">この記事</a>')
})

test('G: an external host with a /blog-shaped path is left completely untouched by this whitelist (existing sanitize policy applies, not internal-link rules)', () => {
  const html = '<a href="https://example.com/blog/abc" target="_blank" rel="noopener noreferrer">外部サイト</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, html)
})

test('H: a malformed href does not crash the transform and is left untouched (out of scope for this whitelist, same as any other non-blog href)', () => {
  assert.doesNotThrow(() => {
    const html = '<a href="http://">malformed</a>'
    unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  })
})

test('I: duplicate links to the same real slug are both preserved -- this pass only removes invalid links, it does not deduplicate repeated valid ones. Deduplication is the prompt\'s responsibility ("同じ記事へのリンクを複数回入れない"), not a programmatic guard, per this round\'s explicit instruction to skip a JS-based similarity/dedupe guard', () => {
  const html = '<a href="/blog/abc">記事1</a>と<a href="/blog/abc">同じ記事</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, html)
})

test('J: after unwrapping an invalid link, the surrounding text and other valid links in the same content are unaffected', () => {
  const html = '<p>まず<a href="/blog/abc">実在する記事</a>を読み、次に<a href="/blog/missing">存在しない記事</a>も参照してください。</p>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, '<p>まず<a href="/blog/abc">実在する記事</a>を読み、次に存在しない記事も参照してください。</p>')
})

test('target/rel attributes on a valid internal link are preserved unchanged (this pass only touches href)', () => {
  const html = '<a href="/blog/abc" target="_blank" rel="noopener noreferrer">記事</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, '<a href="/blog/abc" target="_blank" rel="noopener noreferrer">記事</a>')
})

test('a real reference link (external, http(s), not /blog-shaped) is never touched by this pass', () => {
  const html = '<a href="https://www.mhlw.go.jp/stf/newpage_08517.html" target="_blank" rel="noopener noreferrer">厚生労働省</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, html)
})

test('a link to the blog index page itself (/blog) is never touched by this pass', () => {
  const html = '<a href="/blog">ブログ一覧</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, html)
})

// ── buildInternalLinkCandidateList ───────────────────────────────────────

test('buildInternalLinkCandidateList: compact "title | /blog/slug" format, one per line', () => {
  const posts = [
    { title: 'PFCバランスの計算方法', slug: 'pfc-balance-keisan-houhou' },
    { title: 'プロテインのタイミング', slug: 'important-protein-timing-in-workout' },
  ]
  const result = buildInternalLinkCandidateList(posts)
  assert.equal(
    result,
    'PFCバランスの計算方法 | /blog/pfc-balance-keisan-houhou\nプロテインのタイミング | /blog/important-protein-timing-in-workout'
  )
})

test('buildInternalLinkCandidateList: empty existingPosts -> empty string', () => {
  assert.equal(buildInternalLinkCandidateList([]), '')
})

test('buildInternalLinkCandidateList: caps at maxCandidates, keeping the earliest entries in the given order (existingPosts is expected published_at DESC, so this keeps the most recent)', () => {
  const posts = Array.from({ length: 10 }, (_, i) => ({ title: `記事${i}`, slug: `article-${i}` }))
  const result = buildInternalLinkCandidateList(posts, 3)
  assert.equal(result, '記事0 | /blog/article-0\n記事1 | /blog/article-1\n記事2 | /blog/article-2')
})

test('buildInternalLinkCandidateList: default cap exists and is a bounded number (future-proofing so prompt size does not grow unbounded at 100/300/1000 articles)', () => {
  const posts = Array.from({ length: 500 }, (_, i) => ({ title: `記事${i}`, slug: `article-${i}` }))
  const result = buildInternalLinkCandidateList(posts)
  const lineCount = result.split('\n').length
  assert.ok(lineCount < 500, `expected the candidate list to be capped well below 500 entries, got ${lineCount}`)
  assert.ok(lineCount > 0)
})

// ── Static-source checks: prompt content ─────────────────────────────────

test('prompt: the hardcoded pfc-balance-keisan-houhou example URL is gone from the internal-link instructions', () => {
  const internalLinkSectionStart = scriptSource.indexOf('【内部リンクのルール】')
  const internalLinkSectionEnd = scriptSource.indexOf('【参考文献のルール】')
  const section = scriptSource.slice(internalLinkSectionStart, internalLinkSectionEnd)
  assert.equal(section.includes('pfc-balance-keisan-houhou'), false)
})

test('prompt: real slug/title candidate list is injected via buildInternalLinkCandidateList, not a static example', () => {
  assert.match(scriptSource, /internalLinkCandidateList = buildInternalLinkCandidateList\(existingPosts/)
  assert.match(scriptSource, /internalLinkCandidatesText/)
  assert.match(scriptSource, /const userPrompt = `[^`]*\$\{internalLinkCandidatesText\}/)
})

test('prompt: internal links are explicitly bounded to 0-2 and constrained to the candidate list only', () => {
  const internalLinkSectionStart = scriptSource.indexOf('【内部リンクのルール】')
  const internalLinkSectionEnd = scriptSource.indexOf('【参考文献のルール】')
  const section = scriptSource.slice(internalLinkSectionStart, internalLinkSectionEnd)
  assert.match(section, /0〜2件/)
  assert.match(section, /候補一覧に実在するURL/)
  assert.match(section, /新しく作らない/)
  assert.match(section, /複数回入れない/)
  assert.match(section, /この記事自身にはリンクしない/)
  assert.match(section, /こちら/)
})

test('prompt: topic-selection cannibalization guidance targets same search intent, not just literal word overlap', () => {
  const topicSectionStart = scriptSource.indexOf('あなたはFitMateというフィットネスアプリのブログ編集長です')
  const topicSectionEnd = scriptSource.indexOf('必ずJSON形式で返答してください', topicSectionStart)
  const section = scriptSource.slice(topicSectionStart, topicSectionEnd)
  assert.match(section, /検索意図/)
  assert.match(section, /語尾/)
})

test('regression: OpenAI call count is still exactly 3 (topic selection + article generation + fact check) -- no new call was added for link validation', () => {
  const calls = scriptSource.split('openai.chat.completions.create(').length - 1
  assert.equal(calls, 3)
})

test('regression: internal link validation adds zero new OpenAI/network calls -- the whole internal-link whitelist section never references openai or fetch', () => {
  const sectionStart = scriptSource.indexOf('// ── 内部blog linkのwhitelist検証（AI promptだけに依存しない多層防御）')
  const sectionEnd = scriptSource.indexOf('// sanitize-html自体を信頼しつつも', sectionStart)
  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart)
  const sectionSource = scriptSource.slice(sectionStart, sectionEnd)
  assert.equal(/openai/i.test(sectionSource), false)
  assert.equal(/fetch\(/.test(sectionSource), false)
})

test('regression: no new Supabase query was added for internal-link candidates -- existingPosts (already fetched once) is reused, not re-queried', () => {
  const fromBlogsCallCount = (scriptSource.match(/\.from\('blogs'\)/g) ?? []).length
  // Exactly 2 calls to .from('blogs') are expected in this file: the
  // existing-posts SELECT (for dedup + link candidates) and the final
  // INSERT. Related-articles logic lives in the Next.js app, not here.
  assert.equal(fromBlogsCallCount, 2)
})

// ── Codex-reproduced HTML corruption fix: no fake/pseudo tag -────────────
// The original implementation renamed excluded <a> elements to an
// allowlist-external tag name ('fitmate-unwrap-link') and relied on
// sanitize-html's default disallowed-tag discard behavior to strip it.
// Codex reproduced a real bug with that approach: when an excluded anchor
// was immediately followed by a kept anchor, the closing tag of the KEPT
// anchor was corrupted into `</fitmate-unwrap-link>`, breaking the
// following link entirely. The fix replaces the fake-tag rename with
// sanitize-html's own `exclusiveFilter` -> `'excludeTag'` mechanism, which
// removes exactly the excluded tag's own open/close pair via position
// tracking and never touches sibling elements. Every test below asserts
// both the exact expected output AND the complete absence of the string
// 'fitmate-unwrap-link' anywhere in the result.

function assertNoFakeTag(output) {
  assert.equal(output.includes('fitmate-unwrap-link'), false, `fake tag leaked into output: ${output}`)
}

test('A: invalid -> valid (the exact sequence Codex reproduced) -- closing tag of the valid anchor is correct', () => {
  const html = '<a href="/blog/missing">bad</a><a href="/blog/abc">good</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, 'bad<a href="/blog/abc">good</a>')
  assertNoFakeTag(result)
})

test('B: invalid -> external -- the external anchor is not corrupted', () => {
  const html = '<a href="/blog/missing">bad</a><a href="https://example.com">good</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, 'bad<a href="https://example.com">good</a>')
  assertNoFakeTag(result)
})

test('C: invalid -> affiliate-style external link (target=_blank, custom rel) -- fully preserved, this pass never touches non-internal-blog links', () => {
  const html = '<a href="/blog/missing">bad</a><a href="https://a8.net/xyz" target="_blank" rel="nofollow noopener">affiliate</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, 'bad<a href="https://a8.net/xyz" target="_blank" rel="nofollow noopener">affiliate</a>')
  assertNoFakeTag(result)
})

test('D: valid -> invalid -- both directions work, not just invalid-first', () => {
  const html = '<a href="/blog/abc">good</a><a href="/blog/missing">bad</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, '<a href="/blog/abc">good</a>bad')
  assertNoFakeTag(result)
})

test('E: invalid -> invalid -- both anchors unwrapped, both texts preserved, no stray tags between them', () => {
  const html = '<a href="/blog/missing1">bad1</a><a href="/blog/missing2">bad2</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, 'bad1bad2')
  assertNoFakeTag(result)
})

test('F: 4 mixed anchors (invalid / valid / external / invalid) -- every closing tag is correct throughout', () => {
  const html = '<a href="/blog/missing1">bad1</a><a href="/blog/abc">good</a><a href="https://example.com">ext</a><a href="/blog/missing2">bad2</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, 'bad1<a href="/blog/abc">good</a><a href="https://example.com">ext</a>bad2')
  assertNoFakeTag(result)
})

test('G: nested child markup inside an invalid anchor is preserved, only the <a> wrapper is removed', () => {
  const html = '<a href="/blog/missing"><strong>重要</strong>な説明</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, '<strong>重要</strong>な説明')
  assertNoFakeTag(result)
})

test('H: multiline anchor content is preserved across the unwrap', () => {
  const html = '<a href="/blog/missing">\n  bad\n</a><a href="/blog/abc">good</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, '\n  bad\n<a href="/blog/abc">good</a>')
  assertNoFakeTag(result)
})

test('I: multiple attributes on the surviving valid anchor are unaffected by an adjacent invalid anchor', () => {
  const html = '<a href="/blog/missing">bad</a><a href="/blog/abc" target="_blank" rel="noopener noreferrer">good</a>'
  const result = unwrapInvalidInternalBlogLinks(html, new Set(['abc']))
  assert.equal(result, 'bad<a href="/blog/abc" target="_blank" rel="noopener noreferrer">good</a>')
  assertNoFakeTag(result)
})

test('J: the fake tag name is not used as a live identifier/value anywhere in the implementation (only mentioned in comments documenting the fixed bug)', () => {
  const codeOnly = scriptSource
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/**')
    })
    .join('\n')
  assert.equal(codeOnly.includes('fitmate-unwrap-link'), false)
  assert.equal(codeOnly.includes('UNWRAP_TAG_NAME'), false)
})

test('the fix also applies to sanitizeArticleHtml() itself (the same fake-tag pattern existed there for unsafe hrefs)', () => {
  const html = '<a href="javascript:alert(1)">bad</a><a href="/blog/abc">good</a>'
  const result = sanitizeArticleHtml(html)
  assert.equal(result, 'bad<a href="/blog/abc">good</a>')
  assertNoFakeTag(result)
})

test('sanitizeArticleHtml(): protocol-relative unsafe href followed by a safe absolute href -- no corruption', () => {
  const html = '<a href="//evil.example/x">bad</a><a href="https://ok.example">good</a>'
  const result = sanitizeArticleHtml(html)
  assert.equal(result, 'bad<a href="https://ok.example">good</a>')
  assertNoFakeTag(result)
})

test('sanitizeArticleHtml(): target/rel normalization for a kept _blank link still works correctly alongside an excluded sibling', () => {
  const html = '<a href="javascript:alert(1)">bad</a><a href="https://ok.example" target="_blank">good</a>'
  const result = sanitizeArticleHtml(html)
  assert.equal(result, 'bad<a href="https://ok.example" target="_blank" rel="noopener noreferrer">good</a>')
  assertNoFakeTag(result)
})

test('sanitizeArticleHtml() uses exclusiveFilter (excludeTag), not a transformTags-based fake-tag rename, for unsafe hrefs', () => {
  const fnStart = scriptSource.indexOf('export function sanitizeArticleHtml')
  const fnEnd = scriptSource.indexOf('\n// ── 内部blog linkのwhitelist検証')
  assert.ok(fnStart >= 0 && fnEnd > fnStart)
  const fnSource = scriptSource.slice(fnStart, fnEnd)
  assert.match(fnSource, /exclusiveFilter/)
  assert.match(fnSource, /'excludeTag'/)
})

test('unwrapInvalidInternalBlogLinks() uses exclusiveFilter (excludeTag), not a transformTags-based fake-tag rename', () => {
  const fnStart = scriptSource.indexOf('export function unwrapInvalidInternalBlogLinks')
  const fnEnd = scriptSource.indexOf('\nconst DEFAULT_MAX_INTERNAL_LINK_CANDIDATES')
  assert.ok(fnStart >= 0 && fnEnd > fnStart)
  const fnSource = scriptSource.slice(fnStart, fnEnd)
  assert.match(fnSource, /exclusiveFilter/)
  assert.match(fnSource, /'excludeTag'/)
})

// ── Codex-required: existing-posts SELECT is fail-closed and published-only

test('the existing-posts query includes .eq(\'is_published\', true) -- drafts/unpublished rows must never enter title-dedup, link candidates, or the whitelist', () => {
  const queryStart = scriptSource.indexOf("select('slug, title')")
  const queryEnd = scriptSource.indexOf('.order(', queryStart)
  assert.ok(queryStart >= 0 && queryEnd > queryStart)
  const querySource = scriptSource.slice(queryStart, queryEnd)
  assert.match(querySource, /\.eq\('is_published', true\)/)
})

test('the OpenAI article-generation call and the final INSERT are both reachable only after the existing-posts fail-closed check', () => {
  const checkIndex = scriptSource.indexOf('if (!existingPostsResult.ok)')
  const firstOpenaiCallIndex = scriptSource.indexOf('openai.chat.completions.create(', checkIndex)
  const insertIndex = scriptSource.indexOf('.insert({', checkIndex)
  assert.ok(checkIndex >= 0 && firstOpenaiCallIndex >= 0 && insertIndex >= 0)
  assert.ok(checkIndex < firstOpenaiCallIndex)
  assert.ok(checkIndex < insertIndex)
})
