import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

// Importing generate-article.mjs must never trigger network calls, Supabase
// client construction, or process.exit -- all side-effecting work lives
// inside main(), which this file never calls. This is what makes it safe
// to import the module directly for testing the pure exported functions.
const moduleUrl = pathToFileURL(path.resolve(import.meta.dirname, 'generate-article.mjs')).href
const {
  readManualKeyword,
  sanitizeArticleHtml,
  validateSanitizedArticleHtml,
  estimateReadingMinutes,
  sanitizeLogValue,
  formatOpenAiError,
  validateTitle,
  validateDescription,
  validateCategory,
  validateSlug,
  validateReadingMinutes,
  validatePublishedAt,
} = await import(moduleUrl)

// --- Codex監査 修正 High 1: workflow_dispatch keywordのshell injection -----
// keywordはAUTO_BLOG_KEYWORD環境変数(GitHub Actions側でenv:経由のみ設定)経由
// で読み取り、shell commandへ直接展開しない。ここではreadManualKeyword()の
// 検証ロジック(長さ・制御文字・null byte)のみを確認する。shell metacharacter
// を含む値がshell command構造を変えないことの実証は、本ファイル末尾の
// process-level testで行う。

test('readManualKeyword: no AUTO_BLOG_KEYWORD and no argv -> empty/valid (normal cron auto-select)', () => {
  const result = readManualKeyword({}, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '', valid: true })
})

test('readManualKeyword: empty string AUTO_BLOG_KEYWORD -> empty/valid (normal cron auto-select)', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: '' }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '', valid: true })
})

test('readManualKeyword: whitespace-only AUTO_BLOG_KEYWORD -> empty/valid', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: '   ' }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '', valid: true })
})

test('readManualKeyword: a normal Japanese keyword is accepted and trimmed', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: '  プロテイン摂取タイミング  ' }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: 'プロテイン摂取タイミング', valid: true })
})

test('readManualKeyword: exactly 100 characters is accepted (boundary)', () => {
  const keyword = 'あ'.repeat(100)
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: keyword }, ['node', 'script.mjs'])
  assert.equal(result.valid, true)
  assert.equal(result.keyword.length, 100)
})

test('readManualKeyword: 101 characters is rejected (too_long)', () => {
  const keyword = 'あ'.repeat(101)
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: keyword }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '', valid: false, reason: 'too_long' })
})

test('readManualKeyword: rejects a null byte', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: `a${String.fromCharCode(0)}b` }, ['node', 'script.mjs'])
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'null_byte')
})

test('readManualKeyword: rejects control characters (e.g. a raw newline)', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: 'line1\nline2' }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '', valid: false, reason: 'control_characters' })
})

test('readManualKeyword: rejects a tab character', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: 'a\tb' }, ['node', 'script.mjs'])
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'control_characters')
})

// --- Codex監査 follow-up 修正1: trim前の制御文字検証 -------------------------
// 旧実装はraw.trim()した後に制御文字を検証していたため、先頭・末尾だけの
// 改行やtabがtrimで消えて誤って受理されてしまっていた。制御文字の検証は
// trimより前(生の値)に対して行う。

test('readManualKeyword: rejects a leading newline that trim() would otherwise remove before validation ("\\nkeyword")', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: '\nkeyword' }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '', valid: false, reason: 'control_characters' })
})

test('readManualKeyword: rejects a trailing newline ("keyword\\n")', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: 'keyword\n' }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '', valid: false, reason: 'control_characters' })
})

test('readManualKeyword: rejects a leading tab ("\\tkeyword")', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: '\tkeyword' }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '', valid: false, reason: 'control_characters' })
})

test('readManualKeyword: rejects a trailing tab ("keyword\\t")', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: 'keyword\t' }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '', valid: false, reason: 'control_characters' })
})

test('readManualKeyword: rejects a leading carriage return ("\\rkeyword")', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: '\rkeyword' }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '', valid: false, reason: 'control_characters' })
})

test('readManualKeyword: a value that is ONLY control characters is rejected, not silently treated as empty/normal-cron (this is the key behavioral difference from the old post-trim validation)', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: '\n\t\r' }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '', valid: false, reason: 'control_characters' })
})

// --- Codex再監査 follow-up 修正2: C1制御文字（U+0080-U+009F）の拒否 -----------
// 旧実装はC0（U+0000-U+001F）とDEL（U+007F）のみを制御文字として拒否しており、
// C1範囲（U+0080-U+009F、NEL/SS2/SS3/DCS/CSI/ST/OSC等の8bit制御コードを含む）は
// 素通りしていた。CONTROL_CHAR_PATTERNをC1範囲まで拡張し、キーワード・
// タイトル・説明文・ログの各入力で一貫して拒否/除去する。

test('readManualKeyword: rejects U+0085 (NEL, a C1 control character)', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: `a${String.fromCharCode(0x85)}b` }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '', valid: false, reason: 'control_characters' })
})

test('readManualKeyword: rejects U+009C (C1 ST, string terminator)', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: `a${String.fromCharCode(0x9c)}b` }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '', valid: false, reason: 'control_characters' })
})

test('readManualKeyword: rejects U+009D (C1 OSC, operating system command)', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: `a${String.fromCharCode(0x9d)}b` }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '', valid: false, reason: 'control_characters' })
})

test('readManualKeyword: rejects U+009B (C1 CSI, control sequence introducer)', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: `a${String.fromCharCode(0x9b)}b` }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '', valid: false, reason: 'control_characters' })
})

test('readManualKeyword: still accepts normal Japanese, English, numbers, punctuation, and emoji (C1 widening must not break ordinary Unicode text)', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: '筋トレ 食事管理2026！💪' }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '筋トレ 食事管理2026！💪', valid: true })
})

test('readManualKeyword: a genuinely empty string is still treated as "normal cron auto-select" (no control characters to reject)', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: '' }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '', valid: true })
})

test('readManualKeyword: ordinary leading/trailing spaces (not control characters) around a normal Japanese keyword are still accepted and trimmed', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: '  プロテイン摂取タイミング  ' }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: 'プロテイン摂取タイミング', valid: true })
})

test('readManualKeyword: emoji are accepted (not control characters)', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: '筋トレ💪最強ガイド' }, ['node', 'script.mjs'])
  assert.deepEqual(result, { keyword: '筋トレ💪最強ガイド', valid: true })
})

test('readManualKeyword: shell metacharacters are NOT rejected by keyword validation itself (they are harmless once passed via env var and used only as OpenAI prompt text -- never as a shell/file/SQL/env-name/code context)', () => {
  const dangerous = [
    'test"; echo hacked; #',
    '$(echo hacked)',
    '`echo hacked`',
    '| cat /etc/passwd',
    '&& false',
    "'; DROP TABLE blogs; --",
  ]
  for (const value of dangerous) {
    const result = readManualKeyword({ AUTO_BLOG_KEYWORD: value }, ['node', 'script.mjs'])
    assert.equal(result.valid, true, `expected ${JSON.stringify(value)} to be accepted as plain text`)
    assert.equal(result.keyword, value)
  }
})

