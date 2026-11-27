import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export type AiRoute = 'analyze-meal' | 'character-message' | 'training-calorie'

export type QuotaReason =
  | 'ok'
  | 'unauthorized'
  | 'invalid_route'
  | 'invalid_request'
  | 'concurrent'
  | 'minute_limit'
  | 'day_limit'
  | 'rpc_error'

export type QuotaResult = {
  allowed: boolean
  reason: QuotaReason
  retryAfterSeconds: number
  requestId: string
}

const KNOWN_REASONS = new Set<QuotaReason>([
  'ok',
  'unauthorized',
  'invalid_route',
  'invalid_request',
  'concurrent',
  'minute_limit',
  'day_limit',
  'rpc_error',
])

type ReserveRpcResponse = {
  allowed: boolean
  reason: string
  retry_after_seconds: number
}

function isReserveRpcResponse(value: unknown): value is ReserveRpcResponse {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.allowed === 'boolean' &&
    typeof v.reason === 'string' &&
    typeof v.retry_after_seconds === 'number' &&
    Number.isFinite(v.retry_after_seconds)
  )
}

// Reserves one unit of AI quota for the caller (identified server-side via
// auth.uid() inside the RPC, never a client-supplied id). Fails closed: any
// RPC/network error is treated as "not allowed" so OpenAI is never called.
export async function reserveAiUsage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  route: AiRoute
): Promise<QuotaResult> {
  const requestId = crypto.randomUUID()

  try {
    const { data, error } = await supabase.rpc('reserve_ai_usage', {
      p_route: route,
      p_request_id: requestId,
    })

    if (error || !isReserveRpcResponse(data)) {
      return { allowed: false, reason: 'rpc_error', retryAfterSeconds: 5, requestId }
    }

    const reason: QuotaReason = KNOWN_REASONS.has(data.reason as QuotaReason)
      ? (data.reason as QuotaReason)
      : 'rpc_error'
    const retryAfterSeconds = Math.max(0, Math.floor(data.retry_after_seconds))

    return {
      allowed: data.allowed === true && reason === 'ok',
      reason,
      retryAfterSeconds,
      requestId,
    }
  } catch {
    return { allowed: false, reason: 'rpc_error', retryAfterSeconds: 5, requestId }
  }
}

// Releases the concurrency reservation. Never refunds minute/day counts.
// Failures are logged with minimal, non-sensitive metadata only and never
// thrown, so they cannot override an already-computed successful response.
export async function releaseAiUsage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  route: AiRoute,
  requestId: string
): Promise<void> {
  try {
    const { error } = await supabase.rpc('release_ai_usage', {
      p_route: route,
      p_request_id: requestId,
    })
    if (error) {
      console.error('ai_quota_release_failed', { route })
    }
  } catch {
    console.error('ai_quota_release_failed', { route })
  }
}
