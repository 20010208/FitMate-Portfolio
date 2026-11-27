import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AuthApiError, AuthRetryableFetchError, AuthWeakPasswordError } from '@supabase/supabase-js'
import { getAuthErrorMessageKey, type AuthErrorMessageKey } from './getAuthErrorMessage.ts'

// These tests exercise a pure function only. No Supabase client is created
// and no network call is made anywhere in this file. Auth error instances
// are constructed directly from the installed SDK's own error classes so
// the mapped codes are guaranteed to match what the SDK actually produces.

const ALL_KEYS: readonly AuthErrorMessageKey[] = [
  'authErrorWeakPassword',
  'authErrorInvalidCredentials',
  'authErrorEmailNotConfirmed',
  'authErrorUserExists',
  'authErrorRateLimit',
  'authErrorSignupDisabled',
  'authErrorNetwork',
  'authErrorSignupGeneric',
  'authErrorLoginGeneric',
]

// --- confirmed SDK error codes ---------------------------------------------

test('weak_password (AuthWeakPasswordError) maps to authErrorWeakPassword', () => {
  const error = new AuthWeakPasswordError('Password is too weak', 400, ['pwned'])
  assert.equal(getAuthErrorMessageKey(error, 'signup'), 'authErrorWeakPassword')
  assert.equal(getAuthErrorMessageKey(error, 'login'), 'authErrorWeakPassword')
})

test('invalid_credentials maps to authErrorInvalidCredentials', () => {
  const error = new AuthApiError('Invalid login credentials', 400, 'invalid_credentials')
  assert.equal(getAuthErrorMessageKey(error, 'login'), 'authErrorInvalidCredentials')
})

test('email_not_confirmed maps to authErrorEmailNotConfirmed', () => {
  const error = new AuthApiError('Email not confirmed', 400, 'email_not_confirmed')
  assert.equal(getAuthErrorMessageKey(error, 'login'), 'authErrorEmailNotConfirmed')
})

test('user_already_exists maps to authErrorUserExists', () => {
  const error = new AuthApiError('User already registered', 422, 'user_already_exists')
  assert.equal(getAuthErrorMessageKey(error, 'signup'), 'authErrorUserExists')
})

test('over_request_rate_limit maps to authErrorRateLimit', () => {
  const error = new AuthApiError('Request rate limit reached', 429, 'over_request_rate_limit')
  assert.equal(getAuthErrorMessageKey(error, 'login'), 'authErrorRateLimit')
})

test('over_email_send_rate_limit maps to authErrorRateLimit', () => {
  const error = new AuthApiError('Email rate limit exceeded', 429, 'over_email_send_rate_limit')
  assert.equal(getAuthErrorMessageKey(error, 'signup'), 'authErrorRateLimit')
})

test('signup_disabled maps to authErrorSignupDisabled', () => {
  const error = new AuthApiError('Signups not allowed for this instance', 422, 'signup_disabled')
  assert.equal(getAuthErrorMessageKey(error, 'signup'), 'authErrorSignupDisabled')
})

test('AuthRetryableFetchError (network) maps to authErrorNetwork', () => {
  const error = new AuthRetryableFetchError('fetch failed', 0)
  assert.equal(getAuthErrorMessageKey(error, 'signup'), 'authErrorNetwork')
  assert.equal(getAuthErrorMessageKey(error, 'login'), 'authErrorNetwork')
})

// --- context-specific fallback for unmapped/unknown errors ------------------

test('unrecognized auth error code falls back to context-specific generic (signup)', () => {
  const error = new AuthApiError('Some future server-side error', 400, 'some_future_code')
  assert.equal(getAuthErrorMessageKey(error, 'signup'), 'authErrorSignupGeneric')
})

test('unrecognized auth error code falls back to context-specific generic (login)', () => {
  const error = new AuthApiError('Some future server-side error', 400, 'some_future_code')
  assert.equal(getAuthErrorMessageKey(error, 'login'), 'authErrorLoginGeneric')
})

test('null falls back to context-specific generic', () => {
  assert.equal(getAuthErrorMessageKey(null, 'signup'), 'authErrorSignupGeneric')
  assert.equal(getAuthErrorMessageKey(null, 'login'), 'authErrorLoginGeneric')
})

test('undefined falls back to context-specific generic', () => {
  assert.equal(getAuthErrorMessageKey(undefined, 'signup'), 'authErrorSignupGeneric')
  assert.equal(getAuthErrorMessageKey(undefined, 'login'), 'authErrorLoginGeneric')
})

test('a plain string falls back to context-specific generic', () => {
  assert.equal(getAuthErrorMessageKey('network error: could not connect', 'signup'), 'authErrorSignupGeneric')
})

test('a plain object (not an AuthError instance) falls back to context-specific generic', () => {
  assert.equal(getAuthErrorMessageKey({ code: 'weak_password', message: 'looks like an auth error but is not' }, 'login'), 'authErrorLoginGeneric')
})

test('a regular Error instance falls back to context-specific generic', () => {
  assert.equal(getAuthErrorMessageKey(new Error('boom'), 'signup'), 'authErrorSignupGeneric')
})

// --- safety: no raw message, no stack trace, no mutation --------------------

test('returned value is always one of the known translation keys, never the raw message', () => {
  const error = new AuthApiError('Invalid login credentials', 400, 'invalid_credentials')
  const key = getAuthErrorMessageKey(error, 'login')
  assert.ok(ALL_KEYS.includes(key))
  assert.notEqual(key, error.message)
  assert.match(key, /^authError[A-Za-z]+$/)
})

test('returned value never contains a stack trace', () => {
  const error = new AuthApiError('Invalid login credentials', 400, 'invalid_credentials')
  const key = getAuthErrorMessageKey(error, 'login')
  assert.equal(key.includes('\n'), false)
  assert.equal(key.includes('at '), false)
  assert.notEqual(key, error.stack)
})

test('does not mutate the input error object', () => {
  const error = new AuthApiError('Invalid login credentials', 400, 'invalid_credentials')
  const before = { name: error.name, message: error.message, status: error.status, code: error.code }
  getAuthErrorMessageKey(error, 'login')
  assert.deepEqual({ name: error.name, message: error.message, status: error.status, code: error.code }, before)
})

test('does not mutate a plain object input', () => {
  const input = { code: 'weak_password', message: 'looks like an auth error but is not' }
  const before = { ...input }
  getAuthErrorMessageKey(input, 'signup')
  assert.deepEqual(input, before)
})

// --- regression: Object.prototype-shaped error codes must not leak inherited
// properties as if they were mapped values (Codex finding on cc66008) -------

const PROTOTYPE_COLLISION_CODES = ['constructor', 'toString', '__proto__'] as const

for (const code of PROTOTYPE_COLLISION_CODES) {
  test(`code '${code}' (own-property collision with Object.prototype) does not throw and falls back per context`, () => {
    const error = new AuthApiError(`Unexpected code: ${code}`, 400, code)

    const signupResult = getAuthErrorMessageKey(error, 'signup')
    assert.equal(signupResult, 'authErrorSignupGeneric')
    assert.equal(typeof signupResult, 'string')
    assert.ok(ALL_KEYS.includes(signupResult))
    assert.notEqual(signupResult, error.message)

    const loginResult = getAuthErrorMessageKey(error, 'login')
    assert.equal(loginResult, 'authErrorLoginGeneric')
    assert.equal(typeof loginResult, 'string')
    assert.ok(ALL_KEYS.includes(loginResult))
    assert.notEqual(loginResult, error.message)
  })
}
