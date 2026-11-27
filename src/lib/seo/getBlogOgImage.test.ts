import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveBlogOgImage } from './getBlogOgImage.ts'

// Pure function only. No network, no Supabase, no filesystem access anywhere
// in this file.

const SITE_ORIGIN = 'https://www.fitmate.run'
const FALLBACK = 'https://www.fitmate.run/og-image.png'

test('null falls back to the common OG image', () => {
  assert.equal(resolveBlogOgImage(null, SITE_ORIGIN), FALLBACK)
})

test('undefined falls back to the common OG image', () => {
  assert.equal(resolveBlogOgImage(undefined, SITE_ORIGIN), FALLBACK)
})

test('empty string falls back to the common OG image', () => {
  assert.equal(resolveBlogOgImage('', SITE_ORIGIN), FALLBACK)
})

test('whitespace-only string falls back to the common OG image', () => {
  assert.equal(resolveBlogOgImage('   \t\n  ', SITE_ORIGIN), FALLBACK)
})

test('a normal absolute https URL is kept as-is', () => {
  const input = 'https://cdn.example.com/blog/article-1.png'
  assert.equal(resolveBlogOgImage(input, SITE_ORIGIN), input)
})

test('a normal absolute http URL is kept as-is', () => {
  const input = 'http://cdn.example.com/blog/article-1.png'
  assert.equal(resolveBlogOgImage(input, SITE_ORIGIN), input)
})

test('a root-relative path is resolved against the production origin', () => {
  assert.equal(
    resolveBlogOgImage('/blog-images/article-1.png', SITE_ORIGIN),
    'https://www.fitmate.run/blog-images/article-1.png'
  )
})

test('a malformed URL falls back to the common OG image', () => {
  assert.equal(resolveBlogOgImage('http://', SITE_ORIGIN), FALLBACK)
  assert.equal(resolveBlogOgImage('https://', SITE_ORIGIN), FALLBACK)
})

test('a javascript: URL falls back to the common OG image', () => {
  assert.equal(resolveBlogOgImage('javascript:alert(1)', SITE_ORIGIN), FALLBACK)
})

test('a data: URL falls back to the common OG image', () => {
  assert.equal(
    resolveBlogOgImage('data:text/plain;base64,SGVsbG8=', SITE_ORIGIN),
    FALLBACK
  )
})

test('a file: URL falls back to the common OG image', () => {
  assert.equal(resolveBlogOgImage('file:///etc/passwd', SITE_ORIGIN), FALLBACK)
})

test('does not mutate the input string', () => {
  const input = 'https://cdn.example.com/blog/article-1.png'
  const before = input
  resolveBlogOgImage(input, SITE_ORIGIN)
  assert.equal(input, before)
})

test('always returns a non-empty string usable as Next.js image metadata', () => {
  const cases: Array<string | null | undefined> = [
    null,
    undefined,
    '',
    '   ',
    'https://cdn.example.com/x.png',
    'not a url',
    'javascript:alert(1)',
  ]
  for (const value of cases) {
    const result = resolveBlogOgImage(value, SITE_ORIGIN)
    assert.equal(typeof result, 'string')
    assert.ok(result.length > 0)
  }
})

test('the common OG image itself resolves to an absolute URL', () => {
  const result = resolveBlogOgImage(undefined, SITE_ORIGIN)
  assert.equal(result, FALLBACK)
  assert.doesNotThrow(() => new URL(result))
})

test('a disallowed-scheme input is never echoed back into the result', () => {
  const maliciousInputs = [
    'javascript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
  ]
  for (const input of maliciousInputs) {
    const result = resolveBlogOgImage(input, SITE_ORIGIN)
    assert.equal(result, FALLBACK)
    assert.equal(result.includes('javascript:'), false)
    assert.equal(result.includes('<script>'), false)
  }
})