test('readManualKeyword: falls back to argv[2] only when AUTO_BLOG_KEYWORD is absent (local CLI convenience, not used by the workflow)', () => {
  const result = readManualKeyword({}, ['node', 'script.mjs', 'ローカル指定キーワード'])
  assert.deepEqual(result, { keyword: 'ローカル指定キーワード', valid: true })
})

test('readManualKeyword: AUTO_BLOG_KEYWORD takes precedence over argv[2] when both are present', () => {
  const result = readManualKeyword({ AUTO_BLOG_KEYWORD: 'env優先' }, ['node', 'script.mjs', 'argv値'])
  assert.deepEqual(result, { keyword: 'env優先', valid: true })
})

// --- Codex監査 修正 High 2: AI生成HTMLのstored XSS ---------------------------
// sanitizeArticleHtml()はsanitize-html(実績あるライブラリ)のallowlist方式のみ
// を使用し、自作正規表現によるHTML除去は行わない。

test('sanitize: <script> tags are removed entirely, including their text content', () => {
  const out = sanitizeArticleHtml('<script>alert(1)</script>')
  assert.equal(out, '')
})

test('sanitize: <img onerror> is removed (img is not in the allowlist for this AI-generated content)', () => {
  const out = sanitizeArticleHtml('<img src=x onerror=alert(1)>')
  assert.equal(out, '')
  assert.doesNotMatch(out, /onerror/i)
})

test('sanitize: javascript: href is stripped and the <a> is fully unwrapped (Codex-audit follow-up: no bare href-less <a> tag survives, only its text)', () => {
  const out = sanitizeArticleHtml('<a href="javascript:alert(1)">x</a>')
  assert.doesNotMatch(out, /javascript:/i)
  assert.doesNotMatch(out, /<a[\s>]/i)
  assert.equal(out, 'x')
})

test('sanitize: mixed-case javascript: href is stripped and unwrapped', () => {
  const out = sanitizeArticleHtml('<a href="JaVaScRiPt:alert(1)">x</a>')
  assert.doesNotMatch(out, /javascript:/i)
  assert.doesNotMatch(out, /<a[\s>]/i)
})

test('sanitize: javascript: href with an embedded tab is stripped', () => {
  const out = sanitizeArticleHtml('<a href="java\tscript:alert(1)">x</a>')
  assert.doesNotMatch(out, /javascript:/i)
})

test('sanitize: HTML-entity-encoded javascript: href is stripped', () => {
  const out = sanitizeArticleHtml('<a href="&#106;avascript:alert(1)">x</a>')
  assert.doesNotMatch(out, /javascript:/i)
})

test('sanitize: data: href is stripped (only http/https schemes are allowed)', () => {
  const out = sanitizeArticleHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>')
  assert.doesNotMatch(out, /data:/i)
  assert.doesNotMatch(out, /<script/i)
})

test('sanitize: vbscript: href is stripped', () => {
  const out = sanitizeArticleHtml('<a href="vbscript:msgbox(1)">x</a>')
  assert.doesNotMatch(out, /vbscript:/i)
})

test('sanitize: protocol-relative href is stripped', () => {
  const out = sanitizeArticleHtml('<a href="//evil.example.com/x">x</a>')
  assert.doesNotMatch(out, /evil\.example\.com/i)
})

test('sanitize: <iframe> is removed entirely', () => {
  const out = sanitizeArticleHtml('<iframe src="https://example.com"></iframe>')
  assert.equal(out, '')
})

test('sanitize: <svg onload> is removed entirely', () => {
  const out = sanitizeArticleHtml('<svg onload=alert(1)>x</svg>')
  assert.doesNotMatch(out, /<svg/i)
  assert.doesNotMatch(out, /onload/i)
})

test('sanitize: <style> tags are removed entirely, including their CSS content', () => {
  const out = sanitizeArticleHtml('<style>body{background:url(javascript:alert(1))}</style>')
  assert.equal(out, '')
})

test('sanitize: on* event handler attributes are stripped from otherwise-allowed tags', () => {
  const out = sanitizeArticleHtml('<div onclick="alert(1)">x</div>')
  assert.doesNotMatch(out, /onclick/i)
})

test('sanitize: <object>/<embed>/<form> are removed entirely', () => {
  assert.equal(sanitizeArticleHtml('<object data="evil.swf"></object>'), '')
  assert.equal(sanitizeArticleHtml('<embed src="evil.swf">'), '')
  assert.doesNotMatch(sanitizeArticleHtml('<form action="evil"><input></form>'), /<form|<input/i)
})

test('sanitize: a disallowed div class (not "blog-references") is stripped, but the div and its safe children survive', () => {
  const out = sanitizeArticleHtml('<div class="evil-tracker"><p>text</p></div>')
  assert.doesNotMatch(out, /evil-tracker/)
  assert.match(out, /<p>text<\/p>/)
})

test('sanitize: target="_blank" without rel gets noopener/noreferrer auto-injected (reverse-tabnabbing defense)', () => {
  const out = sanitizeArticleHtml('<a href="https://example.com" target="_blank">x</a>')
  assert.match(out, /rel="[^"]*noopener[^"]*"/)
  assert.match(out, /rel="[^"]*noreferrer[^"]*"/)
})

// --- Codex監査 follow-up 修正4: a要素のtarget/rel正規化 ---------------------

test('link normalization: target="_blank" -- rel is replaced with exactly "noopener noreferrer", any AI-supplied rel tokens are discarded', () => {
  const out = sanitizeArticleHtml('<a href="https://example.com" target="_blank" rel="garbage-token evil">x</a>')
  assert.equal(out, '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>')
})

test('link normalization: a named-window target (not "_blank") is removed entirely, and rel is removed too (no target means no rel)', () => {
  const out = sanitizeArticleHtml('<a href="https://example.com" target="mywindow">x</a>')
  assert.equal(out, '<a href="https://example.com">x</a>')
})

test('link normalization: target="_self" is removed', () => {
  assert.equal(sanitizeArticleHtml('<a href="https://example.com" target="_self">x</a>'), '<a href="https://example.com">x</a>')
})

test('link normalization: target="_parent" is removed', () => {
  assert.equal(sanitizeArticleHtml('<a href="https://example.com" target="_parent">x</a>'), '<a href="https://example.com">x</a>')
})

test('link normalization: target="_top" is removed', () => {
  assert.equal(sanitizeArticleHtml('<a href="https://example.com" target="_top">x</a>'), '<a href="https://example.com">x</a>')
})

