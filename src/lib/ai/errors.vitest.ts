// Behavioral regression tests for src/lib/ai/errors.ts.
// Real import (via the server-only alias); 'openai' is a real, pure
// (network-free at import/instantiation-of-error-classes time) package, so
// classifyOpenAiError can be tested against real OpenAI.APIError instances
// without any network call.
import { describe, it, expect, vi, afterEach } from 'vitest'
import OpenAI from 'openai'
import { aiErrorResponse, classifyOpenAiError, logAiError, type AiErrorCode } from './errors'

describe('aiErrorResponse: stable status-code semantics', () => {
  const cases: Array<[AiErrorCode, number]> = [
    ['INVALID_JSON', 400],
    ['INVALID_INPUT', 400],
    ['AUTH_REQUIRED', 401],
    ['PAYLOAD_TOO_LARGE', 413],
    ['UNSUPPORTED_MEDIA_TYPE', 415],
    ['AI_BUSY', 429],
    ['AI_MINUTE_LIMIT', 429],
    ['AI_DAILY_LIMIT', 429],
    ['AI_RESPONSE_INVALID', 502],
    ['AI_PROVIDER_ERROR', 502],
    ['AI_QUOTA_UNAVAILABLE', 503],
    ['AI_TIMEOUT', 504],
    ['INTERNAL_ERROR', 500],
  ]

  it.each(cases)('%s -> HTTP %d', async (code, expectedStatus) => {
    const res = aiErrorResponse(code)
    expect(res.status).toBe(expectedStatus)
  })

  it('always sets Cache-Control: no-store, regardless of code', async () => {
    for (const [code] of cases) {
      const res = aiErrorResponse(code)
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('sets Retry-After only for 429-class codes when a value is supplied', () => {
    const res = aiErrorResponse('AI_MINUTE_LIMIT', 12)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('12)'.replace(')', '')) // '12'
  })

  it('does not set Retry-After for a non-429 code even if a value is supplied', () => {
    const res = aiErrorResponse('AUTH_REQUIRED', 12)
    expect(res.headers.has('retry-after')).toBe(false)
  })

  it('does not set Retry-After for a 429 code when no value is supplied', () => {
    const res = aiErrorResponse('AI_BUSY')
    expect(res.headers.has('retry-after')).toBe(false)
  })

  it('floors and clamps a fractional/zero Retry-After to at least 1', async () => {
    const res = aiErrorResponse('AI_DAILY_LIMIT', 0.4)
    expect(res.headers.get('retry-after')).toBe('1')
  })

  it('never leaks internal error details in the response body - only a fixed code+message pair', async () => {
    const res = aiErrorResponse('INTERNAL_ERROR')
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(['error', 'message'])
    expect(body.error).toBe('INTERNAL_ERROR')
    expect(typeof body.message).toBe('string')
  })
})

describe('classifyOpenAiError', () => {
  it('classifies a connection-timeout error as AI_TIMEOUT', () => {
    const err = Object.create(OpenAI.APIConnectionTimeoutError.prototype)
    expect(classifyOpenAiError(err)).toBe('AI_TIMEOUT')
  })

  it('classifies a generic OpenAI APIError as AI_PROVIDER_ERROR', () => {
    const err = Object.create(OpenAI.APIError.prototype)
    expect(classifyOpenAiError(err)).toBe('AI_PROVIDER_ERROR')
  })

  it('classifies a completely unrelated thrown value as AI_PROVIDER_ERROR (safe default, never crashes)', () => {
    expect(classifyOpenAiError(new Error('unrelated'))).toBe('AI_PROVIDER_ERROR')
    expect(classifyOpenAiError('a plain string')).toBe('AI_PROVIDER_ERROR')
    expect(classifyOpenAiError(undefined)).toBe('AI_PROVIDER_ERROR')
    expect(classifyOpenAiError(null)).toBe('AI_PROVIDER_ERROR')
  })
})

describe('logAiError: sensitive-data-safe logging', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs only route, error name, and status - never the error message/stack/payload', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sensitive = new Error('user photo bytes: <<<base64-secret-payload>>> token=abc123')
    logAiError('analyze-meal', sensitive)

    expect(spy).toHaveBeenCalledTimes(1)
    const [label, meta] = spy.mock.calls[0]
    expect(label).toBe('ai_route_error')
    expect(meta).toEqual({ route: 'analyze-meal', name: 'Error', status: undefined })

    // The full serialized log call must never contain the sensitive message text.
    const serialized = JSON.stringify(spy.mock.calls[0])
    expect(serialized).not.toContain('base64-secret-payload')
    expect(serialized).not.toContain('token=abc123')
  })

  it('includes the OpenAI APIError status code when present, still without leaking message content', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = Object.create(OpenAI.APIError.prototype)
    Object.assign(err, { name: 'APIError', status: 429, message: 'sk-should-not-appear-in-logs' })
    logAiError('training-calorie', err)

    const [, meta] = spy.mock.calls[0]
    expect(meta).toEqual({ route: 'training-calorie', name: 'APIError', status: 429 })
    expect(JSON.stringify(spy.mock.calls[0])).not.toContain('sk-should-not-appear-in-logs')
  })

  it('handles a non-Error thrown value without crashing and without leaking its content', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => logAiError('character-message', 'raw string throw with secret=xyz')).not.toThrow()
    expect(JSON.stringify(spy.mock.calls[0])).not.toContain('secret=xyz')
  })
})
