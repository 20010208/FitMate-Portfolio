// Behavioral regression tests for src/app/api/analyze-meal/route.ts's POST
// handler. Only three module boundaries are mocked: the Supabase server
// client, the OpenAI client, and the quota helper. Everything else (body
// reading/size limits, input validation, error mapping) runs for real, so
// these tests exercise the actual wiring and boundaries, not a re-statement
// of the source.
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
function openAiSucceeds(payload: Record<string, string>) {
  openAiCreateMock.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(payload) } }] })
}

const VALID_RESULT_PAYLOAD = {
  name: '鶏むね肉のサラダ',
  calorie: '450',
  protein: '35.0',
  fat: '12.5',
  carbohydrate: '20.0',
  amount: '350',
}

function fakeJpegBase64(byteLength = 16): string {
  const buf = Buffer.alloc(byteLength, 0)
  buf[0] = 0xff
  buf[1] = 0xd8
  buf[2] = 0xff
  return buf.toString('base64')
}

function analyzeMealRequest(body: unknown, opts: { headers?: Record<string, string>; raw?: string } = {}): Request {
  return new Request('http://localhost/api/analyze-meal', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...opts.headers },
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

    const res = await POST(analyzeMealRequest({ imageBase64: fakeJpegBase64(), mimeType: 'image/jpeg' }))

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('AUTH_REQUIRED')

    expect(reserveAiUsageMock).not.toHaveBeenCalled()
    expect(openAiCreateMock).not.toHaveBeenCalled()
    expect(releaseAiUsageMock).not.toHaveBeenCalled()
  })

  it('a client-supplied fake user id in the body cannot bypass auth (auth.getUser() alone decides)', async () => {
    unauthenticated()
    const { POST } = await import('./route')

    const res = await POST(
      analyzeMealRequest({ imageBase64: fakeJpegBase64(), mimeType: 'image/jpeg', userId: 'admin', user_id: 'admin' })
    )

    expect(res.status).toBe(401)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })
})

