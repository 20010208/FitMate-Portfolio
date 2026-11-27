import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAIClient } from '@/lib/ai/openai-client'
import { readJsonBody } from '@/lib/ai/request'
import { reserveAiUsage, releaseAiUsage } from '@/lib/ai/quota'
import { aiErrorResponse, classifyOpenAiError, logAiError } from '@/lib/ai/errors'

const ROUTE = 'training-calorie' as const
const MAX_BODY_BYTES = 8 * 1024
const MAX_QUESTION_LENGTH = 500
const MAX_ANSWER_LENGTH = 4000
const DEFAULT_BODY_WEIGHT = 60

type TrainingCalorieInput = {
  question: string
  bodyWeight: number
}

function validateInput(data: unknown): TrainingCalorieInput | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const v = data as Record<string, unknown>

  if (typeof v.question !== 'string') return null
  const question = v.question.trim()
  if (question.length < 1 || question.length > MAX_QUESTION_LENGTH) return null

  let bodyWeight = DEFAULT_BODY_WEIGHT
  if (v.bodyWeight !== undefined && v.bodyWeight !== null) {
    if (typeof v.bodyWeight !== 'number' || !Number.isFinite(v.bodyWeight) || v.bodyWeight < 1 || v.bodyWeight > 500) {
      return null
    }
    bodyWeight = v.bodyWeight
  }

  return { question, bodyWeight }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return aiErrorResponse('AUTH_REQUIRED')
  }

  const bodyResult = await readJsonBody(request, MAX_BODY_BYTES)
  if (!bodyResult.ok) {
    if (bodyResult.code === 'PAYLOAD_TOO_LARGE') return aiErrorResponse('PAYLOAD_TOO_LARGE')
    if (bodyResult.code === 'UNSUPPORTED_MEDIA_TYPE') return aiErrorResponse('UNSUPPORTED_MEDIA_TYPE')
    return aiErrorResponse('INVALID_JSON')
  }

  const input = validateInput(bodyResult.data)
  if (!input) {
    return aiErrorResponse('INVALID_INPUT')
  }

  const quota = await reserveAiUsage(supabase, ROUTE)
  if (!quota.allowed) {
    if (quota.reason === 'concurrent') return aiErrorResponse('AI_BUSY', quota.retryAfterSeconds)
    if (quota.reason === 'minute_limit') return aiErrorResponse('AI_MINUTE_LIMIT', quota.retryAfterSeconds)
    if (quota.reason === 'day_limit') return aiErrorResponse('AI_DAILY_LIMIT', quota.retryAfterSeconds)
    return aiErrorResponse('AI_QUOTA_UNAVAILABLE')
  }

  try {
    const openai = getOpenAIClient()
    const { question, bodyWeight } = input

    let response
    try {
      response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `あなたは運動生理学・スポーツ科学の第一線で活躍するスペシャリストです。
METsを用いた消費カロリー計算を専門とし、複合的な運動セッションの正確な分析が得意です。

ユーザーの現在の体重: ${bodyWeight}kg

【計算方針】
- 消費kcal = MET値 × ${bodyWeight}kg × 時間(h)
- 詳細に複数の活動が含まれる場合は、必ず活動ごとに分けて個別計算し、最後に合計すること
- 時間が「15-20分」のような範囲の場合は中央値（17.5分）を使用すること
- 強度の記述がある場合はMET値に正確に反映すること（例: 軽い=低MET、激しい=高MET）
- MET値は「身体活動のメッツ表（国立健康・栄養研究所）」に準拠すること

【回答フォーマット】
複数活動がある場合:
① 活動名（時間）: MET x.x × ${bodyWeight}kg × h = xxx kcal
② 活動名（時間）: MET x.x × ${bodyWeight}kg × h = xxx kcal
...
【合計】xxx kcal
【消費カロリー推定】xxx〜xxx kcal
【補足】個人差や強度変動による注意点を1文で

単一活動の場合:
【使用MET値】x.x（根拠: ○○）
【計算式】x.x × ${bodyWeight}kg × xh = xxx kcal
【消費カロリー推定】xxx〜xxx kcal
【補足】1文で

回答は日本語のみ。余計な前置きは不要。`,
          },
          {
            role: 'user',
            content: question,
          },
        ],
        max_tokens: 600,
        temperature: 0,
        store: false,
      })
    } catch (openaiError) {
      logAiError(ROUTE, openaiError)
      return aiErrorResponse(classifyOpenAiError(openaiError))
    }

    const answer = (response.choices[0]?.message?.content ?? '').trim()
    if (answer.length === 0 || answer.length > MAX_ANSWER_LENGTH) {
      return aiErrorResponse('AI_RESPONSE_INVALID')
    }

    return NextResponse.json({ answer }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    logAiError(ROUTE, error)
    return aiErrorResponse('INTERNAL_ERROR')
  } finally {
    await releaseAiUsage(supabase, ROUTE, quota.requestId)
  }
}