test('link normalization: an AI-supplied rel with no target present is removed entirely (never left as an arbitrary token)', () => {
  const out = sanitizeArticleHtml('<a href="https://example.com" rel="nofollow">x</a>')
  assert.equal(out, '<a href="https://example.com">x</a>')
})

test('link normalization: an internal relative link with no target is preserved without any target/rel added', () => {
  const input = '<a href="/blog/pfc-balance-keisan-houhou">PFCバランスの計算方法完全ガイド</a>'
  assert.equal(sanitizeArticleHtml(input), input)
})

test('link normalization: after removing a dangerous href, no bare href-less <a> tag remains -- the whole element unwraps to its text', () => {
  assert.equal(sanitizeArticleHtml('<a href="javascript:alert(1)">click</a>'), 'click')
  assert.equal(sanitizeArticleHtml('<a href="data:text/html,x">click</a>'), 'click')
  assert.equal(sanitizeArticleHtml('<a href="vbscript:x">click</a>'), 'click')
  assert.equal(sanitizeArticleHtml('<a href="//evil.example.com/x">click</a>'), 'click')
})

test('link normalization: an <a> with no href attribute at all is unwrapped to its text (not left as a bare, non-functional-looking link)', () => {
  assert.equal(sanitizeArticleHtml('<a target="_blank">no href here</a>'), 'no href here')
})

test('link normalization: an unwrapped link inside surrounding text merges naturally, no stray tag fragments remain', () => {
  const out = sanitizeArticleHtml('<p>before <a href="javascript:x">bad</a> after</p>')
  assert.equal(out, '<p>before bad after</p>')
})

test('link normalization: a safe https link (with target=_blank) survives with the correct href, target, and rel', () => {
  const input = '<a href="https://www.who.int/" target="_blank" rel="noopener noreferrer">WHO</a>'
  assert.equal(sanitizeArticleHtml(input), input)
})

test('link normalization: relative URL policy -- only a single leading slash (same-origin path) is treated as safe; protocol-relative ("//host/...") is not', () => {
  assert.equal(sanitizeArticleHtml('<a href="/blog/x">safe relative</a>'), '<a href="/blog/x">safe relative</a>')
  assert.equal(sanitizeArticleHtml('<a href="//evil.example.com/x">unsafe protocol-relative</a>'), 'unsafe protocol-relative')
})

// --- safe HTML is preserved -------------------------------------------------

test('sanitize: headings (h2/h3/h4), paragraphs, and lists survive unchanged', () => {
  assert.equal(sanitizeArticleHtml('<h2>見出し</h2>'), '<h2>見出し</h2>')
  assert.equal(sanitizeArticleHtml('<h3>小見出し</h3>'), '<h3>小見出し</h3>')
  assert.equal(sanitizeArticleHtml('<h4>補助見出し</h4>'), '<h4>補助見出し</h4>')
  assert.equal(sanitizeArticleHtml('<p>本文です。</p>'), '<p>本文です。</p>')
  assert.equal(sanitizeArticleHtml('<ul><li>a</li><li>b</li></ul>'), '<ul><li>a</li><li>b</li></ul>')
  assert.equal(sanitizeArticleHtml('<ol><li>手順1</li></ol>'), '<ol><li>手順1</li></ol>')
})

test('sanitize: strong/em survive unchanged', () => {
  assert.equal(sanitizeArticleHtml('<strong>重要</strong>'), '<strong>重要</strong>')
  assert.equal(sanitizeArticleHtml('<em>強調</em>'), '<em>強調</em>')
})

test('sanitize: a safe https link with target/rel survives unchanged', () => {
  const input = '<a href="https://www.mhlw.go.jp/" target="_blank" rel="noopener noreferrer">厚生労働省</a>'
  assert.equal(sanitizeArticleHtml(input), input)
})

test('sanitize: a safe relative internal link survives unchanged', () => {
  const input = '<a href="/blog/pfc-balance-keisan-houhou">PFCバランスの計算方法完全ガイド</a>'
  assert.equal(sanitizeArticleHtml(input), input)
})

test('sanitize: the blog-references div wrapper (with its allowed class) survives with its children', () => {
  const input = '<div class="blog-references"><h3>参考資料</h3><p>説明</p><ul><li><a href="https://who.int" target="_blank" rel="noopener noreferrer">WHO</a></li></ul></div>'
  assert.equal(sanitizeArticleHtml(input), input)
})

test('sanitize: inline style attributes are dropped (redundant with existing .blog-content/.blog-references CSS, and not part of the minimal allowlist)', () => {
  const out = sanitizeArticleHtml('<a href="/blog/x" style="color:red;">x</a>')
  assert.doesNotMatch(out, /style=/i)
})

// --- validateSanitizedArticleHtml -------------------------------------------

test('validate: empty sanitized HTML fails', () => {
  assert.deepEqual(validateSanitizedArticleHtml(''), { ok: false, reason: 'empty_after_sanitize' })
  assert.deepEqual(validateSanitizedArticleHtml('   '), { ok: false, reason: 'empty_after_sanitize' })
})

test('validate: HTML shorter than the minimum length fails even with a valid h2', () => {
  const short = '<h2>短い</h2><p>' + 'あ'.repeat(10) + '</p>'
  const result = validateSanitizedArticleHtml(short)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'too_short')
})

test('validate: HTML with no <h2> heading fails even if long enough', () => {
  const noHeading = '<p>' + 'あ'.repeat(900) + '</p>'
  const result = validateSanitizedArticleHtml(noHeading)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'missing_required_heading')
})

// --- Codex監査 follow-up 修正5: 非空h2の実質判定・HTML entity decode --------
// 単に<h2>タグの存在だけでなく、少なくとも1件のh2に実質的なテキストがある
// ことを、sanitize-htmlと同じHTMLパーサ経由(exclusiveFilterのframe.text)で
// 確認する。正規表現だけでのHTML解析は行わない。

test('validate: an empty <h2></h2> is treated as having no real heading, even though the tag itself is present', () => {
  const body = '<h2></h2><p>' + 'あ'.repeat(900) + '</p>'
  const result = validateSanitizedArticleHtml(body)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'missing_required_heading')
})

test('validate: a whitespace-only <h2>   </h2> is treated as having no real heading', () => {
  const body = '<h2>   </h2><p>' + 'あ'.repeat(900) + '</p>'
  const result = validateSanitizedArticleHtml(body)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'missing_required_heading')
})

test('validate: a <h2><br></h2> with only a line break and no text is treated as having no real heading', () => {
  const body = '<h2><br></h2><p>' + 'あ'.repeat(900) + '</p>'
  const result = validateSanitizedArticleHtml(body)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'missing_required_heading')
})

