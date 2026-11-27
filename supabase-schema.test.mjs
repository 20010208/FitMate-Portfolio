import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Confirms supabase-schema.sql has been non-authoritized (deprecated header,
// no "run this in the SQL Editor" instruction, points to the real source of
// truth) without asserting anything about its executable SQL body — that
// body is historical and intentionally not kept in sync with Production.

const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'supabase-schema.sql')
const sql = readFileSync(filePath, 'utf8')

test('file is explicitly marked DEPRECATED / NON-AUTHORITATIVE in its header', () => {
  assert.match(sql, /DEPRECATED \/ NON-AUTHORITATIVE REFERENCE ONLY/)
})

test('file no longer instructs the reader to run it in the Supabase SQL Editor', () => {
  assert.doesNotMatch(sql, /Supabase SQL Editorで実行してください/)
})

test('file explicitly states supabase/migrations/ is the source of truth', () => {
  assert.match(sql, /supabase\/migrations\//)
  assert.match(sql, /source of truth/i)
})

test('file references the baseline artifact as the fresh-project reference', () => {
  assert.match(sql, /supabase\/baseline\/20260804_production_schema\.sql/)
})

test('file explicitly warns it does not include the columns/objects added since it was written', () => {
  assert.match(sql, /gender\/target_days\/target_date\//)
  assert.match(sql, /step_logs\/blogs\/food_items\.reading/)
})
