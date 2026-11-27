import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Static-source checks only. These verify the *shape* of generate-article.mjs
// and auto-blog.yml (OpenAI client hardening, token limits, workflow
// concurrency, and the absence of raw-content logging / shell-interpolated
// workflow input) without executing anything that calls OpenAI, Supabase,
// or GitHub Actions.

const scriptSource = readFileSync(path.resolve(import.meta.dirname, 'generate-article.mjs'), 'utf8')
const workflowSource = readFileSync(
  path.resolve(import.meta.dirname, '..', '.github', 'workflows', 'auto-blog.yml'),
  'utf8'
)

// --- Codex監査 修正: OpenAI client hardening --------------------------------
// SDK既定(timeout 10分・maxRetries 2)に依存せず、明示的にtimeout 120秒・
// maxRetries 0を設定する。一時エラー時のアプリ独自の自動再呼び出しも追加しない。

test('OpenAI client is constructed with an explicit timeout of 120000ms (not the SDK default of 10 minutes)', () => {
  assert.match(scriptSource, /new OpenAI\(\{[^}]*timeout:\s*120_000/)
})

test('OpenAI client is constructed with maxRetries: 0 (not the SDK default of 2, avoiding silent duplicate billing on transient errors)', () => {
  assert.match(scriptSource, /new OpenAI\(\{[^}]*maxRetries:\s*0/)
})

test('no application-level retry loop wraps any openai.chat.completions.create call (no while/for/retry-count variables around the 3 calls)', () => {
  const codeOnly = scriptSource.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(codeOnly, /for\s*\(.*retry/i)
  assert.doesNotMatch(codeOnly, /while\s*\(.*retry/i)
  assert.doesNotMatch(codeOnly, /retryCount|attemptCount|maxAttempts/i)
})

// --- Codex監査 修正: output token上限 ---------------------------------------
// テーマ選定・記事生成・ファクトチェックの3呼び出しすべてに明示的な
// max_tokensを設定する。

test('all three openai.chat.completions.create calls specify an explicit max_tokens', () => {
  const calls = scriptSource.split('openai.chat.completions.create(').slice(1)
  assert.equal(calls.length, 3, `expected exactly 3 chat.completions.create call sites, found ${calls.length}`)
  for (const call of calls) {
    // Each call's own options object closes well within a few hundred characters.
    const callBody = call.slice(0, call.indexOf('\n  }') > -1 ? call.indexOf('\n  }') : 800)
    assert.match(callBody, /max_tokens:\s*\d+/, `call site missing max_tokens: ${callBody.slice(0, 120)}...`)
  }
})

test('theme-selection call uses max_tokens: 300', () => {
  assert.match(scriptSource, /model:\s*'gpt-4o',\s*\n\s*messages:\s*\[\s*\n\s*\{\s*\n\s*role:\s*'system',\s*\n\s*content:\s*`あなたはFitMate[\s\S]*?max_tokens:\s*300/)
})

test('article-generation call uses max_tokens: 6000', () => {
  assert.match(scriptSource, /content:\s*systemPrompt[\s\S]{0,300}?max_tokens:\s*6000/)
})

test('fact-check call uses max_tokens: 6000', () => {
  assert.match(scriptSource, /あなたはフィットネス・栄養学の専門家です[\s\S]*?max_tokens:\s*6000/)
})

// --- Codex監査 修正: ログ縮小 -----------------------------------------------
// OpenAI生応答全文・生成記事本文全文・article object全体・sanitize前HTML・
// fact-check後本文全文をログへ出さない。

test('JSON parse failure paths log only response length / stage, never the raw response text itself', () => {
  const codeOnly = scriptSource.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  // The literal raw response variables must never be interpolated directly into a console call.
  assert.doesNotMatch(codeOnly, /console\.(error|warn|log)\([^)]*\$\{raw\}/)
  assert.doesNotMatch(codeOnly, /console\.(error|warn|log)\(.*,\s*raw\)/)
  assert.match(codeOnly, /response length/)
})

test('missing-required-fields error logs field presence booleans, not the full article object', () => {
  assert.match(scriptSource, /console\.error\('❌ 必須フィールドが不足:', \{ hasTitle: Boolean\(article\.title\), hasContent: Boolean\(article\.content\) \}\)/)
  assert.doesNotMatch(scriptSource, /console\.error\('❌ 必須フィールドが不足:', article\)/)
})

test('no console call logs the full sanitized/pre-sanitize article content, or completion.choices[].message.content directly (referencing .length on these, e.g. in the sanitize before/after counter, is fine)', () => {
  const codeOnly = scriptSource.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  // The dangerous pattern is a *bare* (non-.length) reference to these
  // variables directly inside a template literal that feeds a console call.
  assert.doesNotMatch(codeOnly, /\$\{article\.content\}/)
  assert.doesNotMatch(codeOnly, /\$\{sanitizedContent\}/)
  assert.doesNotMatch(codeOnly, /\$\{contentBeforeSanitize\}/)
  assert.doesNotMatch(codeOnly, /\$\{.*message\?\.content\}/)
  assert.doesNotMatch(codeOnly, /console\.\w+\(\s*article\.content\s*[,)]/)
  assert.doesNotMatch(codeOnly, /console\.\w+\(\s*sanitizedContent\s*[,)]/)
})

test('sanitize step logs only before/after character counts, not content', () => {
  assert.match(scriptSource, /🧼 sanitize:.*preSanitizeLength.*sanitizedContent\.length/)
})

test('title/slug/category/reading-time/published-date logging is preserved, now routed through sanitizeLogValue() (Codex-audit follow-up: log injection hardening)', () => {
  assert.match(scriptSource, /console\.log\(`📝 タイトル: \$\{sanitizeLogValue\(titleResult\.value\)\}`\)/)
  assert.match(scriptSource, /console\.log\(`🔗 スラグ:   \$\{sanitizeLogValue\(slug\)\}`\)/)
  assert.match(scriptSource, /console\.log\(`📂 カテゴリ: \$\{sanitizeLogValue\(categoryResult\.value\)\}`\)/)
})

// --- Codex監査 修正 High 1: workflow_dispatch入力のshell injection ----------

test('the workflow "run:" step for generating the article is a static command with zero ${{ }} interpolation (no shell-injection surface)', () => {
  const generateStepMatch = workflowSource.match(/- name: Generate article[\s\S]*?run:\s*(.+)/)
  assert.ok(generateStepMatch, 'could not locate the "Generate article" step')
  const runLine = generateStepMatch[1].trim()
  assert.equal(runLine, 'node scripts/generate-article.mjs')
  assert.doesNotMatch(runLine, /\$\{\{/)
})

test('keyword is passed via env: as AUTO_BLOG_KEYWORD, not embedded in the run script text', () => {
  assert.match(workflowSource, /AUTO_BLOG_KEYWORD:\s*\$\{\{\s*inputs\.keyword\s*\}\}/)
})

test('the workflow no longer contains the old github.event.inputs.keyword shell-branching pattern', () => {
  assert.doesNotMatch(workflowSource, /github\.event\.inputs\.keyword/)
  assert.doesNotMatch(workflowSource, /if \[ -n "\$\{\{/)
})

// --- Codex監査 修正: GitHub Actions concurrency -----------------------------

test('workflow-level concurrency prevents overlapping schedule/workflow_dispatch runs', () => {
  assert.match(workflowSource, /^concurrency:\s*\n\s*group:\s*fitmate-auto-blog\s*\n\s*cancel-in-progress:\s*false\s*$/m)
})

test('timeout-minutes: 15 is preserved on the job', () => {
  assert.match(workflowSource, /timeout-minutes:\s*15/)
})

test('secrets are still sourced from GitHub Actions secrets context, never hardcoded', () => {
  assert.match(workflowSource, /OPENAI_API_KEY:\s*\$\{\{\s*secrets\.OPENAI_API_KEY\s*\}\}/)
  assert.match(workflowSource, /SUPABASE_SECRET_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SECRET_KEY\s*\}\}/)
})

// --- sanitize-html dependency sanity -----------------------------------------

test('generate-article.mjs imports sanitize-html (a maintained third-party sanitizer), not a hand-rolled regex-only sanitizer', () => {
  assert.match(scriptSource, /import sanitizeHtml from 'sanitize-html'/)
})
