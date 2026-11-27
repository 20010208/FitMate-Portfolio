import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Plain string/regex checks only (no SQL parser dependency), matching this
// repository's convention for the other migration test file
// (202607240001_restrict_meal_photos_select.test.mjs). This migration's SQL
// is short and hand-authored directly from a confirmed production source, so
// these checks are not expected to be brittle. The migration file itself is
// read fresh on every run — no SQL is copied into this test file (synthetic
// fragments used for parser negative-case tests below are hand-written and
// contain no real credentials or user data).

const migrationPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '202607240002_harden_public_functions.sql'
)
const sql = readFileSync(migrationPath, 'utf8')

// Strips `-- ...` line comments, so structural/count-based ("doesNotMatch")
// checks below aren't tripped up by this file's own explanatory prose
// (which necessarily mentions things like "does not touch reserve_ai_usage"
// or `search_path=''` in English sentences).
function stripLineComments(text) {
  return text
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--')
      return idx === -1 ? line : line.slice(0, idx)
    })
    .join('\n')
}
const code = stripLineComments(sql)
const lowerCode = code.toLowerCase()

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Extracts exactly one `create or replace function <signature> ... $$;`
 * block from the (comment-stripped) migration text. Fails the calling test
 * if the signature is missing or appears more than once. The block is
 * bounded precisely by the function's own closing `$$;` line, so it never
 * leaks into a neighboring function's clauses or comments.
 */
function extractFunctionBlock(sourceCode, signature) {
  const headerRe = new RegExp(`create or replace function\\s+${escapeRegex(signature)}`, 'gi')
  const matches = [...sourceCode.matchAll(headerRe)]
  assert.equal(
    matches.length,
    1,
    `expected exactly one "create or replace function ${signature}", found ${matches.length}`
  )
  const start = matches[0].index
  const rest = sourceCode.slice(start)
  const endMatch = rest.match(/\n\$\$;/)
  assert.ok(endMatch, `could not find a closing "$$;" for function ${signature}`)
  return rest.slice(0, endMatch.index + endMatch[0].length)
}

/** Word-boundary volatility check: exactly the required keyword, and none of the others. */
function assertVolatility(block, required, forbidden) {
  assert.match(block, new RegExp(`\\b${required}\\b`, 'i'), `expected ${required} in block`)
  for (const word of forbidden) {
    assert.doesNotMatch(block, new RegExp(`\\b${word}\\b`, 'i'), `did not expect ${word} in block`)
  }
}

// --- top-level SQL statement parser -----------------------------------------
//
// Migration-wide REVOKE/GRANT/RETURN checks need to reason about statements
// *outside* function bodies without being fooled by matching text that
// happens to appear *inside* a `create or replace function ... as $$ ... $$;`
// body (comments are already stripped by stripLineComments before any of
// this runs). This migration only ever uses the plain `$$` (unlabeled)
// dollar-quote tag, and no function body contains a literal `$$` substring,
// so a non-greedy `$$...$$` match reliably captures each function's own
// body without needing a fully general dollar-quote-tag-aware parser.

/** Replaces every `as $$ ... $$` function body with a fixed placeholder. */
function maskFunctionBodies(sourceCode) {
  return sourceCode.replace(/as\s+\$\$[\s\S]*?\$\$/gi, 'as $$__BODY__$$')
}

/**
 * Splits (comment- and body-masked) SQL into trimmed, non-empty top-level
 * statements on `;` boundaries. Does not mutate the input string.
 */