test('validate: a <h2>&nbsp;</h2> (non-breaking space entity only) is treated as having no real heading (entity is decoded before the emptiness check)', () => {
  const body = '<h2>&nbsp;</h2><p>' + 'あ'.repeat(900) + '</p>'
  const result = validateSanitizedArticleHtml(body)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'missing_required_heading')
})

test('validate: a heading with real text alongside other empty headings still passes (only one non-empty h2 is required)', () => {
  const body = '<h2></h2><p>filler</p><h2>本物の見出し</h2><p>' + 'あ'.repeat(900) + '</p>'
  const result = validateSanitizedArticleHtml(body)
  assert.deepEqual(result, { ok: true })
})

test('validate: massive &nbsp; padding does not count toward the plain-text length requirement (HTML entities are decoded, then collapsed as whitespace, before measuring real body length)', () => {
  const body = '<h2>見出し</h2><p>' + '&nbsp;'.repeat(900) + '</p>'
  const result = validateSanitizedArticleHtml(body)
  assert.equal(result.ok, false)
  // The raw HTML is long (>800 chars of "&nbsp;" markup), but decodes to
  // zero real characters, so this must fail on plain-text insufficiency,
  // not pass by accident.
  assert.equal(result.reason, 'insufficient_plain_text')
})

test('validate: numeric/hex HTML entity padding (&#160; / &#xA0;) also does not count toward plain-text length', () => {
  const numeric = validateSanitizedArticleHtml('<h2>見出し</h2><p>' + '&#160;'.repeat(900) + '</p>')
  assert.equal(numeric.ok, false)
  assert.equal(numeric.reason, 'insufficient_plain_text')

  const hex = validateSanitizedArticleHtml('<h2>見出し</h2><p>' + '&#xA0;'.repeat(900) + '</p>')
  assert.equal(hex.ok, false)
  assert.equal(hex.reason, 'insufficient_plain_text')
})

test('validate: real Japanese body text mixed with a legitimate HTML entity (e.g. &amp;) is correctly counted at its decoded length, not rejected', () => {
  const body = '<h2>タンパク質&amp;脂質の話</h2><p>' + 'あ'.repeat(900) + '</p>'
  const result = validateSanitizedArticleHtml(body)
  assert.deepEqual(result, { ok: true })
})

test('validate: HTML that is mostly markup with too little actual plain text fails', () => {
  // Long enough in raw HTML length, but the tags themselves (not text) make up the bulk.
  const tagHeavy = '<h2>見出し</h2>' + '<p></p>'.repeat(200)
  const result = validateSanitizedArticleHtml(tagHeavy)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'insufficient_plain_text')
})

test('validate: a realistic, sufficiently long article with an h2 passes', () => {
  const body = '<h2>見出し</h2><p>' + 'あ'.repeat(900) + '</p>'
  const result = validateSanitizedArticleHtml(body)
  assert.deepEqual(result, { ok: true })
})

test('validate: dangerous residue (belt-and-suspenders check even though sanitize-html should already remove it) fails validation', () => {
  // Constructing a string that bypasses sanitizeArticleHtml() to exercise
  // validateSanitizedArticleHtml()'s own independent safety net directly.
  // The non-residue part alone must already clear the length/heading/
  // plain-text checks, so this test isolates the residue check specifically.
  const withResidue = '<h2>見出し</h2><p>' + 'あ'.repeat(900) + '</p><script>alert(1)</script>'
  const result = validateSanitizedArticleHtml(withResidue)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'dangerous_residue_detected')
})

// --- Codex再監査 follow-up 修正4: ゼロ幅・Unicode format文字の除外 -----------
// 「可視テキスト」を数える際、U+200B(ZWSP)・U+200C(ZWNJ)・U+200D(ZWJ)・
// U+2060(WORD JOINER)・U+FEFF(ZWNBSP/BOM)などUnicode category Cf(format文字)
// 全般を実質不可視として文字数に数えない。判定順序は
// (1)HTML実体decode (2)タグ除去 (3)format文字除去 (4)空白正規化
// (5)連続空白圧縮 (6)trim (7)実質文字数判定。この正規化は品質判定用の
// テキスト抽出にのみ適用し、DBへ保存する sanitizeArticleHtml() の出力
// そのものは一切書き換えない。

test('validate: an h2 containing only U+200B (ZERO WIDTH SPACE) is treated as empty and fails missing_required_heading', () => {
  const zwsp = String.fromCharCode(0x200b)
  const body = '<h2>' + zwsp + '</h2><p>' + 'あ'.repeat(900) + '</p>'
  const result = validateSanitizedArticleHtml(body)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'missing_required_heading')
})

test('validate: an h2 containing only U+200D (ZERO WIDTH JOINER) is treated as empty and fails missing_required_heading', () => {
  const zwj = String.fromCharCode(0x200d)
  const body = '<h2>' + zwj + '</h2><p>' + 'あ'.repeat(900) + '</p>'
  const result = validateSanitizedArticleHtml(body)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'missing_required_heading')
})

test('validate: an h2 containing only U+2060 (WORD JOINER) is treated as empty and fails missing_required_heading', () => {
  const wordJoiner = String.fromCharCode(0x2060)
  const body = '<h2>' + wordJoiner + '</h2><p>' + 'あ'.repeat(900) + '</p>'
  const result = validateSanitizedArticleHtml(body)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'missing_required_heading')
})

test('validate: a body consisting only of Unicode format characters (ZWNJ + BOM/ZWNBSP) fails insufficient_plain_text even with a real heading', () => {
  const zwnj = String.fromCharCode(0x200c)
  const bom = String.fromCharCode(0xfeff)
  const body = '<h2>見出し</h2><p>' + (zwnj + bom).repeat(450) + '</p>'
  const result = validateSanitizedArticleHtml(body)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'insufficient_plain_text')
})

test('validate: a body of format characters mixed with &nbsp; fails insufficient_plain_text (format-char removal + entity-decoded whitespace both do not count as real text)', () => {
  const zwsp = String.fromCharCode(0x200b)
  const body = '<h2>見出し</h2><p>' + zwsp.repeat(450) + '&nbsp;'.repeat(450) + '</p>'
  const result = validateSanitizedArticleHtml(body)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'insufficient_plain_text')
})

test('validate: 900x U+200B padding cannot be used to fake the 400-char plain-text threshold', () => {
  const zwsp = String.fromCharCode(0x200b)
  const body = '<h2>見出し</h2><p>' + zwsp.repeat(900) + '</p>'
  const result = validateSanitizedArticleHtml(body)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'insufficient_plain_text')
})

