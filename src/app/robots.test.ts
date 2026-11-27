import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MetadataRoute } from 'next'
import robots from './robots.ts'

// Pure function only. No network, no Supabase.

const TARGET_ROUTES = ['/dashboard', '/training', '/meal', '/weight', '/history']
const MEAL_SUBROUTES = ['/meal/food-search', '/meal/history', '/meal/custom-items']

// `MetadataRoute.Robots['rules']` is typed as a single rule object OR an
// array of rule objects (the Next.js type supports both shapes). robots()
// always returns a single object at runtime, but that is a fact this file
// must prove, not assume: if robots() ever starts returning an array, every
// test below must fail loudly instead of silently reading undefined
// properties off an array element.
type SingleRule = Extract<MetadataRoute.Robots['rules'], { userAgent?: unknown }>

function singleRules(result: MetadataRoute.Robots): SingleRule {
  if (Array.isArray(result.rules)) {
    throw new Error('expected robots().rules to be a single rule object, not an array')
  }
  return result.rules
}

test('target app routes are not disallowed (crawler can read their noindex meta tag)', () => {
  const rules = singleRules(robots())
  for (const route of TARGET_ROUTES) {
    assert.equal(rules.disallow?.includes(route), false, `${route} unexpectedly disallowed`)
  }
})

test('target app routes are explicitly allowed', () => {
  const rules = singleRules(robots())
  for (const route of TARGET_ROUTES) {
    assert.ok(rules.allow?.includes(route), `${route} missing from allow`)
  }
})

test('/blog is not disallowed', () => {
  const rules = singleRules(robots())
  assert.equal(rules.disallow?.includes('/blog'), false)
})

test('sitemap URL is preserved', () => {
  const result = robots()
  assert.equal(result.sitemap, 'https://www.fitmate.run/sitemap.xml')
})

test('private meal sub-routes remain individually disallowed after removing the /meal prefix block', () => {
  const rules = singleRules(robots())
  for (const route of MEAL_SUBROUTES) {
    assert.ok(rules.disallow?.includes(route), `${route} missing from disallow`)
  }
})

test('/profile stays disallowed (out of scope for this change)', () => {
  const rules = singleRules(robots())
  assert.ok(rules.disallow?.includes('/profile'))
})

test('no broad "Disallow: /" rule was introduced', () => {
  const rules = singleRules(robots())
  assert.equal(rules.disallow?.includes('/'), false)
})

test('return value matches the Next.js MetadataRoute.Robots shape', () => {
  const result = robots()
  assert.equal(typeof result, 'object')
  assert.ok('rules' in result)
  assert.ok('sitemap' in result)
  const rules = singleRules(result)
  assert.equal(rules.userAgent, '*')
  assert.ok(Array.isArray(rules.allow))
  assert.ok(Array.isArray(rules.disallow))
})