function extractTopLevelStatements(sourceCode) {
  const masked = maskFunctionBodies(sourceCode)
  return masked
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function normalizeWhitespace(s) {
  return s.replace(/\s+/g, ' ').trim()
}

function stripQuotes(s) {
  const trimmed = s.trim()
  const m = trimmed.match(/^"(.*)"$/)
  return (m ? m[1] : trimmed).toLowerCase()
}

/**
 * Parses a single top-level `revoke execute on function X(...) from A, B ...
 * [cascade|restrict]` statement (case-insensitive, whitespace/newline/tab
 * tolerant, quoted-role tolerant, multi-grantee tolerant). Returns null if
 * the statement doesn't match this exact shape (an "unparsed" REVOKE
 * EXECUTE statement, which callers must treat as a failure rather than
 * silently ignore).
 */
function parseRevokeExecuteStatement(stmt) {
  const normalized = normalizeWhitespace(stmt)
  const match = normalized.match(
    /^revoke\s+execute\s+on\s+function\s+([\w."]+)\s*\(([^)]*)\)\s+from\s+(.+?)(?:\s+(cascade|restrict))?$/i
  )
  if (!match) return null
  const functionSignature = `${stripQuotes(match[1])}(${match[2].trim().toLowerCase()})`
  const grantees = match[3].split(',').map((g) => stripQuotes(g))
  const trailingClause = match[4] ? match[4].toLowerCase() : null
  return { functionSignature, grantees, trailingClause }
}

/**
 * Finds every top-level REVOKE EXECUTE statement in the (comment-stripped)
 * migration text, parses each one, and expands multi-grantee statements into
 * one `{ functionSignature, grantee, trailingClause }` entry per grantee.
 *
 * Returns:
 *   - rawCount: number of top-level statements that start with "revoke execute"
 *   - parsed: flattened per-grantee entries for every statement that parsed cleanly
 *   - unparsed: raw text of any "revoke execute"-looking statement that did NOT
 *     match the expected shape (must be empty for the migration to be considered safe)
 */
function extractRevokeExecuteStatements(sourceCode) {
  const statements = extractTopLevelStatements(sourceCode)
  const revokeLike = statements.filter((s) => normalizeWhitespace(s).toLowerCase().startsWith('revoke execute'))
  const parsed = []
  const unparsed = []
  for (const stmt of revokeLike) {
    const result = parseRevokeExecuteStatement(stmt)
    if (!result) {
      unparsed.push(stmt)
      continue
    }
    for (const grantee of result.grantees) {
      parsed.push({ functionSignature: result.functionSignature, grantee, trailingClause: result.trailingClause })
    }
  }
  return { rawCount: revokeLike.length, parsed, unparsed }
}

/** Finds every top-level GRANT EXECUTE statement (whitespace/newline/case-insensitive). */
function extractGrantExecuteStatements(sourceCode) {
  const statements = extractTopLevelStatements(sourceCode)
  return statements.filter((s) => normalizeWhitespace(s).toLowerCase().startsWith('grant execute'))
}

/**
 * Extracts clean single-identifier `return <ident>;` statements (e.g.
 * `return new;`, `return old;`, `return null;`) from a block. Deliberately
 * does not match `returns <type>` (the function's return-type declaration),
 * since `\s+` cannot match the `s` immediately following `return` there.
 */
function extractCleanReturnStatements(block) {
  const re = /\breturn\s+([a-z_][\w.]*)\s*;/gi
  return [...block.matchAll(re)].map((m) => m[1].toLowerCase())
}

// --- migration scope ---------------------------------------------------

test('migration replaces exactly the 4 target functions, no more', () => {
  const matches = [...lowerCode.matchAll(/create or replace function/g)]
  assert.equal(matches.length, 4)
})

test('migration touches only the 4 named target functions (each exactly once)', () => {
  const signatures = [
    'public.get_brand_categories(brand_name text)',
    'public.kata_to_hira(t text)',
    'public.set_food_item_reading()',
    'public.handle_new_user()',
  ]
  for (const signature of signatures) {
    // extractFunctionBlock itself asserts exactly-one / not-missing.
    extractFunctionBlock(code, signature)
  }
})

test('migration does not touch reserve_ai_usage or release_ai_usage', () => {
  assert.doesNotMatch(lowerCode, /reserve_ai_usage/)
  assert.doesNotMatch(lowerCode, /release_ai_usage/)
})

test('migration does not reference Storage objects/buckets in SQL', () => {
  assert.doesNotMatch(lowerCode, /storage\.buckets/)
  assert.doesNotMatch(lowerCode, /storage\.objects/)
})

test('migration contains no table/column DDL', () => {
  assert.doesNotMatch(lowerCode, /create table/)
  assert.doesNotMatch(lowerCode, /alter table/)
  assert.doesNotMatch(lowerCode, /drop table/)
})

test('migration contains no trigger DDL (create/drop/alter trigger)', () => {
  assert.doesNotMatch(lowerCode, /create trigger/)
  assert.doesNotMatch(lowerCode, /drop trigger/)
  assert.doesNotMatch(lowerCode, /alter trigger/)
})

test('migration contains no RLS/policy changes', () => {
  assert.doesNotMatch(lowerCode, /row level security/)
  assert.doesNotMatch(lowerCode, /create policy/)
  assert.doesNotMatch(lowerCode, /drop policy/)
  assert.doesNotMatch(lowerCode, /alter policy/)
})

test('migration contains no DROP FUNCTION', () => {
  assert.doesNotMatch(lowerCode, /drop function/)
})

test('migration does not change function ownership', () => {
  assert.doesNotMatch(lowerCode, /owner to/)
  assert.doesNotMatch(lowerCode, /alter function/)
})

test('the only INSERT anywhere in the code is handle_new_user\'s own trigger body, not top-level DML', () => {
  const insertMatches = [...code.matchAll(/insert into/gi)]
  assert.equal(insertMatches.length, 1)
  assert.match(code, /insert into public\.profiles \(user_id\)\s*\n\s*values \(new\.id\);/)
})

test('migration contains no UPDATE or DELETE DML statements', () => {
  assert.doesNotMatch(lowerCode, /\bupdate\s+public\./)
  assert.doesNotMatch(lowerCode, /delete from/)
})

test('migration contains no dynamic SQL or DO blocks', () => {
  assert.doesNotMatch(lowerCode, /\bdo\s+\$/)
  assert.doesNotMatch(lowerCode, /execute\s+format/)
})

test('every SET search_path clause is the empty string, never a writable schema', () => {
  const clauses = [...code.matchAll(/set search_path\s*=\s*'([^']*)'/gi)].map((m) => m[1])
  assert.equal(clauses.length, 4)
  for (const value of clauses) {
    assert.equal(value, '')
  }
})

test('search_path is never set to a schema list containing public or pg_temp', () => {
  assert.doesNotMatch(lowerCode, /search_path\s*=\s*'public/)
  assert.doesNotMatch(lowerCode, /pg_temp/)
})

// --- get_brand_categories ---------------------------------------------------

test('get_brand_categories: VOLATILE present; IMMUTABLE/STABLE absent (word-boundary, no substring false positives)', () => {
  const block = extractFunctionBlock(code, 'public.get_brand_categories(brand_name text)')
  assertVolatility(block, 'volatile', ['immutable', 'stable'])
})

test('get_brand_categories: attributes preserved (returns table, language sql, called on null input, security invoker, parallel unsafe, empty search_path)', () => {
  const block = extractFunctionBlock(code, 'public.get_brand_categories(brand_name text)')
  assert.match(block, /returns table\(category text\)/i)
  assert.match(block, /language sql/i)
  assert.match(block, /called on null input/i)
  assert.match(block, /security invoker/i)
  assert.doesNotMatch(block, /security definer/i)
  assert.match(block, /parallel unsafe/i)
  assert.match(block, /set search_path = ''/)
})

test('get_brand_categories: full query semantics preserved (DISTINCT, brand filter, null/empty exclusion, order, schema-qualified table)', () => {
  const block = extractFunctionBlock(code, 'public.get_brand_categories(brand_name text)')
  assert.match(block, /SELECT DISTINCT category/)
  assert.match(block, /FROM public\.food_items/)
  assert.match(block, /WHERE brand = brand_name/)
  assert.match(block, /AND category IS NOT NULL/)
  assert.match(block, /AND category != ''/)
  assert.match(block, /ORDER BY category/)
})

// --- kata_to_hira -------------------------------------------------------

test('kata_to_hira: IMMUTABLE present; VOLATILE/STABLE absent (word-boundary, no substring false positives)', () => {
  const block = extractFunctionBlock(code, 'public.kata_to_hira(t text)')
  assertVolatility(block, 'immutable', ['volatile', 'stable'])
})

test('kata_to_hira: attributes preserved (returns text, language plpgsql, called on null input, security invoker, parallel unsafe, empty search_path)', () => {
  const block = extractFunctionBlock(code, 'public.kata_to_hira(t text)')
  assert.match(block, /returns text/i)
  assert.match(block, /language plpgsql/i)
  assert.match(block, /called on null input/i)
  assert.match(block, /security invoker/i)
  assert.doesNotMatch(block, /security definer/i)
  assert.match(block, /parallel unsafe/i)
  assert.match(block, /set search_path = ''/)
})

test('kata_to_hira: katakana-to-hiragana conversion core is unchanged (loop bounds, code range, offset, fallback, return)', () => {
  const block = extractFunctionBlock(code, 'public.kata_to_hira(t text)')
  assert.match(block, /FOR i IN 1\.\.length\(t\) LOOP/)
  assert.match(block, /code := ascii\(substring\(t FROM i FOR 1\)\)/)
  assert.match(block, /code >= 12449/)
  assert.match(block, /code <= 12534/)
  assert.match(block, /chr\(code - 96\)/)
  assert.match(block, /ELSE/)
  assert.match(block, /result := result \|\| substring\(t FROM i FOR 1\);/)
  assert.match(block, /RETURN result;/)
})

// --- set_food_item_reading -----------------------------------------------

test('set_food_item_reading: VOLATILE present; IMMUTABLE/STABLE absent (word-boundary, no substring false positives)', () => {
  const block = extractFunctionBlock(code, 'public.set_food_item_reading()')
  assertVolatility(block, 'volatile', ['immutable', 'stable'])
})

test('set_food_item_reading: attributes preserved (returns trigger, language plpgsql, called on null input, security invoker, parallel unsafe, empty search_path)', () => {
  const block = extractFunctionBlock(code, 'public.set_food_item_reading()')
  assert.match(block, /returns trigger/i)
  assert.match(block, /language plpgsql/i)
  assert.match(block, /called on null input/i)
  assert.match(block, /security invoker/i)
  assert.doesNotMatch(block, /security definer/i)
  assert.match(block, /parallel unsafe/i)
  assert.match(block, /set search_path = ''/)
})

test('set_food_item_reading: trigger semantics preserved (null-guarded assignment via schema-qualified kata_to_hira, RETURN NEW)', () => {
  const block = extractFunctionBlock(code, 'public.set_food_item_reading()')
  assert.match(block, /IF NEW\.reading IS NULL THEN/)
  assert.match(block, /NEW\.reading := public\.kata_to_hira\(NEW\.name\);/)
  assert.match(block, /END IF;/)
  assert.match(block, /RETURN NEW;/)
})

test('set_food_item_reading: exactly one RETURN statement, and it is RETURN NEW (no RETURN OLD/NULL/NEXT/QUERY)', () => {
  const block = extractFunctionBlock(code, 'public.set_food_item_reading()')
  const returns = extractCleanReturnStatements(block)
  assert.deepEqual(returns, ['new'])
  assert.doesNotMatch(block, /\breturn\s+next\b/i)
  assert.doesNotMatch(block, /\breturn\s+query\b/i)
})

// --- handle_new_user ------------------------------------------------------

test('handle_new_user: VOLATILE present; IMMUTABLE/STABLE absent (word-boundary, no substring false positives)', () => {
  const block = extractFunctionBlock(code, 'public.handle_new_user()')
  assertVolatility(block, 'volatile', ['immutable', 'stable'])
})

test('handle_new_user: attributes preserved (returns trigger, language plpgsql, called on null input, security definer, parallel unsafe, empty search_path)', () => {
  const block = extractFunctionBlock(code, 'public.handle_new_user()')
  assert.match(block, /returns trigger/i)
  assert.match(block, /language plpgsql/i)
  assert.match(block, /called on null input/i)
  assert.match(block, /security definer/i)
  assert.doesNotMatch(block, /security invoker/i)
  assert.match(block, /parallel unsafe/i)
  assert.match(block, /set search_path = ''/)
})

test('handle_new_user: trigger semantics preserved (schema-qualified insert, NEW.id, RETURN NEW)', () => {
  const block = extractFunctionBlock(code, 'public.handle_new_user()')
  assert.match(block, /insert into public\.profiles \(user_id\)/)
  assert.match(block, /values \(new\.id\);/)
  assert.match(block, /return new;/)
})

test('handle_new_user: exactly one RETURN statement, and it is RETURN NEW (no RETURN OLD/NULL/NEXT/QUERY)', () => {
  const block = extractFunctionBlock(code, 'public.handle_new_user()')
  const returns = extractCleanReturnStatements(block)
  assert.deepEqual(returns, ['new'])
  assert.doesNotMatch(block, /\breturn\s+next\b/i)
  assert.doesNotMatch(block, /\breturn\s+query\b/i)
})

// --- REVOKE / GRANT EXECUTE (top-level statement parser based) -------------

test('exactly 3 top-level REVOKE EXECUTE statements exist and all parse cleanly (0 unparsed)', () => {
  const { rawCount, parsed, unparsed } = extractRevokeExecuteStatements(code)
  assert.equal(rawCount, 3, `expected 3 raw REVOKE EXECUTE statements, found ${rawCount}`)
  assert.equal(unparsed.length, 0, `expected 0 unparsed REVOKE EXECUTE statements, found ${unparsed.length}: ${JSON.stringify(unparsed)}`)
  assert.equal(parsed.length, 3)
})

test('REVOKE statements all target public.handle_new_user(), no other function, and carry no CASCADE/RESTRICT', () => {
  const { parsed } = extractRevokeExecuteStatements(code)
  for (const r of parsed) {
    assert.equal(r.functionSignature, 'public.handle_new_user()')
    assert.equal(r.trailingClause, null)
  }
})

test('REVOKE grantees are exactly {public, anon, authenticated}, no duplicates, no extras', () => {
  const { parsed } = extractRevokeExecuteStatements(code)
  const grantees = parsed.map((r) => r.grantee).sort()
  assert.deepEqual(grantees, ['anon', 'authenticated', 'public'])
})

test('no REVOKE targets service_role, postgres, or any function other than handle_new_user', () => {
  const { parsed } = extractRevokeExecuteStatements(code)
  const forbiddenGrantees = new Set(['service_role', 'postgres'])
  const forbiddenFunctions = new Set([
    'public.get_brand_categories(brand_name text)',
    'public.kata_to_hira(t text)',
    'public.set_food_item_reading()',
    'public.reserve_ai_usage(p_route text, p_request_id uuid)',
    'public.release_ai_usage(p_route text, p_request_id uuid)',
  ])
  for (const r of parsed) {
    assert.ok(!forbiddenGrantees.has(r.grantee), `unexpected grantee revoked: ${r.grantee}`)
    assert.ok(!forbiddenFunctions.has(r.functionSignature), `unexpected function revoked: ${r.functionSignature}`)
  }
})

test('no "grant execute" (word-boundary, case-insensitive, any whitespace) appears anywhere in the code', () => {
  assert.doesNotMatch(lowerCode, /\bgrant\s+execute\b/)
})

test('top-level statement parser independently confirms zero GRANT EXECUTE statements', () => {
  const grants = extractGrantExecuteStatements(code)
  assert.equal(grants.length, 0)
})

// --- synthetic negative-case tests for the parser helpers themselves -------
// Small hand-written SQL fragments (no real credentials/user data) that
// exercise edge cases the current migration doesn't happen to contain, to
// prove the parsers above would actually catch a dangerous future change
// rather than silently passing.

test('parser: a REVOKE-looking string literal inside a function body is not mistaken for a top-level statement', () => {
  const synthetic = [
    'create or replace function public.example()',
    'returns text',
    'language plpgsql',
    'as $$',
    'begin',
    "  return 'revoke execute on function public.example() from public;';",
    'end;',
    '$$;',
  ].join('\n')
  const { rawCount } = extractRevokeExecuteStatements(synthetic)
  assert.equal(rawCount, 0)
})

test('parser: a GRANT mentioned only inside a comment is ignored once comments are stripped', () => {
  const synthetic = [
    '-- grant execute on function public.example() to public;',
    'create or replace function public.example()',
    'returns integer',
    'language sql',
    'as $$ select 1 $$;',
  ].join('\n')
  const grants = extractGrantExecuteStatements(stripLineComments(synthetic))
  assert.equal(grants.length, 0)
})

test('parser: GRANT EXECUTE is detected even with a line break between GRANT and EXECUTE', () => {
  const synthetic = 'grant\nexecute on function public.example() to public;'
  const grants = extractGrantExecuteStatements(synthetic)
  assert.equal(grants.length, 1)
})

test('parser: GRANT EXECUTE is detected with tabs and repeated whitespace', () => {
  const synthetic = 'grant\t\texecute   on function public.example() to public;'
  const grants = extractGrantExecuteStatements(synthetic)
  assert.equal(grants.length, 1)
})

test('parser: a single REVOKE with comma-separated grantees expands into one entry per grantee', () => {
  const synthetic = 'revoke execute on function public.example() from anon, authenticated;'
  const { rawCount, parsed } = extractRevokeExecuteStatements(synthetic)
  assert.equal(rawCount, 1)
  assert.deepEqual(parsed.map((p) => p.grantee).sort(), ['anon', 'authenticated'])
})

test('parser: a REVOKE with a quoted role is still recognized', () => {
  const synthetic = 'revoke execute on function public.example() from "anon";'
  const { parsed } = extractRevokeExecuteStatements(synthetic)
  assert.deepEqual(parsed.map((p) => p.grantee), ['anon'])
})

test('parser: a REVOKE with a trailing CASCADE is captured as such, not silently dropped', () => {
  const synthetic = 'revoke execute on function public.example() from anon cascade;'
  const { parsed } = extractRevokeExecuteStatements(synthetic)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].grantee, 'anon')
  assert.equal(parsed[0].trailingClause, 'cascade')
})

test('parser: function signature parentheses do not break top-level statement splitting', () => {
  const synthetic = [
    'create or replace function public.example(a text, b integer)',
    'returns void',
    'language sql',
    'as $$ select 1; $$;',
    'revoke execute on function public.example(a text, b integer) from public;',
  ].join('\n')
  const statements = extractTopLevelStatements(synthetic)
  assert.equal(statements.length, 2)
  const { rawCount, parsed } = extractRevokeExecuteStatements(synthetic)
  assert.equal(rawCount, 1)
  assert.equal(parsed[0].functionSignature, 'public.example(a text, b integer)')
})

test('parser (RETURN): a single RETURN NEW is recognized as exactly one clean return', () => {
  const block = 'begin\n  return new;\nend;\n$$;'
  assert.deepEqual(extractCleanReturnStatements(block), ['new'])
})

test('parser (RETURN): a RETURN OLD added alongside RETURN NEW is detected (2 returns, includes old)', () => {
  const block = 'begin\n  if false then\n    return old;\n  end if;\n  return new;\nend;\n$$;'
  const returns = extractCleanReturnStatements(block)
  assert.equal(returns.length, 2)
  assert.ok(returns.includes('old'))
  assert.ok(returns.includes('new'))
})

test('parser (RETURN): a RETURN NULL added alongside RETURN NEW is detected', () => {
  const block = 'begin\n  return null;\n  return new;\nend;\n$$;'
  const returns = extractCleanReturnStatements(block).sort()
  assert.deepEqual(returns, ['new', 'null'])
})

test('parser (RETURN): "returns trigger" (the function return-type declaration) is never mistaken for a RETURN statement', () => {
  const block = 'returns trigger\nlanguage plpgsql\nbegin\n  return new;\nend;\n$$;'
  assert.deepEqual(extractCleanReturnStatements(block), ['new'])
})

test('parser (RETURN): a RETURN OLD mentioned only in a comment is ignored once comments are stripped first', () => {
  const synthetic = '-- do not add: return old;\nbegin\n  return new;\nend;\n$$;'
  const returns = extractCleanReturnStatements(stripLineComments(synthetic))
  assert.deepEqual(returns, ['new'])
})
