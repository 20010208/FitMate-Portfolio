// Client-safe (no 'server-only') helper shared by the AI feature components
// to turn a failed /api/analyze-meal, /api/character-message or
// /api/training-calorie response into a short, fixed Japanese message.

export type AiClientErrorInfo = {
  message: string
  retryAfterSeconds: number | null
}

const STATUS_MESSAGE: Record<number, string> = {
  401: 'ログインが必要です',
  413: 'データサイズが大きすぎます',
  415: '対応していない画像形式です',
}

const CODE_MESSAGE: Record<string, string> = {
  AI_BUSY: '別のAI処理が実行中です。しばらくお待ちください',
  AI_MINUTE_LIMIT: 'リクエストが多すぎます。少し待って再試行してください',
  AI_DAILY_LIMIT: '本日のAI利用上限に達しました',
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const n = Number(header)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function describeAiResponseError(res: Response, bodyErrorCode?: string): AiClientErrorInfo {
  const retryAfterSeconds = parseRetryAfter(res.headers.get('Retry-After'))

  if (res.status === 429) {
    const message = (bodyErrorCode && CODE_MESSAGE[bodyErrorCode]) || CODE_MESSAGE.AI_BUSY
    return { message, retryAfterSeconds }
  }
  if (STATUS_MESSAGE[res.status]) {
    return { message: STATUS_MESSAGE[res.status], retryAfterSeconds }
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return { message: 'AI機能が一時的に利用できません', retryAfterSeconds }
  }
  return { message: 'エラーが発生しました', retryAfterSeconds }
}
