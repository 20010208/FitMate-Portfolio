// Behavioral regression tests for src/lib/ai/quota.ts.
// Real import (via the server-only alias). reserveAiUsage/releaseAiUsage
// take the Supabase client as a parameter, so the RPC boundary is mocked
// with a plain fake object - no real Supabase client, no network.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { reserveAiUsage, releaseAiUsage } from './quota'

function fakeSupabase(rpcImpl: (fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }>) {
  return { rpc: vi.fn(rpcImpl) } as unknown as Parameters<typeof reserveAiUsage>[0]
}

describe('reserveAiUsage: allowed', () => {
  it('returns allowed=true, reason="ok" on a valid allowing RPC response, and calls the RPC with the given route + a generated request id', async () => {
    const supabase = fakeSupabase(async () => ({
      data: { allowed: true, reason: 'ok', retry_after_seconds: 0 },
      error: null,
    }))

    const result = await reserveAiUsage(supabase, 'analyze-meal')

    expect(result).toEqual({ allowed: true, reason: 'ok', retryAfterSeconds: 0, requestId: result.requestId })
    expect(typeof result.requestId).toBe('string')
    expect(result.requestId.length).toBeGreaterThan(0)

    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    const [fnName, args] = (supabase.rpc as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(fnName).toBe('reserve_ai_usage')
    expect(args).toEqual({ p_route: 'analyze-meal', p_request_id: result.requestId })
  })
})

describe('reserveAiUsage: rejection reasons (all must yield allowed=false and never throw)', () => {
  const rejectionCases: Array<{
    name: string
    rpcResult: { data: unknown; error: unknown }
    expectedReason: string
    expectedRetryAfter: number
  }> = [
    {
      name: 'concurrent',
      rpcResult: { data: { allowed: false, reason: 'concurrent', retry_after_seconds: 30 }, error: null },
      expectedReason: 'concurrent',
      expectedRetryAfter: 30,
    },
    {
      name: 'minute_limit',
      rpcResult: { data: { allowed: false, reason: 'minute_limit', retry_after_seconds: 45 }, error: null },
      expectedReason: 'minute_limit',
      expectedRetryAfter: 45,
    },
    {
      name: 'day_limit',
      rpcResult: { data: { allowed: false, reason: 'day_limit', retry_after_seconds: 3600 }, error: null },
      expectedReason: 'day_limit',
      expectedRetryAfter: 3600,
    },
  ]

  it.each(rejectionCases)('$name', async ({ rpcResult, expectedReason, expectedRetryAfter }) => {
    const supabase = fakeSupabase(async () => rpcResult)
    const result = await reserveAiUsage(supabase, 'training-calorie')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe(expectedReason)
    expect(result.retryAfterSeconds).toBe(expectedRetryAfter)
  })

  it('rpc_error: an explicit Supabase error object fails closed', async () => {
    const supabase = fakeSupabase(async () => ({ data: null, error: { message: 'db down' } }))
    const result = await reserveAiUsage(supabase, 'character-message')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('rpc_error')
    expect(result.retryAfterSeconds).toBe(5)
  })
})

describe('reserveAiUsage: fails closed on malformed/unrecognized RPC results', () => {
  it('treats a null data payload (no error) as rpc_error, not as allowed', async () => {
    const supabase = fakeSupabase(async () => ({ data: null, error: null }))
    const result = await reserveAiUsage(supabase, 'analyze-meal')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('rpc_error')
  })

  it('treats a response missing required fields as rpc_error', async () => {
    const supabase = fakeSupabase(async () => ({ data: { allowed: true }, error: null }))
    const result = await reserveAiUsage(supabase, 'analyze-meal')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('rpc_error')
  })

  it('treats a response with wrong field types as rpc_error', async () => {
    const supabase = fakeSupabase(async () => ({
      data: { allowed: 'true', reason: 'ok', retry_after_seconds: 'soon' },
      error: null,
    }))
    const result = await reserveAiUsage(supabase, 'analyze-meal')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('rpc_error')
  })

  it('normalizes an unrecognized "reason" string from the RPC to rpc_error, never surfacing an unmapped value', async () => {
    const supabase = fakeSupabase(async () => ({
      data: { allowed: false, reason: 'something_new_and_unmapped', retry_after_seconds: 1 },
      error: null,
    }))
    const result = await reserveAiUsage(supabase, 'analyze-meal')
    expect(result.reason).toBe('rpc_error')
    expect(result.allowed).toBe(false)
  })

  it('never allows a request when allowed=true but reason is not "ok" (defense in depth against a malformed RPC)', async () => {
    const supabase = fakeSupabase(async () => ({
      data: { allowed: true, reason: 'minute_limit', retry_after_seconds: 0 },
      error: null,
    }))
    const result = await reserveAiUsage(supabase, 'analyze-meal')
    expect(result.allowed).toBe(false)
  })

  it('fails closed when the RPC call itself throws (network/driver exception, not a returned {error})', async () => {
    const supabase = fakeSupabase(async () => {
      throw new Error('connection reset')
    })
    const result = await reserveAiUsage(supabase, 'analyze-meal')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('rpc_error')
    expect(result.retryAfterSeconds).toBe(5)
  })

  it('clamps a negative retry_after_seconds to a non-negative value', async () => {
    const supabase = fakeSupabase(async () => ({
      data: { allowed: false, reason: 'minute_limit', retry_after_seconds: -10 },
      error: null,
    }))
    const result = await reserveAiUsage(supabase, 'analyze-meal')
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(0)
  })
})

describe('releaseAiUsage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls release_ai_usage with the given route and request id, and resolves on success', async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }))
    const supabase = { rpc } as unknown as Parameters<typeof releaseAiUsage>[0]

    await expect(releaseAiUsage(supabase, 'analyze-meal', 'req-123')).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('release_ai_usage', { p_route: 'analyze-meal', p_request_id: 'req-123' })
  })

  it('never throws when the RPC returns an error - logs safely instead', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'release failed' } }))
    const supabase = { rpc } as unknown as Parameters<typeof releaseAiUsage>[0]

    await expect(releaseAiUsage(supabase, 'training-calorie', 'req-456')).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledWith('ai_quota_release_failed', { route: 'training-calorie' })
    // Must not leak the underlying error message into the log call.
    expect(JSON.stringify(spy.mock.calls[0])).not.toContain('release failed')
  })

  it('never throws when the RPC call itself throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rpc = vi.fn(async () => {
      throw new Error('connection reset')
    })
    const supabase = { rpc } as unknown as Parameters<typeof releaseAiUsage>[0]

    await expect(releaseAiUsage(supabase, 'character-message', 'req-789')).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledWith('ai_quota_release_failed', { route: 'character-message' })
  })
})
