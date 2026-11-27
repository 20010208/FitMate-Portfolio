import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveHeaderAuthState, nextDisplayedUserState, resolveInitialOrNextUserState, GUEST_HEADER_STATE } from './resolveHeaderAuthState.ts'

// Pure function only. No network, no Supabase, no React.

const GUEST_HEADER_STATE_TRANSITION = { displayedUserId: null, immediateState: GUEST_HEADER_STATE }

test('no user resolves to the guest state', () => {
  assert.deepEqual(resolveHeaderAuthState(null, null), { isGuest: true, nickname: null })
})

test('undefined user resolves to the guest state', () => {
  assert.deepEqual(resolveHeaderAuthState(undefined, undefined), { isGuest: true, nickname: null })
})

test('a user with a nickname resolves to isGuest:false and that nickname', () => {
  assert.deepEqual(
    resolveHeaderAuthState({ id: 'user-1' }, 'Koki'),
    { isGuest: false, nickname: 'Koki' }
  )
})

test('a user with no nickname (null) resolves to isGuest:false and nickname:null', () => {
  assert.deepEqual(
    resolveHeaderAuthState({ id: 'user-1' }, null),
    { isGuest: false, nickname: null }
  )
})

test('a user with an undefined nickname resolves to nickname:null (never leaks undefined)', () => {
  const result = resolveHeaderAuthState({ id: 'user-1' }, undefined)
  assert.equal(result.isGuest, false)
  assert.equal(result.nickname, null)
})

test('GUEST_HEADER_STATE is exactly what a guest resolves to (server/client default match)', () => {
  assert.deepEqual(resolveHeaderAuthState(null, 'someone-elses-name'), GUEST_HEADER_STATE)
})

test('never returns a truthy nickname when isGuest is true', () => {
  const result = resolveHeaderAuthState(null, 'leaked-name')
  assert.equal(result.isGuest, true)
  assert.equal(result.nickname, null)
})

test('does not mutate its inputs', () => {
  const user = { id: 'user-1' }
  const userBefore = { ...user }
  resolveHeaderAuthState(user, 'Koki')
  assert.deepEqual(user, userBefore)
})

// --- nextDisplayedUserState: the AppHeader user-switch fix ------------------
// Executes the actual state-transition decision (not a string/regex check),
// modeling the exact sequences AppHeader's useAuthHeaderState() feeds it.

test('guest -> first login (a brand-new authenticated user): immediate authenticated-but-nameless state, so no stale nickname is ever shown', () => {
  const result = nextDisplayedUserState(null, { id: 'user-a' })
  assert.deepEqual(result, { displayedUserId: 'user-a', immediateState: { isGuest: false, nickname: null } })
})

test('user A -> user B (different id, no null session in between): clears immediately to authenticated-but-nameless, so A\'s nickname never lingers while B\'s profile loads', () => {
  const result = nextDisplayedUserState('user-a', { id: 'user-b' })
  assert.deepEqual(result, { displayedUserId: 'user-b', immediateState: { isGuest: false, nickname: null } })
})

test('same user re-fired (e.g. TOKEN_REFRESHED): returns null, meaning "no immediate change" -- an already-correct nickname must not be cleared or flicker', () => {
  assert.equal(nextDisplayedUserState('user-a', { id: 'user-a' }), null)
})

test('logout (user becomes null): clears immediately to the guest state, so the previous user\'s nickname is not left behind', () => {
  const result = nextDisplayedUserState('user-a', null)
  assert.deepEqual(result, { displayedUserId: null, immediateState: GUEST_HEADER_STATE })
})

test('null user while already guest: returns null, no redundant state change', () => {
  assert.equal(nextDisplayedUserState(null, null), null)
})

test('undefined user (same shape as a missing session.user) is treated the same as null', () => {
  const result = nextDisplayedUserState('user-a', undefined)
  assert.deepEqual(result, { displayedUserId: null, immediateState: GUEST_HEADER_STATE })
})