test('validate: a real-text h2 alongside a sufficiently long Japanese body still passes (format-char removal must not reject ordinary content)', () => {
  const body = '<h2>本物の見出しです</h2><p>' + 'あ'.repeat(900) + '</p>'
  const result = validateSanitizedArticleHtml(body)
  assert.deepEqual(result, { ok: true })
})

test('validate: a body containing emoji alongside sufficient real text still passes (format-char removal must not break emoji, which are not Cf-category)', () => {
  const body = '<h2>プロテインの選び方💪</h2><p>' + 'トレーニング後のプロテイン摂取は筋肉の回復に重要です💪🥛。'.repeat(40) + '</p>'
  const result = validateSanitizedArticleHtml(body)
  assert.deepEqual(result, { ok: true })
})

test('validate: format-char stripping only affects the quality-judgment text extraction, never the value returned by sanitizeArticleHtml() itself', () => {
  const zwsp = String.fromCharCode(0x200b)
  const raw = `<h2>見出し${zwsp}です</h2><p>` + 'あ'.repeat(450) + '</p>'
  const sanitized = sanitizeArticleHtml(raw)
  // The zero-width character must survive inside the actually-saved HTML --
  // only the quality-check's plain-text extraction discards it.
  assert.ok(sanitized.includes(zwsp), 'zero-width character was unexpectedly stripped from the saved HTML')
})

// --- estimateReadingMinutes (unchanged pre-existing behavior) --------------

test('estimateReadingMinutes: strips tags and estimates from character count, with a floor of 3', () => {
  assert.equal(estimateReadingMinutes('<p>short</p>'), 3)
  assert.equal(estimateReadingMinutes('<p>' + 'あ'.repeat(2500) + '</p>'), 5)
})

// --- Codex監査 修正: shell injection対策の実証（process-level）---------------
// AUTO_BLOG_KEYWORDをGitHub Actionsのenv:相当（子processのenvironment）で
// 渡した場合、shell metacharacterを含む値でもcommand構造が変わらず、
// process.envの値としてそのままNodeへ届くことを実際のprocess起動で確認する。
// 危険なcommandそのものは実行しない（echoで値を出力するだけの安全なテスト）。

test('process-level: a value with shell metacharacters passed via env survives unchanged and is never interpreted as shell syntax (proves the env: passing mechanism the workflow now uses is injection-safe)', async () => {
  const { spawnSync } = await import('node:child_process')
  const dangerousValue = 'test"; echo hacked; # $(echo x) `echo y` | cat /etc/passwd && false'

  const result = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.env.AUTO_BLOG_KEYWORD ?? "")'], {
    env: { ...process.env, AUTO_BLOG_KEYWORD: dangerousValue },
    encoding: 'utf8',
    shell: false, // matches how GitHub Actions' `run:` invokes the script -- no extra shell re-parses the env var value
  })

  assert.equal(result.stdout, dangerousValue)
  assert.equal(result.stdout.includes('hacked'), true) // literal text, not executed
})

// --- Codex監査 follow-up 修正2: article fieldのvalidation -------------------
// content以外のAI生成field(title/description/category/slug)およびDB insert
// 直前に使われるfield(reading_minutes/published_at)を、実際のinsert
// objectに使う前に個別に検証する。allowlist外のcategoryやslug不正形式は
// 近似変換せずfail-closedとして扱う(呼び出し側=main()がreturn 1で終了する)。

test('validateTitle: rejects a title containing a newline', () => {
  const result = validateTitle('タイトルの一部\n改行を含む見出しテキスト')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'control_characters')
})

test('validateTitle: rejects a title containing an HTML tag', () => {
  const result = validateTitle('<b>強調された見出しテキストです</b>')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'html_tag')
})

test('validateTitle: rejects an empty (or whitespace-only) title', () => {
  assert.equal(validateTitle('').ok, false)
  assert.equal(validateTitle('   ').ok, false)
})

test('validateTitle: rejects a title shorter than the minimum length', () => {
  const result = validateTitle('短い')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'length')
})

test('validateTitle: accepts a normal Japanese SEO title and trims surrounding whitespace', () => {
  const result = validateTitle('  【2026年最新】プロテインの効果とは？飲むタイミングを解説  ')
  assert.equal(result.ok, true)
  assert.equal(result.value, '【2026年最新】プロテインの効果とは？飲むタイミングを解説')
})

test('validateTitle: rejects a title containing a C1 control character (U+0085 NEL), not just C0/DEL', () => {
  const result = validateTitle(`AI生成タイトルの例${String.fromCharCode(0x85)}続き部分テキスト`)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'control_characters')
})

test('validateTitle: rejects a title containing U+009D (C1 OSC)', () => {
  const result = validateTitle(`AI生成タイトルの例${String.fromCharCode(0x9d)}続き部分テキスト`)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'control_characters')
})

test('validateTitle: still accepts normal Japanese titles with emoji (C1 widening must not break ordinary Unicode text)', () => {
  const result = validateTitle('筋トレ初心者向け💪プロテインの選び方ガイド')
  assert.equal(result.ok, true)
  assert.equal(result.value, '筋トレ初心者向け💪プロテインの選び方ガイド')
})

test('validateDescription: rejects a description containing an HTML tag', () => {
  const result = validateDescription('あ'.repeat(30) + '<script>alert(1)</script>')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'html_tag')
})

test('validateDescription: rejects a description that is too long', () => {
  const result = validateDescription('あ'.repeat(400))
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'length')
})

test('validateDescription: rejects a description that is too short', () => {
  const result = validateDescription('短い説明文')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'length')
})

test('validateDescription: accepts a normal Japanese meta description', () => {
  const value = 'プロテインの効果的な摂取タイミングについて、科学的根拠をもとに詳しく解説します。トレーニング前後の摂取方法もご紹介。'
  const result = validateDescription(value)
  assert.equal(result.ok, true)
  assert.equal(result.value, value)
})

test('validateDescription: rejects a description containing a C1 control character (U+009C ST), not just C0/DEL', () => {
  const result = validateDescription('あ'.repeat(30) + String.fromCharCode(0x9c))
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'control_characters')
})

test('validateDescription: still accepts normal Japanese descriptions with emoji (C1 widening must not break ordinary Unicode text)', () => {
  const value = 'プロテインの効果的な摂取タイミング💪について、科学的根拠をもとに詳しく解説します。トレーニング前後の摂取方法もご紹介。'
  const result = validateDescription(value)
  assert.equal(result.ok, true)
  assert.equal(result.value, value)
})

test('validateCategory: rejects a category value containing a C1 control character even before the allowlist check runs (defense-in-depth explicit pre-check)', () => {
  const result = validateCategory(`筋トレ${String.fromCharCode(0x9b)}`)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'control_characters')
})

