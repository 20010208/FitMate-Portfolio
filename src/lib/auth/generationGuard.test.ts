import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGenerationGuard } from './generationGuard.ts'

test('the first next() call returns generation 1, and isCurrent(1) is true right after', () => {
  const guard = createGenerationGuard()
  const g1 = guard.next()
  assert.equal(g1, 1)
  assert.equal(guard.isCurrent(g1), true)
})

test('calling next() again advances the generation and invalidates the previous one', () => {
  const guard = createGenerationGuard()
  const g1 = guard.next()
  const g2 = guard.next()
  assert.notEqual(g1, g2)
  assert.equal(guard.isCurrent(g1), false)
  assert.equal(guard.isCurrent(g2), true)
})

test('models "profile fetch in flight, then logout fires": the logout generation wins even if the profile fetch resolves later', () => {
  const guard = createGenerationGuard()
  const profileFetchGeneration = guard.next() // initial getUser() kicks off an async profile fetch
  const logoutGeneration = guard.next() // onAuthStateChange (logout) fires before the profile fetch resolves
  // simulating the stale profile-fetch continuation checking itself once it finally resolves:
  assert.equal(guard.isCurrent(profileFetchGeneration), false)
  assert.equal(guard.isCurrent(logoutGeneration), true)
})

test('models "user A resolution in flight, then user B logs in": user A\'s stale result must be rejected', () => {
  const guard = createGenerationGuard()
  const userAGeneration = guard.next()
  const userBGeneration = guard.next()
  assert.equal(guard.isCurrent(userAGeneration), false)
  assert.equal(guard.isCurrent(userBGeneration), true)
})

test('with no further next() calls, the current generation stays valid on repeated checks', () => {
  const guard = createGenerationGuard()
  const g = guard.next()
  assert.equal(guard.isCurrent(g), true)
  assert.equal(guard.isCurrent(g), true)
})

test('independent guards do not interfere with each other', () => {
  const guardA = createGenerationGuard()
  const guardB = createGenerationGuard()
  const gA = guardA.next()
  const gB = guardB.next()
  guardB.next() // advance only guard B
  assert.equal(guardA.isCurrent(gA), true)
  assert.equal(guardB.isCurrent(gB), false)
})

test('a generation number that was never issued is never current', () => {
  const guard = createGenerationGuard()
  guard.next()
  assert.equal(guard.isCurrent(999), false)
  assert.equal(guard.isCurrent(0), false)
})
