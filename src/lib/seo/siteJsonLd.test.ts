import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ORGANIZATION_JSON_LD, WEBSITE_JSON_LD, ORGANIZATION_ID, WEBSITE_ID } from './siteJsonLd.ts'

test('Organization has @context, @type, and a stable @id', () => {
  assert.equal(ORGANIZATION_JSON_LD['@context'], 'https://schema.org')
  assert.equal(ORGANIZATION_JSON_LD['@type'], 'Organization')
  assert.equal(ORGANIZATION_JSON_LD['@id'], 'https://www.fitmate.run/#organization')
  assert.equal(ORGANIZATION_JSON_LD['@id'], ORGANIZATION_ID)
})

test('Organization uses the real production logo asset, not a placeholder', () => {
  assert.equal(ORGANIZATION_JSON_LD.logo, 'https://www.fitmate.run/logo.png')
})

test('Organization has no fabricated sameAs, address, phone, or founder fields', () => {
  const keys = Object.keys(ORGANIZATION_JSON_LD)
  for (const forbidden of ['sameAs', 'address', 'telephone', 'founder']) {
    assert.equal(keys.includes(forbidden), false, `unexpected fabricated field: ${forbidden}`)
  }
})

test('WebSite has @context, @type, and a stable @id', () => {
  assert.equal(WEBSITE_JSON_LD['@context'], 'https://schema.org')
  assert.equal(WEBSITE_JSON_LD['@type'], 'WebSite')
  assert.equal(WEBSITE_JSON_LD['@id'], 'https://www.fitmate.run/#website')
  assert.equal(WEBSITE_JSON_LD['@id'], WEBSITE_ID)
})

test('WebSite references the Organization by @id (not duplicated inline)', () => {
  assert.deepEqual(WEBSITE_JSON_LD.publisher, { '@id': ORGANIZATION_ID })
})

test('WebSite has no SearchAction (no real site-search feature exists)', () => {
  assert.equal('potentialAction' in WEBSITE_JSON_LD, false)
})

test('WebSite declares Japanese as the content language', () => {
  assert.equal(WEBSITE_JSON_LD.inLanguage, 'ja')
})

test('Organization and WebSite ids are distinct from each other', () => {
  assert.notEqual(ORGANIZATION_ID, WEBSITE_ID)
})
