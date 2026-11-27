import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toSafeJsonLdString } from './safeJsonLd.ts'

test('produces valid, parseable JSON for a normal object', () => {
  const input = { a: 1, b: 'text', c: [1, 2, 3] }
  const result = toSafeJsonLdString(input)
  assert.deepEqual(JSON.parse(result), input)
})

test('neutralizes a literal </script> inside a string value', () => {
  const input = { headline: 'Title</script><script>alert(1)</script>' }
  const result = toSafeJsonLdString(input)
  assert.equal(result.includes('</script>'), false)
  assert.equal(result.includes('<script>'), false)
  // still valid JSON, and decodes back to the original text
  assert.deepEqual(JSON.parse(result), input)
})

test('neutralizes a bare < anywhere in a string value', () => {
  const input = { text: '5 < 10 and <b>bold</b>' }
  const result = toSafeJsonLdString(input)
  assert.equal(result.includes('<'), false)
  assert.deepEqual(JSON.parse(result), input)
})

test('does not double-encode: the escaped output round-trips to exactly the original', () => {
  const input = { text: '<<<multiple<<<brackets<<<' }
  const result = toSafeJsonLdString(input)
  assert.equal(JSON.parse(result).text, input.text)
})

test('leaves values with no special characters unchanged in meaning', () => {
  const input = { headline: 'ふつうの記事タイトル', category: 'ダイエット' }
  const result = toSafeJsonLdString(input)
  assert.deepEqual(JSON.parse(result), input)
})

test('handles nested objects and arrays (as used by Article/BreadcrumbList JSON-LD)', () => {
  const input = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home</script>', item: 'https://www.fitmate.run' },
    ],
  }
  const result = toSafeJsonLdString(input)
  assert.equal(result.includes('</script>'), false)
  assert.deepEqual(JSON.parse(result), input)
})
