import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// No YAML parser is introduced here (none is installed as a dependency, and
// adding one is explicitly out of scope for this change) — workflow files
// are checked with plain text/regex assertions, the same static-source
// approach already used elsewhere in this repo for files that can't be
// safely imported. package.json and .nvmrc, by contrast, are read as real
// data (JSON / plain text), not regex-matched.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const packageLock = JSON.parse(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'))
const nvmrc = readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8').trim()
const autoBlogYml = readFileSync(path.join(repoRoot, '.github/workflows/auto-blog.yml'), 'utf8')
const compressYml = readFileSync(path.join(repoRoot, '.github/workflows/compress-blog-images.yml'), 'utf8')

// --- runtime configuration ------------------------------------------------

test('package.json declares engines.node as 24.x', () => {
  assert.equal(pkg.engines?.node, '24.x')
})

test('.nvmrc matches package.json engines.node major (24)', () => {
  assert.equal(nvmrc, '24')
})

test('no lingering Node.js 20 version pin remains in workflow files', () => {
  assert.equal(/node-version:\s*['"]?20/.test(autoBlogYml), false)
  assert.equal(/node-version:\s*['"]?20/.test(compressYml), false)
})

test('engines.node is not an overly broad/unbounded range (not "*" or "latest")', () => {
  assert.notEqual(pkg.engines?.node, '*')
  assert.notEqual(pkg.engines?.node, 'latest')
})

// --- workflow: node-version and Action majors -----------------------------

for (const [name, yml] of [['auto-blog.yml', autoBlogYml], ['compress-blog-images.yml', compressYml]]) {
  test(`${name}: setup-node uses node-version 24`, () => {
    assert.match(yml, /node-version:\s*'24'/)
  })

  test(`${name}: actions/checkout is pinned to the Node24-runtime major (v5)`, () => {
    assert.match(yml, /uses:\s*actions\/checkout@v5/)
    assert.equal(yml.includes('actions/checkout@v4'), false)
  })

  test(`${name}: actions/setup-node is pinned to the Node24-runtime major (v5)`, () => {
    assert.match(yml, /uses:\s*actions\/setup-node@v5/)
    assert.equal(yml.includes('actions/setup-node@v4'), false)
  })

  test(`${name}: runs on a GitHub-hosted runner (not switched to self-hosted)`, () => {
    assert.match(yml, /runs-on:\s*ubuntu-latest/)
  })

  test(`${name}: npm cache is still explicitly requested (unaffected by setup-node v5's auto-cache, which only triggers off a packageManager field this repo doesn't set)`, () => {
    assert.match(yml, /cache:\s*'npm'/)
  })

}

// auto-blog.yml alone: unlike compress-blog-images.yml (which now declares an
// explicit job-level permissions block -- see the exact-contract test in the
// compress-blog-images.yml section below), auto-blog.yml's own job-level
// permissions block is indented, so this line-start-anchored regex correctly
// keeps passing for it; it targets only an unindented, workflow-wide
// `permissions:` key.
test('auto-blog.yml: does not declare a top-level (workflow-wide) permissions block (unchanged from before; its failure-alert permissions are scoped to the job instead)', () => {
  assert.equal(/^permissions:/m.test(autoBlogYml), false)
})

// --- auto-blog.yml: schedule / dispatch / secrets / commands unchanged ----

test('auto-blog.yml: cron schedule is unchanged', () => {
  assert.match(autoBlogYml, /cron:\s*'0 3 \* \* 0,1,3,5'/)
})

test('auto-blog.yml: workflow_dispatch keyword input is unchanged', () => {
  assert.match(autoBlogYml, /workflow_dispatch:/)
  assert.match(autoBlogYml, /keyword:/)
  assert.match(autoBlogYml, /required:\s*false/)
})

test('auto-blog.yml: secret reference names are unchanged', () => {
  for (const name of ['OPENAI_API_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    assert.match(autoBlogYml, new RegExp(`secrets\\.${name}`))
  }
})

test('auto-blog.yml: install and generation commands are unchanged', () => {
  assert.match(autoBlogYml, /run:\s*npm ci/)
  assert.match(autoBlogYml, /node scripts\/generate-article\.mjs/)
})

test('auto-blog.yml: timeout-minutes is unchanged (15)', () => {
  assert.match(autoBlogYml, /timeout-minutes:\s*15/)
})

// --- compress-blog-images.yml: trigger / secrets / commands unchanged -----

test('compress-blog-images.yml: workflow_dispatch-only trigger is unchanged (no schedule/cron added)', () => {
  assert.equal(/^\s*schedule:/m.test(compressYml), false)
  assert.match(compressYml, /workflow_dispatch:/)
})

test('compress-blog-images.yml: workflow_dispatch requires an explicit, required "slugs" input -- operational fix so a manual run can never silently fall back to processing the whole bucket', () => {
  assert.match(compressYml, /slugs:\s*\n\s*description:/)
  assert.match(compressYml, /slugs:[\s\S]{0,300}required:\s*true/)
})

test('compress-blog-images.yml: the slugs input is passed via env:, never interpolated into the run: shell command (same shell-injection convention as AUTO_BLOG_KEYWORD)', () => {
  assert.match(compressYml, /THUMBNAIL_TARGET_SLUGS:\s*\$\{\{\s*inputs\.slugs\s*\}\}/)
  const compressStepMatch = compressYml.match(/- name: Compress images[\s\S]*?run:\s*(.+)/)
  const runLine = compressStepMatch?.[1]?.trim()
  assert.equal(runLine, 'node scripts/compress-blog-images.mjs')
  assert.equal(runLine?.includes('${{'), false)
})

// --- sharp: direct dependency guard (Codex Medium follow-up) --------------
// scripts/compress-blog-images.mjs does `import sharp from 'sharp'` at
// runtime. Before this fix, sharp was only present in node_modules because
// it happens to be one of Next.js's own optionalDependencies -- an
// undeclared, incidental coupling that a future `npm ci` could resolve
// without (optional dependencies are allowed to fail/be skipped silently).
// These tests pin sharp as a real, declared, required dependency so
// `import sharp from 'sharp'` is guaranteed to work after `npm ci` alone,
// independent of whatever Next.js happens to bundle.

const compressScriptSource = readFileSync(path.join(repoRoot, 'scripts/compress-blog-images.mjs'), 'utf8')

test('package.json declares sharp as a direct (non-dev) dependency', () => {
  assert.ok(pkg.dependencies.sharp, 'sharp is missing from package.json dependencies')
  assert.equal(pkg.devDependencies.sharp, undefined, 'sharp should be a runtime dependency, not a devDependency -- the script that imports it runs in GitHub Actions after `npm ci` with NODE_ENV unset (dev deps included) today, but a runtime script dependency belongs in `dependencies` on principle, not `devDependencies`')
})

test('the declared sharp version range matches the version actually installed/resolved (0.34.5)', () => {
  assert.equal(pkg.dependencies.sharp, '^0.34.5')
})

test('package-lock.json actually resolves node_modules/sharp at the declared version (npm ci will produce a working install, not just a package.json declaration with nothing backing it)', () => {
  const resolved = packageLock.packages?.['node_modules/sharp']
  assert.ok(resolved, 'package-lock.json has no node_modules/sharp entry')
  assert.equal(resolved.version, '0.34.5')
})

test('sharp is no longer marked optional in package-lock.json\'s root dependency declaration (it is a required runtime dependency now, not incidentally-present)', () => {
  const root = packageLock.packages?.['']
  assert.equal(root.dependencies?.sharp, '^0.34.5')
  // A dependency's own optionality (as opposed to some other package's
  // optionalDependencies entry for it) is reflected by the resolved
  // node_modules/sharp entry not carrying `optional: true` once something
  // in the tree depends on it as a hard requirement.
  const resolved = packageLock.packages?.['node_modules/sharp']
  assert.notEqual(resolved.optional, true)
})

test('compress-blog-images.mjs imports sharp directly (confirms the dependency is actually used, not just declared)', () => {
  assert.match(compressScriptSource, /^import sharp from 'sharp'$/m)
})

test('compress-blog-images.yml: secret reference names are unchanged', () => {
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    assert.match(compressYml, new RegExp(`secrets\\.${name}`))
  }
})

test('compress-blog-images.yml: install and compression commands are unchanged', () => {
  assert.match(compressYml, /run:\s*npm ci/)
  assert.match(compressYml, /node scripts\/compress-blog-images\.mjs/)
})

test('compress-blog-images.yml: timeout-minutes is unchanged (10)', () => {
  assert.match(compressYml, /timeout-minutes:\s*10/)
})

// --- compress-blog-images.yml: failure-alert / incident-management --------
// PM-authorized addition: a GitHub Issue failure alert, reusing the exact
// design already deployed and independently reviewed in auto-blog.yml
// (fixed title + body marker + github-actions[bot] author ownership check,
// dedup via comment-on-existing, auto-close on a later success). This job
// previously declared no `permissions:` block at all (relying on the
// repository default, which is read-only) -- it now needs `issues: write`
// for these two steps, so the exact-contract test below replaces the old
// generic "does not declare a permissions block" assertion for this file
// specifically (auto-blog.yml keeps that assertion; see above).

test('compress-blog-images.yml: compress job declares exactly contents:read + issues:write permissions -- no broader write authority (this must fail if someone later adds e.g. contents:write or an unrelated key like actions:write)', () => {
  const permissionsMatch = compressYml.match(/(?:^|\n)([ \t]*)permissions:\r?\n((?:\1[ \t]+\S.*\r?\n?)+)/)
  assert.ok(permissionsMatch, 'compress-blog-images.yml must declare an explicit permissions block for the failure-alert/incident-management steps')
  const lines = permissionsMatch[2].split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const perms = Object.fromEntries(lines.map((line) => {
    const kv = line.match(/^([a-z0-9_-]+):\s*(\S+)$/)
    assert.ok(kv, `unparseable permissions line in compress-blog-images.yml: ${JSON.stringify(line)}`)
    return [kv[1], kv[2]]
  }))
  assert.deepEqual(perms, { contents: 'read', issues: 'write' })
})

test('compress-blog-images.yml: step order is Checkout, Setup Node.js, Install dependencies, Compress images, Report compression failure, Resolve compression incident on success', () => {
  const stepNames = [...compressYml.matchAll(/^\s*- name:\s*(.+)$/gm)].map((m) => m[1].trim())
  assert.deepEqual(stepNames, [
    'Checkout',
    'Setup Node.js',
    'Install dependencies',
    'Compress images',
    'Report compression failure',
    'Resolve compression incident on success',
  ])
})

test('compress-blog-images.yml: failure-alert step runs only on failure(), is non-blocking, and uses github-script@v8 (same major already used by auto-blog.yml)', () => {
  const step = compressYml.match(/- name: Report compression failure\r?\n([\s\S]*?)(?=\n\s*- name:|\n*$)/)
  assert.ok(step, 'could not locate the "Report compression failure" step')
  assert.match(step[1], /if:\s*failure\(\)/)
  assert.match(step[1], /continue-on-error:\s*true/)
  assert.match(step[1], /uses:\s*actions\/github-script@v8/)
})

test('compress-blog-images.yml: success-resolution step runs only on success(), is non-blocking, and uses github-script@v8', () => {
  const step = compressYml.match(/- name: Resolve compression incident on success\r?\n([\s\S]*)$/)
  assert.ok(step, 'could not locate the "Resolve compression incident on success" step')
  assert.match(step[1], /if:\s*success\(\)/)
  assert.match(step[1], /continue-on-error:\s*true/)
  assert.match(step[1], /uses:\s*actions\/github-script@v8/)
})

test('compress-blog-images.yml: incident title and marker are fixed, deterministic, and distinct from auto-blog.yml\'s (no shared/ambiguous identity across the two workflows\' incidents)', () => {
  assert.match(compressYml, /INCIDENT_TITLE = '\[FitMate\] Compress Blog Images workflow failure'/)
  assert.match(compressYml, /INCIDENT_MARKER = '<!-- fitmate:compress-blog-images-incident:v1 -->'/)
  assert.equal(compressYml.includes('[Auto Blog] Generation workflow failing'), false)
  assert.equal(compressYml.includes('fitmate:auto-blog-incident:v1'), false)
})

test('compress-blog-images.yml: both incident-management steps validate ownership by exact title, marker, non-PR, open state, and github-actions[bot] authorship before touching any issue', () => {
  for (const anchor of ['Report compression failure', 'Resolve compression incident on success']) {
    const stepMatch = compressYml.match(new RegExp(`- name: ${anchor}\\r?\\n([\\s\\S]*?)(?=\\n\\s*- name:|\\n*$)`))
    assert.ok(stepMatch, `could not locate step: ${anchor}`)
    const body = stepMatch[1]
    assert.match(body, /!i\.pull_request/)
    assert.match(body, /i\.state === 'open'/)
    assert.match(body, /i\.title === INCIDENT_TITLE/)
    assert.match(body, /\(i\.body \|\| ''\)\.includes\(INCIDENT_MARKER\)/)
    assert.match(body, /i\.user && i\.user\.login === 'github-actions\[bot\]'/)
  }
})

test('compress-blog-images.yml: failure/success steps never reference workflow_dispatch user input (inputs.slugs) or any secret -- issue content is limited to safe run metadata', () => {
  const failureStep = compressYml.match(/- name: Report compression failure\r?\n([\s\S]*?)(?=\n\s*- name:|\n*$)/)?.[1] ?? ''
  const successStep = compressYml.match(/- name: Resolve compression incident on success\r?\n([\s\S]*)$/)?.[1] ?? ''
  for (const body of [failureStep, successStep]) {
    assert.equal(body.includes('inputs.slugs'), false)
    assert.equal(body.includes('secrets.'), false)
    assert.equal(body.includes('SUPABASE_SECRET_KEY'), false)
    assert.equal(body.includes('NEXT_PUBLIC_SUPABASE_URL'), false)
  }
})

// Codex-audit fix: both steps previously did
// `.filter(isOwnedIncident).sort((a, b) => a.number - b.number)` and then
// unconditionally used `owned[0]` -- silently picking the oldest owned open
// incident to mutate even when more than one existed (e.g. a race between
// two concurrent manual dispatches). That is arbitrary selection among
// ambiguous state, not a resolved match. Both steps now explicitly branch
// on `owned.length` and refuse to mutate any issue at all when more than
// one owned open incident is found (see the workflow's own comments for the
// full rationale). `owned[0]` remains in the source only in the branches
// where `owned.length` has already been proven to be exactly 1.

test('compress-blog-images.yml: on failure, the ambiguity guard (owned.length > 1 -> throw) appears before any issue mutation call, and the arbitrary oldest-selection sort is gone', () => {
  const failureStep = compressYml.match(/- name: Report compression failure\r?\n([\s\S]*?)(?=\n\s*- name:|\n*$)/)?.[1]
  assert.ok(failureStep)

  // The old "pick the oldest of possibly-many" sort must not be present.
  assert.equal(/\.sort\(\(a, b\) => a\.number - b\.number\)/.test(failureStep), false)

  const guardIndex = failureStep.search(/if\s*\(owned\.length > 1\)\s*\{\s*\n\s*throw new Error/)
  assert.notEqual(guardIndex, -1, 'expected an explicit `if (owned.length > 1) { throw new Error(...) }` ambiguity guard')

  const createIndex = failureStep.indexOf('github.rest.issues.create(')
  const createCommentIndex = failureStep.indexOf('github.rest.issues.createComment(')
  assert.notEqual(createIndex, -1)
  assert.notEqual(createCommentIndex, -1)
  assert.ok(guardIndex < createIndex, 'ambiguity guard must precede issues.create')
  assert.ok(guardIndex < createCommentIndex, 'ambiguity guard must precede issues.createComment')

  // The error message itself must not leak user input or secrets.
  const errorMatch = failureStep.match(/throw new Error\(`([^`]*)`\)/)
  assert.ok(errorMatch, 'expected a template-literal Error message for the ambiguity guard')
  const errorTemplate = errorMatch[1]
  for (const forbidden of ['inputs.slugs', 'secrets.', 'SUPABASE_SECRET_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'i.body']) {
    assert.equal(errorTemplate.includes(forbidden), false, `ambiguity error must not reference ${forbidden}`)
  }

  // 0-match branch creates exactly once; 1-match (implicit) branch comments
  // exactly once -- each only once in the whole step, matching the two
  // mutually exclusive branches after the ambiguity guard.
  assert.equal((failureStep.match(/github\.rest\.issues\.create\(/g) || []).length, 1)
  assert.equal((failureStep.match(/github\.rest\.issues\.createComment\(/g) || []).length, 1)
  assert.equal((failureStep.match(/github\.rest\.issues\.update\(/g) || []).length, 0)

  // The 0-match branch must precede the (only-now-safe) `owned[0]` read.
  const zeroMatchIndex = failureStep.search(/if\s*\(owned\.length === 0\)/)
  const ownedZeroReadIndex = failureStep.indexOf('const match = owned[0]')
  assert.notEqual(zeroMatchIndex, -1, 'expected an explicit `if (owned.length === 0)` branch')
  assert.notEqual(ownedZeroReadIndex, -1)
  assert.ok(guardIndex < zeroMatchIndex && zeroMatchIndex < ownedZeroReadIndex,
    'expected order: ambiguity guard, then 0-match branch, then the now-safe owned[0] read')
})

test('compress-blog-images.yml: on success, the ambiguity guard (owned.length > 1 -> throw) appears before any issue mutation call, and the arbitrary oldest-selection sort is gone', () => {
  const successStep = compressYml.match(/- name: Resolve compression incident on success\r?\n([\s\S]*)$/)?.[1]
  assert.ok(successStep)

  assert.equal(/\.sort\(\(a, b\) => a\.number - b\.number\)/.test(successStep), false)

  const guardIndex = successStep.search(/if\s*\(owned\.length > 1\)\s*\{\s*\n\s*throw new Error/)
  assert.notEqual(guardIndex, -1, 'expected an explicit `if (owned.length > 1) { throw new Error(...) }` ambiguity guard')

  const createCommentIndex = successStep.indexOf('github.rest.issues.createComment(')
  const updateIndex = successStep.indexOf('github.rest.issues.update(')
  assert.notEqual(createCommentIndex, -1)
  assert.notEqual(updateIndex, -1)
  assert.ok(guardIndex < createCommentIndex, 'ambiguity guard must precede issues.createComment')
  assert.ok(guardIndex < updateIndex, 'ambiguity guard must precede issues.update')
  assert.equal((successStep.match(/github\.rest\.issues\.create\(/g) || []).length, 0)

  const errorMatch = successStep.match(/throw new Error\(`([^`]*)`\)/)
  assert.ok(errorMatch, 'expected a template-literal Error message for the ambiguity guard')
  const errorTemplate = errorMatch[1]
  for (const forbidden of ['inputs.slugs', 'secrets.', 'SUPABASE_SECRET_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'i.body']) {
    assert.equal(errorTemplate.includes(forbidden), false, `ambiguity error must not reference ${forbidden}`)
  }

  // 0-match branch is a no-op (return, no mutation) and must precede the
  // now-safe `owned[0]` read used by the 1-match branch.
  const zeroMatchIndex = successStep.search(/if\s*\(owned\.length === 0\)/)
  const ownedZeroReadIndex = successStep.indexOf('const match = owned[0]')
  assert.notEqual(zeroMatchIndex, -1, 'expected an explicit `if (owned.length === 0)` branch')
  assert.notEqual(ownedZeroReadIndex, -1)
  assert.ok(guardIndex < zeroMatchIndex && zeroMatchIndex < ownedZeroReadIndex,
    'expected order: ambiguity guard, then 0-match branch, then the now-safe owned[0] read')
  assert.match(successStep.slice(zeroMatchIndex, zeroMatchIndex + 200), /return/)
  assert.match(successStep, /state: 'closed'/)
  assert.equal((successStep.match(/github\.rest\.issues\.update\(/g) || []).length, 1)
})

// --- non-regression: dependency versions untouched ------------------------

test('package.json dependencies and devDependencies are untouched aside from the Node 24 engines field, the intentional sanitize-html addition (Codex-audit stored-XSS fix for the auto-blog cron), the intentional sharp addition (Codex-audit fix: compress-blog-images.mjs imports sharp directly, so it must be a declared dependency rather than relying on it being incidentally present as one of Next.js\'s own optionalDependencies), the intentional vitest addition (Codex/PM-authorized: the AI API security regression suite under src/lib/ai/**/*.vitest.ts and src/app/api/{analyze-meal,character-message,training-calorie}/route.vitest.ts needs real module-boundary mocking for route handlers that Node\'s built-in test runner cannot provide without either a new dependency or an unreliable custom loader - see vitest.ai-security.config.ts), and the intentional dependency-hygiene cleanup (PM-authorized: kuromoji removed entirely -- confirmed unused by any import/require in the repository, only ever referenced by this very snapshot assertion; puppeteer moved from dependencies to devDependencies -- confirmed used only by manual, developer-run scripts under supabase/ (test-puppeteer.mjs, scrape-famimaru-new-categories.mjs), never by src/, any npm script, or any GitHub Actions workflow)', () => {
  assert.deepEqual(pkg.dependencies, {
    '@next/third-parties': '^16.2.6',
    '@supabase/ssr': '^0.10.0',
    '@supabase/supabase-js': '^2.101.1',
    'lucide-react': '^1.7.0',
    next: '16.2.2',
    openai: '^6.36.0',
    react: '19.2.4',
    'react-dom': '19.2.4',
    recharts: '^3.8.1',
    'sanitize-html': '^2.17.6',
    sharp: '^0.34.5',
  })
  assert.deepEqual(pkg.devDependencies, {
    '@tailwindcss/postcss': '^4',
    '@types/node': '^20',
    '@types/react': '^19',
    '@types/react-dom': '^19',
    eslint: '^9',
    'eslint-config-next': '16.2.2',
    puppeteer: '^25.1.0',
    supabase: '2.109.1',
    tailwindcss: '^4',
    typescript: '^5',
    vitest: '4.1.10',
    xlsx: '^0.18.5',
  })
})

test('package.json scripts match the approved runtime/tooling contract', () => {
  // `typecheck` / `test` / `test:ai` は PM 承認済みの追加（AIセキュリティ回帰
  // スイートの配線 + baseline CI、および TypeScript typecheck debt cleanup）。
  // `typecheck` は専用設定 tsconfig.typecheck.json（tsconfig.json を extends し
  // allowImportingTsExtensions のみ追加）を明示的に指す。tsconfig.json 本体
  // （Next のビルドが暗黙に使う唯一の project-wide config）には一切触れない。
  // `test` は明示的な dot-test glob を指定する: 素の `node --test` は
  // `test-*.{js,mjs,cjs}` も discover するため、手動 Puppeteer ユーティリティ
  // `supabase/test-puppeteer.mjs`（実ネットワークへ goto する非決定的スクリプト）
  // まで実行してしまう。glob は Node（シェルではなく）が展開するよう quote する。
  // `test:ai` は既存の専用設定 vitest.ai-security.config.ts を明示的に指す
  // （vitest はこの非デフォルト名を自動ロードしないため）。
  // それ以外の予期しない script 変更は引き続きこの deepEqual で検出する。
  assert.deepEqual(pkg.scripts, {
    dev: 'next dev',
    build: 'next build',
    start: 'next start',
    lint: 'eslint',
    typecheck: 'tsc -p tsconfig.typecheck.json',
    test: 'node --test "**/*.test.{js,mjs,cjs,ts,mts,cts}"',
    'test:ai': 'vitest run --config vitest.ai-security.config.ts',
  })
})

// --- package-lock.json root metadata sync (Codex MEDIUM follow-up) --------
// package.json's engines field means nothing to installers unless
// package-lock.json's own root entry (packages[""]) carries the same value —
// npm reads *that* copy when deciding whether the current Node satisfies the
// declared engine range. Produced via a real `npm install` on Node 24/npm 11
// (no manual JSON editing), so this also proves the lockfile stayed valid.

test('package-lock.json root package (packages[""]) declares the same engines.node as package.json', () => {
  const root = packageLock.packages?.['']
  assert.ok(root, 'package-lock.json is missing a root packages[""] entry')
  assert.deepEqual(root.engines, pkg.engines)
})

test('package-lock.json lockfileVersion is unchanged (3)', () => {
  assert.equal(packageLock.lockfileVersion, 3)
})

test('package-lock.json root name/version still match package.json (no unrelated root metadata drift)', () => {
  const root = packageLock.packages?.['']
  assert.equal(root.name, pkg.name)
  assert.equal(root.version, pkg.version)
})

test('package-lock.json root dependencies/devDependencies still mirror package.json exactly (engines sync did not touch dependency ranges)', () => {
  const root = packageLock.packages?.['']
  assert.deepEqual(root.dependencies, pkg.dependencies)
  assert.deepEqual(root.devDependencies, pkg.devDependencies)
})
