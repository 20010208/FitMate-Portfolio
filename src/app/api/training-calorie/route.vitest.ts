// Behavioral regression tests for src/app/api/training-calorie/route.ts's
// POST handler. Same mocking boundaries as the other two AI routes; input
// validation, body reading, and error mapping all run for real.
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
function openAiSucceeds(answer = '【使用MET値】8.0（根拠: ランニング）\n【計算式】8.0 × 60kg × 0.5h = 240 kcal\n【消費カロリー推定】235〜245 kcal\n【補足】個人差あり') {
  openAiCreateMock.mockResolvedValue({ choices: [{ message: { content: answer } }] })
}

function trainingCalorieRequest(body: unknown, opts: { raw?: string } = {}): Request {
  return new Request('http://localhost/api/training-calorie', {
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

    const res = await POST(trainingCalorieRequest({ question: 'ランニング30分でどのくらい消費しますか' }))

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('AUTH_REQUIRED')
    expect(reserveAiUsageMock).not.toHaveBeenCalled()
    expect(openAiCreateMock).not.toHaveBeenCalled()
    expect(releaseAiUsageMock).not.toHaveBeenCalled()
  })
})

describe('TEST 2 - authenticated success path', () => {
  it('calls OpenAI exactly once with gpt-4o-mini and max_tokens 600, reserves before/releases after, returns answer', async () => {
    authenticated()
    quotaAllowed()
    openAiSucceeds()
    const { POST } = await import('./route')

    const res = await POST(trainingCalorieRequest({ question: 'ランニング30分でどのくらい消費しますか', bodyWeight: 65 }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.answer).toBe('string')
    expect(body.answer.length).toBeGreaterThan(0)

    expect(openAiCreateMock).toHaveBeenCalledTimes(1)
    const call = openAiCreateMock.mock.calls[0][0]
    expect(call.model).toBe('gpt-4o-mini')
    expect(call.max_tokens).toBe(600)
    // store:false is set per-request on this chat.completions.create() call
    // (not on the OpenAI client constructor - see src/lib/ai/openai-client.ts,
    // which sets no such option), so it must be asserted at this layer.
    expect(call.store).toBe(false)

    expect(reserveAiUsageMock).toHaveBeenCalledTimes(1)
    expect(releaseAiUsageMock).toHaveBeenCalledTimes(1)
    expect(reserveAiUsageMock.mock.invocationCallOrder[0]).toBeLessThan(openAiCreateMock.mock.invocationCallOrder[0])
    expect(openAiCreateMock.mock.invocationCallOrder[0]).toBeLessThan(releaseAiUsageMock.mock.invocationCallOrder[0])
  })

  it('uses the default body weight (60) when bodyWeight is omitted', async () => {
    authenticated()
    quotaAllowed()
    openAiSucceeds()
    const { POST } = await import('./route')

    const res = await POST(trainingCalorieRequest({ question: 'ランニング30分でどのくらい消費しますか' }))
    expect(res.status).toBe(200)
    const call = openAiCreateMock.mock.calls[0][0]
    const systemContent = call.messages[0].content as string
    expect(systemContent).toContain('60kg')
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
    quotaRejected(reason, 3)
    const { POST } = await import('./route')

    const res = await POST(trainingCalorieRequest({ question: 'ランニング30分でどのくらい消費しますか' }))
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

    const res = await POST(trainingCalorieRequest({ question: 'ランニング30分でどのくらい消費しますか' }))

    expect(openAiCreateMock).toHaveBeenCalledTimes(1)
    expect(releaseAiUsageMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).not.toContain('sk-should-not-leak')
  })
})

describe('TEST 8 - training-calorie input validation boundaries (all invalid cases: zero OpenAI calls)', () => {
  it('rejects an empty question', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(trainingCalorieRequest({ question: '' }))
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a whitespace-only question', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(trainingCalorieRequest({ question: '   \n\t  ' }))
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('accepts a question at exactly the 500 char boundary', async () => {
    authenticated()
    quotaAllowed()
    openAiSucceeds()
    const { POST } = await import('./route')
    const res = await POST(trainingCalorieRequest({ question: 'あ'.repeat(500) }))
    expect(res.status).toBe(200)
  })

  it('rejects a question exceeding 500 chars', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(trainingCalorieRequest({ question: 'あ'.repeat(501) }))
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('accepts a valid bodyWeight', async () => {
    authenticated()
    quotaAllowed()
    openAiSucceeds()
    const { POST } = await import('./route')
    const res = await POST(trainingCalorieRequest({ question: '質問', bodyWeight: 75 }))
    expect(res.status).toBe(200)
  })

  it('rejects bodyWeight below 1', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(trainingCalorieRequest({ question: '質問', bodyWeight: 0.5 }))
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('rejects bodyWeight above 500', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(trainingCalorieRequest({ question: '質問', bodyWeight: 501 }))
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a string instead of a number for bodyWeight', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(trainingCalorieRequest({ question: '質問', bodyWeight: '70' }))
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a very large but finite bodyWeight (well above the 500 upper bound)', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(trainingCalorieRequest({ question: '質問', bodyWeight: 1e10 }))
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('treats an explicit null bodyWeight the same as omitted - falls back to the default (not a validation error)', async () => {
    authenticated()
    quotaAllowed()
    openAiSucceeds()
    const { POST } = await import('./route')
    const res = await POST(trainingCalorieRequest({ question: '質問', bodyWeight: null }))
    expect(res.status).toBe(200)
    const call = openAiCreateMock.mock.calls[0][0]
    expect((call.messages[0].content as string)).toContain('60kg')
  })

  it('rejects a request body over 8 KiB before any validation/OpenAI call', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const raw = JSON.stringify({ question: 'x'.repeat(10 * 1024) })
    const res = await POST(trainingCalorieRequest(undefined, { raw }))
    expect(res.status).toBe(413)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })
})
