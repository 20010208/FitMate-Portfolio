import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Plain string checks only (no SQL parser dependency), matching this
// repository's convention of not adding parsing dependencies for a single,
// small, self-authored SQL file. If these checks ever become too brittle to
// maintain, prefer removing them and relying on manual/Codex static review
// instead of adding a SQL parser dependency.

const migrationPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '202607240001_restrict_meal_photos_select.sql'
)
const sql = readFileSync(migrationPath, 'utf8')
const lowerSql = sql.toLowerCase()

test('migration drops the existing public SELECT policy by exact name', () => {
  assert.match(sql, /drop policy if exists "meal-photos select" on storage\.objects;/)
})

test('migration creates a policy named "meal-photos select" on storage.objects', () => {
  assert.match(sql, /create policy "meal-photos select"\s*\non storage\.objects/)
})

test('migration policy is for select only', () => {
  assert.match(lowerSql, /for select/)
})

test('migration policy targets the authenticated role', () => {
  assert.match(lowerSql, /to authenticated/)
})

test('migration policy condition scopes to the meal-photos bucket', () => {
  assert.match(sql, /bucket_id = 'meal-photos'/)
})

test('migration policy condition requires the object folder to match auth.uid()', () => {
  assert.match(sql, /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/)
})

test('migration does not grant SELECT to the public role', () => {
  assert.doesNotMatch(lowerSql, /to public/)
})

test('migration does not touch INSERT/DELETE/UPDATE policies', () => {
  assert.doesNotMatch(lowerSql, /for insert/)
  assert.doesNotMatch(lowerSql, /for delete/)
  assert.doesNotMatch(lowerSql, /for update/)
  assert.doesNotMatch(sql, /"meal-photos insert"/)
  assert.doesNotMatch(sql, /"meal-photos delete"/)
})

test('migration does not modify storage.buckets', () => {
  assert.doesNotMatch(lowerSql, /update storage\.buckets/)
  assert.doesNotMatch(lowerSql, /insert into storage\.buckets/)
  assert.doesNotMatch(lowerSql, /delete from storage\.buckets/)
})

test('migration does not disable row level security', () => {
  assert.doesNotMatch(lowerSql, /disable row level security/)
})

test('migration does not contain any grant statements', () => {
  assert.doesNotMatch(lowerSql, /\bgrant\s/)
})