test('validateCategory: rejects a category outside the allowlist, without approximating to a default (fail-closed, no silent conversion)', () => {
  for (const bad of ['ビジネス', 'ビューティー', '', 'Food', '筋トレ ']) {
    const result = validateCategory(bad)
    assert.equal(result.ok, false, `expected ${JSON.stringify(bad)} to be rejected`)
    assert.equal(result.reason, 'not_in_allowlist')
  }
})

test('validateCategory: accepts each of the 5 real, currently-used categories', () => {
  for (const good of ['食事管理', '筋トレ', 'ダイエット', '栄養', 'ライフスタイル']) {
    assert.deepEqual(validateCategory(good), { ok: true, value: good })
  }
})

test('validateSlug: rejects a slug containing a C1 control character even before the regex check runs (defense-in-depth explicit pre-check)', () => {
  const result = validateSlug(`protein-timing${String.fromCharCode(0x9d)}`)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'control_characters')
})

test('validateSlug: rejects uppercase characters', () => {
  assert.equal(validateSlug('Protein-Timing-Guide').ok, false)
})

test('validateSlug: rejects underscores', () => {
  assert.equal(validateSlug('protein_timing_guide').ok, false)
})

test('validateSlug: rejects a dot-segment / path-traversal-like value', () => {
  assert.equal(validateSlug('../etc-passwd').ok, false)
  assert.equal(validateSlug('..').ok, false)
})

test('validateSlug: rejects a path separator', () => {
  assert.equal(validateSlug('protein/timing').ok, false)
})

test('validateSlug: rejects consecutive hyphens', () => {
  assert.equal(validateSlug('protein--timing-guide').ok, false)
})

test('validateSlug: rejects a leading or trailing hyphen', () => {
  assert.equal(validateSlug('-protein-timing').ok, false)
  assert.equal(validateSlug('protein-timing-').ok, false)
})

test('validateSlug: rejects a value shorter than the minimum length', () => {
  assert.equal(validateSlug('ab').ok, false)
})

test('validateSlug: accepts a normal, real-shaped slug', () => {
  assert.deepEqual(validateSlug('protein-timing-guide'), { ok: true, value: 'protein-timing-guide' })
  assert.deepEqual(validateSlug('bcaa-eaa-comparison-training'), { ok: true, value: 'bcaa-eaa-comparison-training' })
})

test('validateReadingMinutes: rejects 0 (below minimum)', () => {
  assert.equal(validateReadingMinutes(0).ok, false)
})

test('validateReadingMinutes: rejects 61 (above maximum)', () => {
  assert.equal(validateReadingMinutes(61).ok, false)
})

test('validateReadingMinutes: rejects a decimal value', () => {
  const result = validateReadingMinutes(5.5)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'not_integer')
})

test('validateReadingMinutes: rejects NaN and Infinity', () => {
  assert.equal(validateReadingMinutes(NaN).ok, false)
  assert.equal(validateReadingMinutes(Infinity).ok, false)
  assert.equal(validateReadingMinutes(-Infinity).ok, false)
})

test('validateReadingMinutes: accepts values within 1-60', () => {
  assert.deepEqual(validateReadingMinutes(1), { ok: true, value: 1 })
  assert.deepEqual(validateReadingMinutes(60), { ok: true, value: 60 })
  assert.deepEqual(validateReadingMinutes(5), { ok: true, value: 5 })
})

test('validatePublishedAt: rejects a non-date string', () => {
  assert.equal(validatePublishedAt('not-a-date').ok, false)
})

test('validatePublishedAt: rejects an impossible calendar date', () => {
  assert.equal(validatePublishedAt('2026-13-40').ok, false)
})

test('validatePublishedAt: accepts a normal ISO date', () => {
  assert.deepEqual(validatePublishedAt('2026-08-04'), { ok: true, value: '2026-08-04' })
})

// --- Codex再監査 follow-up 修正1: published_atの実在日付round-trip検証 -------
// new Date('YYYY-MM-DDT00:00:00Z')への直接パースは、2026-02-29のような
// 存在しない日付をDateの自動繰り上げ機能によって「翌月の日」として黙って
// 受理してしまっていた。Date.UTC()で生成したDateのUTC year/month/dayを
// 入力値とround-trip比較する方式に変更し、うるう年の4年/100年/400年
// ルールを含めて厳密に実在する日付だけを許可する。

test('validatePublishedAt: rejects 2026-02-29 (2026 is not a leap year -- not divisible by 4)', () => {
  assert.equal(validatePublishedAt('2026-02-29').ok, false)
})

test('validatePublishedAt: rejects 2026-02-30 (February never has 30 days)', () => {
  assert.equal(validatePublishedAt('2026-02-30').ok, false)
})

test('validatePublishedAt: rejects 2026-04-31 (April has 30 days)', () => {
  assert.equal(validatePublishedAt('2026-04-31').ok, false)
})

test('validatePublishedAt: rejects 2026-06-31 (June has 30 days)', () => {
  assert.equal(validatePublishedAt('2026-06-31').ok, false)
})

test('validatePublishedAt: rejects 1900-02-29 (the Gregorian 100-year rule: 1900 is divisible by 100 but not by 400, so it is NOT a leap year)', () => {
  assert.equal(validatePublishedAt('1900-02-29').ok, false)
})

test('validatePublishedAt: rejects month 00', () => {
  assert.equal(validatePublishedAt('2026-00-10').ok, false)
})

test('validatePublishedAt: rejects month 13', () => {
  assert.equal(validatePublishedAt('2026-13-10').ok, false)
})

test('validatePublishedAt: rejects day 00', () => {
  assert.equal(validatePublishedAt('2026-01-00').ok, false)
})

test('validatePublishedAt: accepts 2024-02-29 (2024 is divisible by 4 and not by 100 -- an ordinary leap year)', () => {
  assert.deepEqual(validatePublishedAt('2024-02-29'), { ok: true, value: '2024-02-29' })
})

test('validatePublishedAt: accepts 2000-02-29 (the Gregorian 400-year rule: 2000 is divisible by 400, so it IS a leap year despite also being divisible by 100)', () => {
  assert.deepEqual(validatePublishedAt('2000-02-29'), { ok: true, value: '2000-02-29' })
})

test('validatePublishedAt: accepts 2026-02-28 (the real last day of February in a non-leap year)', () => {
  assert.deepEqual(validatePublishedAt('2026-02-28'), { ok: true, value: '2026-02-28' })
})

test('validatePublishedAt: accepts 2026-04-30 (the real last day of a 30-day month)', () => {
  assert.deepEqual(validatePublishedAt('2026-04-30'), { ok: true, value: '2026-04-30' })
})

test('validatePublishedAt: accepts 2026-12-31 (the real last day of a 31-day month)', () => {
  assert.deepEqual(validatePublishedAt('2026-12-31'), { ok: true, value: '2026-12-31' })
})

