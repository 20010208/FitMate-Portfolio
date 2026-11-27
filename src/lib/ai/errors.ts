import 'server-only'
import { NextResponse } from 'next/server'
import OpenAI from 'openai'

export type AiErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_INPUT'
  | 'AUTH_REQUIRED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'AI_BUSY'
  | 'AI_MINUTE_LIMIT'
  | 'AI_DAILY_LIMIT'
  | 'AI_RESPONSE_INVALID'
  | 'AI_PROVIDER_ERROR'
  | 'AI_QUOTA_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'INTERNAL_ERROR'

const STATUS: Record<AiErrorCode, number> = {
  INVALID_JSON: 400,
  INVALID_INPUT: 400,
  AUTH_REQUIRED: 401,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  AI_BUSY: 429,
  AI_MINUTE_LIMIT: 429,
  AI_DAILY_LIMIT: 429,
  AI_RESPONSE_INVALID: 502,
  AI_PROVIDER_ERROR: 502,
  AI_QUOTA_UNAVAILABLE: 503,
  AI_TIMEOUT: 504,
  INTERNAL_ERROR: 500,
}

const MESSAGE: Record<AiErrorCode, string> = {
  INVALID_JSON: 'リクエストの形式が不正です',
  INVALID_INPUT: '入力内容を確認してください',
  AUTH_REQUIRED: 'ログインが必要です',
  PAYLOAD_TOO_LARGE: 'データサイズが大きすぎます',
  UNSUPPORTED_MEDIA_TYPE: '対応していない形式です',
  AI_BUSY: '別のAI処理が実行中です。しばらくお待ちください',
  AI_MINUTE_LIMIT: 'リクエストが多すぎます。少し待って再試行してください',
  AI_DAILY_LIMIT: '本日のAI利用上限に達しました',
  AI_RESPONSE_INVALID: 'AI機能が一時的に利用できません',
  AI_PROVIDER_ERROR: 'AI機能が一時的に利用できません',
  AI_QUOTA_UNAVAILABLE: 'AI機能が一時的に利用できません',
  AI_TIMEOUT: 'AI機能が一時的に利用できません',
  INTERNAL_ERROR: 'エラーが発生しました',
}

export function aiErrorResponse(code: AiErrorCode, retryAfterSeconds?: number): NextResponse {
  const status = STATUS[code]
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  if (status === 429 && typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds)) {
    headers.set('Retry-After', String(Math.max(1, Math.floor(retryAfterSeconds))))
  }
  return NextResponse.json({ error: code, message: MESSAGE[code] }, { status, headers })
}

// server-side only metadata log: route name, error name/status. Never the
// request body, image, prompt, or AI response text.
export function logAiError(route: string, error: unknown): void {
  const name = error instanceof Error ? error.name : typeof error
  const status = error instanceof OpenAI.APIError ? error.status : undefined
  console.error('ai_route_error', { route, name, status })
}

export function classifyOpenAiError(error: unknown): AiErrorCode {
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return 'AI_TIMEOUT'
  }
  if (error instanceof OpenAI.APIError) {
    return 'AI_PROVIDER_ERROR'
  }
  return 'AI_PROVIDER_ERROR'
}
