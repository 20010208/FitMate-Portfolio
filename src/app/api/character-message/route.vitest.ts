// Behavioral regression tests for src/app/api/character-message/route.ts's
// POST handler. Same mocking boundaries as the analyze-meal suite; input
// validation, body reading, and error mapping all run for real.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getUserMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}))

const openAiCreateMock = vi.fn()
vi.mock('@/lib/ai/openai-client', () => ({
  getOpenAIClient: vi.fn(() => ({ chat: { completions: { create: openAiCreateMock } } })),
}))

const reserveAiUsageMock = vi.fn()
const releaseAiUsageMock = vi.fn()
vi.mock('@/lib/ai/quota', () => ({
  reserveAiUsage: reserveAiUsageMock,
  releaseAiUsage: releaseAiUsageMock,
}))

const AUTH_USER = { id: 'user-1' }

function authenticated() {
  getUserMock.mockResolvedValue({ data: { user: AUTH_USER } })
}
function unauthenticated() {
  getUserMock.mockResolvedValue({ data: { user: null } })
}
function quotaAllowed() {
  reserveAiUsageMock.mockResolvedValue({ allowed: true, reason: 'ok', retryAfterSeconds: 0, requestId: 'req-1' })
}
function quotaRejected(reason: 'concurrent' | 'minute_limit' | 'day_limit' | 'rpc_error', retryAfterSeconds = 7) {
  reserveAiUsageMock.mockResolvedValue({ allowed: false, reason, retryAfterSeconds, requestId: 'req-1' })
}
function openAiSucceeds(message = 'よし、今日もタンパク質しっかり摂れてるな！') {
  openAiCreateMock.mockResolvedValue({ choices: [{ message: { content: message } }] })
}

const VALID_MEAL_USER_DATA = {
  totalCalories: 1500,
  targetCalories: 2000,
  protein: 80,
  proteinTarget: 120,
  fat: 40,
  fatTarget: 60,
  carbs: 150,
  carbsTarget: 250,
}

const VALID_DASHBOARD_USER_DATA = {
  weight: '70.5',
  goalWeight: '65.0',
  activeDays: 10,
  monthlyIntakeKcal: 45000,
  monthlyTrainingKcal: 8000,
  dailyTargetCalories: 2000,
}