// --- Codex監査 follow-up 修正3: ログ安全化 -----------------------------------

test('sanitizeLogValue: a title containing a newline is normalized to a single line', () => {
  const out = sanitizeLogValue('タイトル一行目\nタイトル二行目')
  assert.doesNotMatch(out, /\n/)
  assert.equal(out, 'タイトル一行目 タイトル二行目')
})

test('sanitizeLogValue: carriage returns and tabs are also normalized to spaces', () => {
  const out = sanitizeLogValue('a\r\nb\tc')
  assert.doesNotMatch(out, /[\r\n\t]/)
})

test('sanitizeLogValue: ANSI escape sequences are removed, leaving no escape character behind', () => {
  const esc = String.fromCharCode(0x1b)
  const withColor = esc + '[31mred' + esc + '[0m text'
  const out = sanitizeLogValue(withColor)
  assert.doesNotMatch(out, new RegExp(esc))
  assert.equal(out, 'red text')
})

test('sanitizeLogValue: truncates so the TOTAL returned length (including the ellipsis marker) never exceeds maxLength -- Codex re-audit fix: the old implementation appended the marker AFTER slicing to maxLength, so the real returned length was maxLength+1', () => {
  const out = sanitizeLogValue('a'.repeat(300), 50)
  assert.equal(out.length, 50) // marker is included WITHIN the 50-char budget, not added on top
  assert.ok(out.startsWith('a'.repeat(49)))
  assert.ok(out.endsWith('…'))
})

test('sanitizeLogValue: values within the limit are returned unchanged (aside from whitespace/control normalization)', () => {
  assert.equal(sanitizeLogValue('普通のタイトルです', 200), '普通のタイトルです')
})

test('sanitizeLogValue: does not mutate the DB-bound value -- truncation only affects the returned log string, never the original', () => {
  const original = 'あ'.repeat(300)
  const logSafe = sanitizeLogValue(original, 50)
  assert.equal(original.length, 300) // untouched
  assert.notEqual(logSafe, original)
})

// --- Codex再監査 follow-up 修正2 (log): C1制御文字の除去 ----------------------

test('sanitizeLogValue: removes C1 control characters (U+0085, U+009C, U+009D, U+009B), not just C0/DEL', () => {
  const withC1 =
    'before' +
    String.fromCharCode(0x85) +
    String.fromCharCode(0x9c) +
    String.fromCharCode(0x9d) +
    String.fromCharCode(0x9b) +
    'after'
  const out = sanitizeLogValue(withC1)
  assert.doesNotMatch(out, /[\x00-\x1F\x7F-\x9F]/)
  assert.doesNotMatch(out, /\n/)
})

// --- Codex再監査 follow-up 修正3: ANSI/terminal escape sequence除去の強化 -----
// 旧実装はESC単体(+1文字)しか除去しておらず、OSC(ESC ] ... BEL / ESC ] ... ESC \)や
// 8bit形式のCSI(U+009B)/OSC(U+009D)/ST(U+009C)を除去できていなかった。
// 7bit/8bit双方のCSI・OSCを多段階のregexで除去し、最後にC0/C1制御文字も
// 除去することで、単一の不完全なregexに依存しない構成にした。

test('sanitizeLogValue: removes an OSC sequence terminated by BEL (ESC ] ... BEL) -- e.g. a terminal-hyperlink-style payload', () => {
  const esc = String.fromCharCode(0x1b)
  const bel = String.fromCharCode(0x07)
  const withOsc = 'before' + esc + ']8;;https://evil.example/' + bel + 'clickme' + esc + ']8;;' + bel + 'after'
  const out = sanitizeLogValue(withOsc)
  assert.doesNotMatch(out, new RegExp(esc))
  assert.doesNotMatch(out, new RegExp(bel))
  assert.equal(out, 'beforeclickmeafter')
})

test('sanitizeLogValue: removes an OSC sequence terminated by ST (ESC ] ... ESC \\\\)', () => {
  const esc = String.fromCharCode(0x1b)
  const withOsc = 'before' + esc + ']0;window title' + esc + '\\' + 'after'
  const out = sanitizeLogValue(withOsc)
  assert.doesNotMatch(out, new RegExp(esc))
  assert.equal(out, 'beforeafter')
})

test('sanitizeLogValue: removes an 8-bit form CSI sequence (U+009B ... final byte)', () => {
  const c1Csi = String.fromCharCode(0x9b)
  const withCsi = 'before' + c1Csi + '31mred' + c1Csi + '0m' + 'after'
  const out = sanitizeLogValue(withCsi)
  assert.doesNotMatch(out, /[\x9b]/)
})

test('sanitizeLogValue: removes an 8-bit form OSC sequence terminated by 8-bit ST (U+009D ... U+009C)', () => {
  const c1Osc = String.fromCharCode(0x9d)
  const c1St = String.fromCharCode(0x9c)
  const withOsc = 'before' + c1Osc + '0;title' + c1St + 'after'
  const out = sanitizeLogValue(withOsc)
  assert.doesNotMatch(out, /[\x9c\x9d]/)
  assert.equal(out, 'beforeafter')
})

test('sanitizeLogValue: removes multiple mixed ANSI sequences (7-bit CSI + 8-bit OSC) in the same value', () => {
  const esc = String.fromCharCode(0x1b)
  const c1Osc = String.fromCharCode(0x9d)
  const c1St = String.fromCharCode(0x9c)
  const mixed = esc + '[1mimportant' + esc + '[0m ' + c1Osc + '0;title' + c1St + 'trailing'
  const out = sanitizeLogValue(mixed)
  assert.doesNotMatch(out, new RegExp(esc))
  assert.doesNotMatch(out, /[\x9c\x9d]/)
  assert.equal(out, 'important trailing')
})

test('sanitizeLogValue: combines newline normalization with ANSI removal in a single value', () => {
  const esc = String.fromCharCode(0x1b)
  const withBoth = 'line1' + esc + '[31m\nline2' + esc + '[0m'
  const out = sanitizeLogValue(withBoth)
  assert.doesNotMatch(out, new RegExp(esc))
  assert.doesNotMatch(out, /\n/)
  assert.equal(out, 'line1 line2')
})

test('sanitizeLogValue: the returned value is always a single line and contains no C0/C1 control or escape characters, across every ANSI/control test case above', () => {
  const esc = String.fromCharCode(0x1b)
  const bel = String.fromCharCode(0x07)
  const c1Csi = String.fromCharCode(0x9b)
  const c1Osc = String.fromCharCode(0x9d)
  const c1St = String.fromCharCode(0x9c)
  const kitchenSink =
    'a' + esc + '[31m' + 'b\n' + bel + 'c' + c1Csi + '1md' + c1Osc + 'e' + c1St + 'f\t' + String.fromCharCode(0x85) + 'g'
  const out = sanitizeLogValue(kitchenSink, 1000)
  assert.doesNotMatch(out, /[\x00-\x1F\x7F-\x9F]/)
  assert.doesNotMatch(out, /\n/)
})

