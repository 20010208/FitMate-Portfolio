import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAIClient } from '@/lib/ai/openai-client'
import { readJsonBody } from '@/lib/ai/request'
import { reserveAiUsage, releaseAiUsage } from '@/lib/ai/quota'
import { aiErrorResponse, classifyOpenAiError, logAiError } from '@/lib/ai/errors'

const ROUTE = 'analyze-meal' as const
const MAX_BODY_BYTES = 3 * 1024 * 1024
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_DESCRIPTION_LENGTH = 500
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

function isValidBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false
  return BASE64_PATTERN.test(value)
}

function isJpegSignature(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
}

type AnalyzeMealInput = {
  imageBuffer: Buffer
  description: string
}

function validateInput(data: unknown): AnalyzeMealInput | null {
  if (!data || typeof data !== 'object') return null
  const v = data as Record<string, unknown>

  if (typeof v.imageBase64 !== 'string') return null
  if (typeof v.mimeType !== 'string' || v.mimeType !== 'image/jpeg') return null
  if (v.imageBase64.startsWith('data:')) return null
  if (!isValidBase64(v.imageBase64)) return null

  let imageBuffer: Buffer
  try {
    imageBuffer = Buffer.from(v.imageBase64, 'base64')
  } catch {
    return null
  }
  if (imageBuffer.length === 0 || imageBuffer.length > MAX_IMAGE_BYTES) return null
  if (!isJpegSignature(imageBuffer)) return null

  let description = ''
  if (v.description !== undefined && v.description !== null) {
    if (typeof v.description !== 'string') return null
    if (v.description.length > MAX_DESCRIPTION_LENGTH) return null
    description = v.description
  }

  return { imageBuffer, description }
}

type AnalyzeMealResult = {
  name: string
  calorie: string
  protein: string
  fat: string
  carbohydrate: string
  amount: string
}

function isFiniteNumericString(value: unknown, min: number, max: number): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= min && n <= max
}

function validateAnalyzeMealResult(data: unknown): AnalyzeMealResult | null {
  if (!data || typeof data !== 'object') return null
  const v = data as Record<string, unknown>

  if (typeof v.name !== 'string' || v.name.trim().length === 0 || v.name.length > 200) return null
  if (!isFiniteNumericString(v.calorie, 0, 9999)) return null
  if (!isFiniteNumericString(v.protein, 0, 2000)) return null
  if (!isFiniteNumericString(v.fat, 0, 2000)) return null
  if (!isFiniteNumericString(v.carbohydrate, 0, 2000)) return null
  if (!isFiniteNumericString(v.amount, 0, 10000)) return null

  return {
    name: v.name,
    calorie: v.calorie as string,
    protein: v.protein as string,
    fat: v.fat as string,
    carbohydrate: v.carbohydrate as string,
    amount: v.amount as string,
  }
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
    const descriptionNote = input.description
      ? `\nユーザーからの補足情報:「${input.description}」← この情報を最優先で量・食品名の判断に使ってください。`
      : ''
    const base64 = input.imageBuffer.toString('base64')

    let response
    try {
      response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'あなたは経験豊富な管理栄養士です。食事の写真から食品の種類・調理方法・目に見える量を正確に把握し、栄養素を推定することが得意です。推定は現実的かつ具体的な数値で行い、範囲ではなく中央値を1つの数値で答えます。',
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64}`,
                  detail: 'auto',
                },
              },
              {
                type: 'text',
                text: `この食事の写真に写っているすべての食品を分析してください。${descriptionNote}

【指示】
- 写真に複数の食品が写っている場合は、すべての合計値を計算してください
- 目に見える量・食器のサイズ・盛り付け・調理方法から現実的な量を推定してください
- 数値は範囲ではなく1つの整数または小数点1桁の値で答えてください

以下のJSON形式のみで返してください（説明・コメント不要）:
{"name":"食品名（日本語・複数ある場合は「A＋B」形式）","calorie":"合計kcal整数値のみ","protein":"合計タンパク質g小数点1桁のみ","fat":"合計脂質g小数点1桁のみ","carbohydrate":"合計炭水化物g小数点1桁のみ","amount":"合計グラム整数値のみ"}`,
              },
            ],
          },
        ],
        max_tokens: 300,
        store: false,
      })
    } catch (openaiError) {
      logAiError(ROUTE, openaiError)
      return aiErrorResponse(classifyOpenAiError(openaiError))
    }

    const raw = response.choices[0]?.message?.content ?? ''
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
    const jsonMatch = cleaned.match(/\{[^{}]*\}/)
    if (!jsonMatch) {
      return aiErrorResponse('AI_RESPONSE_INVALID')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      return aiErrorResponse('AI_RESPONSE_INVALID')
    }

    const result = validateAnalyzeMealResult(parsed)
    if (!result) {
      return aiErrorResponse('AI_RESPONSE_INVALID')
    }

    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    logAiError(ROUTE, error)
    return aiErrorResponse('INTERNAL_ERROR')
  } finally {
    await releaseAiUsage(supabase, ROUTE, quota.requestId)
  }
}