test('a full A -> B -> C sequence keeps the tracked displayedUserId in step, clearing at each real user switch and skipping same-user repeats', () => {
  let displayedUserId: string | null = null

  let step = nextDisplayedUserState(displayedUserId, { id: 'user-a' })
  assert.deepEqual(step, { displayedUserId: 'user-a', immediateState: { isGuest: false, nickname: null } })
  displayedUserId = step!.displayedUserId

  // TOKEN_REFRESHED for A: no change
  step = nextDisplayedUserState(displayedUserId, { id: 'user-a' })
  assert.equal(step, null)

  // switches to B before A's profile fetch resolved
  step = nextDisplayedUserState(displayedUserId, { id: 'user-b' })
  assert.deepEqual(step, { displayedUserId: 'user-b', immediateState: { isGuest: false, nickname: null } })
  displayedUserId = step!.displayedUserId

  // logs out
  step = nextDisplayedUserState(displayedUserId, null)
  assert.deepEqual(step, { displayedUserId: null, immediateState: GUEST_HEADER_STATE })
})

// --- resolveInitialOrNextUserState: the Codex-audit fix for AppHeader's ----
// initial auth resolution. Models "whichever of {getUser() success, getUser()
// failure treated as null, the first onAuthStateChange event including
// INITIAL_SESSION} arrives first must always resolve the placeholder",
// instead of nextDisplayedUserState()'s steady-state "no change" shortcut
// (which assumes displayedUserId===null already means guest is on screen).

test('first-ever call with no user (getUser resolved with no session) resolves definitively to guest, not "no change"', () => {
  const result = resolveInitialOrNextUserState(false, null, null)
  assert.deepEqual(result, { displayedUserId: null, immediateState: GUEST_HEADER_STATE })
})

test('first-ever call with a user (getUser resolved with a session) resolves definitively to authenticated', () => {
  const result = resolveInitialOrNextUserState(false, null, { id: 'user-a' })
  assert.deepEqual(result, { displayedUserId: 'user-a', immediateState: { isGuest: false, nickname: null } })
})

test('first-ever call after getUser() rejected (caller passes null) resolves definitively to guest, same as a clean no-session result', () => {
  const result = resolveInitialOrNextUserState(false, null, null)
  assert.deepEqual(result, GUEST_HEADER_STATE_TRANSITION)
})

test('first-ever call is INITIAL_SESSION with no session: resolves definitively to guest', () => {
  const result = resolveInitialOrNextUserState(false, null, undefined)
  assert.deepEqual(result, { displayedUserId: null, immediateState: GUEST_HEADER_STATE })
})

test('first-ever call is INITIAL_SESSION with a session: resolves definitively to authenticated', () => {
  const result = resolveInitialOrNextUserState(false, null, { id: 'user-a' })
  assert.deepEqual(result, { displayedUserId: 'user-a', immediateState: { isGuest: false, nickname: null } })
})

test('once hasResolvedInitial is true, a same-user repeat is "no change" exactly like nextDisplayedUserState (a late getUser() result must not re-render/flicker over a session that an earlier event already resolved)', () => {
  const result = resolveInitialOrNextUserState(true, 'user-a', { id: 'user-a' })
  assert.equal(result, null)
})

test('once hasResolvedInitial is true, logout (user becomes null) still resolves to guest', () => {
  const result = resolveInitialOrNextUserState(true, 'user-a', null)
  assert.deepEqual(result, { displayedUserId: null, immediateState: GUEST_HEADER_STATE })
})

test('once hasResolvedInitial is true, a user switch still resolves to the new authenticated-but-nameless state', () => {
  const result = resolveInitialOrNextUserState(true, 'user-a', { id: 'user-b' })
  assert.deepEqual(result, { displayedUserId: 'user-b', immediateState: { isGuest: false, nickname: null } })
})

test('a full "first call resolves, then a stale getUser() result for the same session arrives" sequence never flickers', () => {
  // Models: INITIAL_SESSION(user-a) arrives first (hasResolvedInitial flips
  // to true by the caller), then getUser()'s own (now-stale but same-user)
  // result arrives afterwards -- it must be treated as "no change".
  const first = resolveInitialOrNextUserState(false, null, { id: 'user-a' })
  assert.deepEqual(first, { displayedUserId: 'user-a', immediateState: { isGuest: false, nickname: null } })

  const second = resolveInitialOrNextUserState(true, first!.displayedUserId, { id: 'user-a' })
  assert.equal(second, null)
})