// --- Codex再監査 follow-up 修正5: truncate上限（marker込み）の境界test -------
// maxLengthが極端に小さい場合(0, 1, 2)でも、返り値の長さ(省略記号込み)が
// maxLengthを超えないことを明示的に固定する。

test('sanitizeLogValue: maxLength 0 returns an empty string (no room for any character, including the marker)', () => {
  const out = sanitizeLogValue('a'.repeat(10), 0)
  assert.equal(out, '')
  assert.equal(out.length, 0)
})

test('sanitizeLogValue: maxLength 1 returns exactly 1 character (the marker alone, since there is no room for both a body character and the marker)', () => {
  const out = sanitizeLogValue('a'.repeat(10), 1)
  assert.equal(out.length, 1)
  assert.equal(out, '…')
})

test('sanitizeLogValue: maxLength 2 returns exactly 2 characters (1 body character + the marker)', () => {
  const out = sanitizeLogValue('a'.repeat(10), 2)
  assert.equal(out.length, 2)
  assert.equal(out, 'a…')
})

test('sanitizeLogValue: a value shorter than maxLength is returned unchanged, with no marker appended', () => {
  const out = sanitizeLogValue('short', 50)
  assert.equal(out, 'short')
  assert.doesNotMatch(out, /…/)
})

test('sanitizeLogValue: a value exactly equal to maxLength is returned unchanged, with no marker appended', () => {
  const out = sanitizeLogValue('a'.repeat(50), 50)
  assert.equal(out, 'a'.repeat(50))
  assert.equal(out.length, 50)
  assert.doesNotMatch(out, /…/)
})

test('generate-article.mjs source: DB insert uses the validated/normalized field values (titleResult.value, descriptionResult.value, categoryResult.value, sanitizedContent), not the raw AI-supplied article.* fields', async () => {
  const { readFileSync } = await import('node:fs')
  const filePath = new URL(moduleUrl)
  const source = readFileSync(filePath, 'utf8')
  const insertStart = source.indexOf('.insert({')
  assert.ok(insertStart !== -1, 'could not locate the .insert({ call')
  const insertBlock = source.slice(insertStart, source.indexOf('.select(', insertStart))
  assert.match(insertBlock, /title: titleResult\.value/)
  assert.match(insertBlock, /description: descriptionResult\.value/)
  assert.match(insertBlock, /category: categoryResult\.value/)
  assert.match(insertBlock, /content: sanitizedContent/)
  assert.doesNotMatch(insertBlock, /title: article\.title/)
  assert.doesNotMatch(insertBlock, /category: article\.category/)
})

// --- Codex remediation: formatOpenAiError の直接回帰テスト ------------------
// SDK/APIへの実リクエストは一切行わない。plain object / Error インスタンスを
// 与えて、出力が (a) 有用な診断フィールドを含み (b) 単一行 (c) 上限長 truncate
// (d) 無関係フィールドを直列化しない ことを確認する。

test('formatOpenAiError: 429 insufficient_quota API-shaped error exposes status/code/type/message', () => {
  const out = formatOpenAiError({
    name: 'RateLimitError',
    status: 429,
    code: 'insufficient_quota',
    type: 'insufficient_quota',
    message: 'You exceeded your current quota, please check your plan and billing details.',
  })
  assert.match(out, /status=429/)
  assert.match(out, /code=insufficient_quota/)
  assert.match(out, /type=insufficient_quota/)
  assert.match(out, /message=You exceeded your current quota/)
  assert.doesNotMatch(out, /\n/)
})

test('formatOpenAiError: rate_limit_exceeded is preserved and distinguishable from insufficient_quota', () => {
  const out = formatOpenAiError({ status: 429, code: 'rate_limit_exceeded' })
  assert.match(out, /status=429/)
  assert.match(out, /code=rate_limit_exceeded/)
  assert.doesNotMatch(out, /insufficient_quota/)
})

test('formatOpenAiError: an ordinary Error (no status/code) falls back to name + message', () => {
  const out = formatOpenAiError(new Error('network failure'))
  assert.match(out, /name=Error/)
  assert.match(out, /message=network failure/)
})

test('formatOpenAiError: null / undefined / primitive inputs return a bounded safe string, never throw', () => {
  assert.equal(formatOpenAiError(null), 'UnknownError')
  assert.equal(formatOpenAiError(undefined), 'UnknownError')
  assert.equal(formatOpenAiError(429), 'UnknownError')
  assert.equal(formatOpenAiError('boom'), 'UnknownError')
})

test('formatOpenAiError: newline / carriage return / ANSI in message are sanitized to one line', () => {
  const esc = String.fromCharCode(0x1b)
  const out = formatOpenAiError({ message: `line one\r\nline two\t${esc}[31mred${esc}[0m` })
  assert.doesNotMatch(out, /[\r\n\t]/)
  assert.doesNotMatch(out, new RegExp(esc))
  assert.match(out, /message=line one line two red/)
})

test('formatOpenAiError: an overlong message is truncated (message field body stays within the 300-char cap)', () => {
  const out = formatOpenAiError({ message: 'x'.repeat(5000) })
  const field = out.slice(out.indexOf('message=') + 'message='.length)
  assert.ok(field.length <= 300, `message field length ${field.length} exceeds 300`)
  assert.ok(field.endsWith('…'))
})

test('formatOpenAiError: unrelated object fields (apiKey / authorization / headers / request / prompt) are never emitted', () => {
  const out = formatOpenAiError({
    status: 500,
    message: 'Internal server error',
    apiKey: 'dummy-key-DO-NOT-LOG',
    authorization: 'Bearer dummy-token-DO-NOT-LOG',
    headers: { 'x-secret': 'dummy-header-DO-NOT-LOG' },
    request: { body: 'dummy-request-body-DO-NOT-LOG' },
    prompt: 'dummy-prompt-content-DO-NOT-LOG',
  })
  assert.match(out, /status=500/)
  assert.match(out, /message=Internal server error/)
  assert.doesNotMatch(out, /DO-NOT-LOG/)
  assert.doesNotMatch(out, /apiKey|authorization|headers|prompt/i)
})

test('formatOpenAiError: an adversarial throwing property getter does not make the diagnostic path throw', () => {
  const hostile = {
    get status() { throw new Error('gotcha') },
    get message() { throw new Error('gotcha') },
  }
  assert.doesNotThrow(() => formatOpenAiError(hostile))
  assert.equal(formatOpenAiError(hostile), 'UnloggableError')
})