describe('TEST 2 - authenticated success path', () => {
  it('calls OpenAI exactly once with gpt-4o-mini and max_tokens 300, reserves quota first, releases after, and returns the parsed result', async () => {
    authenticated()
    quotaAllowed()
    openAiSucceeds(VALID_RESULT_PAYLOAD)
    const { POST } = await import('./route')

    const res = await POST(analyzeMealRequest({ imageBase64: fakeJpegBase64(), mimeType: 'image/jpeg' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(VALID_RESULT_PAYLOAD)

    expect(openAiCreateMock).toHaveBeenCalledTimes(1)
    const call = openAiCreateMock.mock.calls[0][0]
    expect(call.model).toBe('gpt-4o-mini')
    expect(call.max_tokens).toBe(300)
    // store:false is set per-request on this chat.completions.create() call
    // (not on the OpenAI client constructor - see src/lib/ai/openai-client.ts,
    // which sets no such option), so it must be asserted at this layer.
    expect(call.store).toBe(false)

    expect(reserveAiUsageMock).toHaveBeenCalledTimes(1)
    expect(releaseAiUsageMock).toHaveBeenCalledTimes(1)

    const reserveOrder = reserveAiUsageMock.mock.invocationCallOrder[0]
    const openAiOrder = openAiCreateMock.mock.invocationCallOrder[0]
    const releaseOrder = releaseAiUsageMock.mock.invocationCallOrder[0]
    expect(reserveOrder).toBeLessThan(openAiOrder)
    expect(openAiOrder).toBeLessThan(releaseOrder)
  })

  it('response is Cache-Control: no-store', async () => {
    authenticated()
    quotaAllowed()
    openAiSucceeds(VALID_RESULT_PAYLOAD)
    const { POST } = await import('./route')

    const res = await POST(analyzeMealRequest({ imageBase64: fakeJpegBase64(), mimeType: 'image/jpeg' }))
    expect(res.headers.get('cache-control')).toBe('no-store')
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
    quotaRejected(reason, 9)
    const { POST } = await import('./route')

    const res = await POST(analyzeMealRequest({ imageBase64: fakeJpegBase64(), mimeType: 'image/jpeg' }))

    expect(res.status).toBe(expectedStatus)
    expect(openAiCreateMock).not.toHaveBeenCalled()
    if (expectedStatus === 429) {
      expect(res.headers.get('retry-after')).toBe('9')
    }
  })
})

describe('TEST 4 - OpenAI failure + finally/release', () => {
  it('calls OpenAI exactly once, still releases quota, and returns a safe upstream error with no leaked details', async () => {
    authenticated()
    quotaAllowed()
    openAiCreateMock.mockRejectedValue(new Error('upstream exploded: sk-should-not-leak'))
    const { POST } = await import('./route')

    const res = await POST(analyzeMealRequest({ imageBase64: fakeJpegBase64(), mimeType: 'image/jpeg' }))

    expect(openAiCreateMock).toHaveBeenCalledTimes(1)
    expect(releaseAiUsageMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).not.toContain('sk-should-not-leak')
    expect(text).not.toContain('upstream exploded')
  })
})

describe('TEST 6 - analyze-meal input validation boundaries (all invalid cases: zero OpenAI calls)', () => {
  it('accepts a valid JPEG-signature-shaped image with a valid description', async () => {
    authenticated()
    quotaAllowed()
    openAiSucceeds(VALID_RESULT_PAYLOAD)
    const { POST } = await import('./route')

    const res = await POST(
      analyzeMealRequest({ imageBase64: fakeJpegBase64(), mimeType: 'image/jpeg', description: 'ご飯大盛り' })
    )
    expect(res.status).toBe(200)
    expect(openAiCreateMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-image/jpeg mimeType', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(analyzeMealRequest({ imageBase64: fakeJpegBase64(), mimeType: 'image/png' }))
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a data: URI prefix instead of raw base64', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(
      analyzeMealRequest({ imageBase64: `data:image/jpeg;base64,${fakeJpegBase64()}`, mimeType: 'image/jpeg' })
    )
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('rejects base64 containing whitespace', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const withSpace = fakeJpegBase64().slice(0, 4) + ' ' + fakeJpegBase64().slice(4)
    const res = await POST(analyzeMealRequest({ imageBase64: withSpace, mimeType: 'image/jpeg' }))
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('rejects base64 with invalid padding (length not a multiple of 4)', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(analyzeMealRequest({ imageBase64: 'QQ', mimeType: 'image/jpeg' }))
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a decoded image larger than 2 MiB, without ever calling OpenAI', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const oversized = fakeJpegBase64(2 * 1024 * 1024 + 1)
    const res = await POST(analyzeMealRequest({ imageBase64: oversized, mimeType: 'image/jpeg' }))
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('rejects bytes that do not start with the JPEG signature (FF D8 FF) - this is signature-level validation only, not full JPEG decoding', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const notJpeg = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]).toString('base64') // PNG signature
    const res = await POST(analyzeMealRequest({ imageBase64: notJpeg, mimeType: 'image/jpeg' }))
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('accepts a description at exactly the 500 char boundary', async () => {
    authenticated()
    quotaAllowed()
    openAiSucceeds(VALID_RESULT_PAYLOAD)
    const { POST } = await import('./route')
    const res = await POST(
      analyzeMealRequest({ imageBase64: fakeJpegBase64(), mimeType: 'image/jpeg', description: 'a'.repeat(500) })
    )
    expect(res.status).toBe(200)
  })

  it('rejects a description exceeding 500 chars', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const res = await POST(
      analyzeMealRequest({ imageBase64: fakeJpegBase64(), mimeType: 'image/jpeg', description: 'a'.repeat(501) })
    )
    expect(res.status).toBe(400)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a raw request body over 3 MiB before any validation/OpenAI call', async () => {
    authenticated()
    quotaAllowed()
    const { POST } = await import('./route')
    const raw = JSON.stringify({ imageBase64: 'x'.repeat(3 * 1024 * 1024 + 100), mimeType: 'image/jpeg' })
    const res = await POST(analyzeMealRequest(undefined, { raw }))
    expect(res.status).toBe(413)
    expect(openAiCreateMock).not.toHaveBeenCalled()
  })
})