function characterMessageRequest(body: unknown, opts: { raw?: string } = {}): NextRequest {
  return new NextRequest('http://localhost/api/character-message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: opts.raw ?? JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TEST 1 - authentication ordering', () => {
  it('returns 401 AUTH_REQUIRED and never reaches quota/OpenAI when unauthenticated', async () => {
    unauthenticated()
    const { POST } = await import('./route')

    const res = await POST(characterMessageRequest({ characterId: 'leo', page: 'meal', userData: VALID_MEAL_USER_DATA }))

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('AUTH_REQUIRED')
    expect(reserveAiUsageMock).not.toHaveBeenCalled()
    expect(openAiCreateMock).not.toHaveBeenCalled()
    expect(releaseAiUsageMock).not.toHaveBeenCalled()
  })
})

describe('TEST 2 - authenticated success path', () => {
  it('calls OpenAI exactly once with gpt-4o-mini and max_tokens 80, reserves before/releases after, returns message+expression', async () => {
    authenticated()
    quotaAllowed()
    openAiSucceeds()
    const { POST } = await import('./route')

    const res = await POST(characterMessageRequest({ characterId: 'leo', page: 'meal', userData: VALID_MEAL_USER_DATA }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.message).toBe('string')
    expect(body.message.length).toBeGreaterThan(0)
    expect(typeof body.expression).toBe('string')

    expect(openAiCreateMock).toHaveBeenCalledTimes(1)
    const call = openAiCreateMock.mock.calls[0][0]
    expect(call.model).toBe('gpt-4o-mini')
    expect(call.max_tokens).toBe(80)
    // store:false is set per-request on this chat.completions.create() call
    // (not on the OpenAI client constructor - see src/lib/ai/openai-client.ts,
    // which sets no such option), so it must be asserted at this layer.
    expect(call.store).toBe(false)

    expect(reserveAiUsageMock).toHaveBeenCalledTimes(1)
    expect(releaseAiUsageMock).toHaveBeenCalledTimes(1)
    expect(reserveAiUsageMock.mock.invocationCallOrder[0]).toBeLessThan(openAiCreateMock.mock.invocationCallOrder[0])
    expect(openAiCreateMock.mock.invocationCallOrder[0]).toBeLessThan(releaseAiUsageMock.mock.invocationCallOrder[0])
  })

  it('works for the dashboard page shape too', async () => {
    authenticated()
    quotaAllowed()
    openAiSucceeds()
    const { POST } = await import('./route')

    const res = await POST(
      characterMessageRequest({ characterId: 'mina', page: 'dashboard', userData: VALID_DASHBOARD_USER_DATA })
    )
    expect(res.status).toBe(200)
    expect(openAiCreateMock).toHaveBeenCalledTimes(1)
  })
})

describe('TEST 3 - quota rejection (fail closed, zero OpenAI calls)', () => {
  it.each([
    ['concurrent', 429],
    ['minute_limit', 429],
    ['day_limit', 429],
    ['rpc_error', 503],
  ] as const)('%s -> %d, OpenAI never called', async (reason, expectedStatus) => {
    authenticated()
    quotaRejected(reason, 5)
    const { POST } = await import('./route')

    const res = await POST(characterMessageRequest({ characterId: 'saya', page: 'meal', userData: VALID_MEAL_USER_DATA }))
    expect(res.status).toBe(expectedStatus)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })
})

describe('TEST 4 - OpenAI failure + finally/release', () => {
  it('calls OpenAI exactly once, still releases quota, returns a safe upstream error', async () => {
    authenticated()
    quotaAllowed()
    openAiCreateMock.mockRejectedValue(new Error('upstream exploded: sk-should-not-leak'))
    const { POST } = await import('./route')

    const res = await POST(characterMessageRequest({ characterId: 'leo', page: 'meal', userData: VALID_MEAL_USER_DATA }))

    expect(openAiCreateMock).toHaveBeenCalledTimes(1)
    expect(releaseAiUsageMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).not.toContain('sk-should-not-leak')
  })
})

describe('TEST 7 - character-message input validation boundaries (all invalid cases: zero OpenAI calls)', () => {
  it.each(['leo', 'saya', 'mina'] as const)('accepts each valid character id: %s', async (characterId) => {
    authenticated()
    quotaAllowed()
    openAiSucceeds()
    const { POST } = await import('./route')
    const res = await POST(characterMessageRequest({ characterId, page: 'meal', userData: VALID_MEAL_USER_DATA }))
    expect(res.status).toBe(200)
  })

  it('rejects an unknown character id', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(characterMessageRequest({ characterId: 'unknown-character', page: 'meal', userData: VALID_MEAL_USER_DATA }))
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid page value', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(characterMessageRequest({ characterId: 'leo', page: 'not-a-real-page', userData: VALID_MEAL_USER_DATA }))
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a numeric field outside its finite range (e.g. negative totalCalories)', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(
      characterMessageRequest({
        characterId: 'leo',
        page: 'meal',
        userData: { ...VALID_MEAL_USER_DATA, totalCalories: -1 },
      })
    )
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a non-finite numeric field (NaN cannot occur through JSON, but Infinity-like values reach JSON as strings and must not coerce)', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(
      characterMessageRequest({
        characterId: 'leo',
        page: 'meal',
        userData: { ...VALID_MEAL_USER_DATA, totalCalories: 'not-a-number' },
      })
    )
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('rejects userData supplied as an array instead of an object', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(characterMessageRequest({ characterId: 'leo', page: 'meal', userData: [1, 2, 3] }))
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('rejects the whole body supplied as an array', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(characterMessageRequest([{ characterId: 'leo' }]))
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('accepts a well-formatted weight string on the dashboard page (format validation only)', async () => {
    authenticated()
    quotaAllowed()
    openAiSucceeds()
    const { POST } = await import('./route')
    const res = await POST(
      characterMessageRequest({
        characterId: 'mina',
        page: 'dashboard',
        userData: { ...VALID_DASHBOARD_USER_DATA, weight: '999.99' },
      })
    )
    // weight/goalWeight validation is FORMAT validation (matches \d{1,3}(\.\d{1,2})?),
    // not a semantic 1-500 numeric range - a value like 999.99 is well-formatted
    // and must be accepted at this layer, however physically implausible.
    expect(res.status).toBe(200)
  })

  it('rejects a malformed weight string (wrong format, not an out-of-range number)', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(
      characterMessageRequest({
        characterId: 'mina',
        page: 'dashboard',
        userData: { ...VALID_DASHBOARD_USER_DATA, weight: 'seventy kg' },
      })
    )
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a request body over 16 KiB before any validation/OpenAI call', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const raw = JSON.stringify({ characterId: 'leo', page: 'meal', userData: VALID_MEAL_USER_DATA, padding: 'x'.repeat(20 * 1024) })
    const res = await POST(characterMessageRequest(undefined, { raw }))
    expect(res.status).toBe(413)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })
})
