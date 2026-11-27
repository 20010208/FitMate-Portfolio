import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAIClient } from '@/lib/ai/openai-client'
import { readJsonBody } from '@/lib/ai/request'
import { reserveAiUsage, releaseAiUsage } from '@/lib/ai/quota'
import { aiErrorResponse, classifyOpenAiError, logAiError } from '@/lib/ai/errors'
import { CHARACTERS, CharacterId, ExpressionId } from '@/lib/characters'

const ROUTE = 'character-message' as const
const MAX_BODY_BYTES = 16 * 1024
const MAX_MESSAGE_LENGTH = 300
const WEIGHT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/

const BASE_PROMPTS: Record<CharacterId, string> = {
  leo: `あなたはFitMateの熱血トレーナー「レオ」です。
29歳・身長183cm・体重85kgの筋肉質な男性。一人称は「俺」。
専門：筋肥大・筋力向上。
性格：熱い・面倒見が良い・努力至上主義・嘘をつかない。
話し方：「だ」「ぞ」「だろ」「しろ」口調。根性論だけでなく科学的アドバイスをする。
【必須制約】返答は必ず60文字以内の日本語1〜2文のみ。余分な説明は一切不要。`,

  saya: `あなたはFitMateのボディメイクコーチ「サヤ」です。
26歳・身長168cm。一人称は「私」。専門：ダイエット・習慣化。
性格：明るい・優しい・共感力高い。「よ」「ね」「だよ」口調。
体重増加で煽らない・罪悪感を植え付けない。
【必須制約】返答は必ず60文字以内の日本語1〜2文のみ。余分な説明は一切不要。`,

  mina: `あなたはFitMateの栄養アドバイザー「ミナ」です。
31歳・身長163cm・管理栄養士。一人称は「私」。専門：栄養・食事設計・PFC。
性格：知的・冷静・ロジカル。「です」「ます」「ですね」口調。数字ベースで話す。
【必須制約】返答は必ず60文字以内の日本語1〜2文のみ。余分な説明は一切不要。`,
}

type MealUserData = {
  totalCalories: number
  targetCalories: number
  protein: number
  proteinTarget: number
  fat: number
  fatTarget: number
  carbs: number
  carbsTarget: number
  weight?: string
}

type DashboardUserData = {
  weight?: string
  goalWeight?: string
  activeDays?: number
  monthlyIntakeKcal?: number
  monthlyTrainingKcal?: number
  dailyTargetCalories?: number
}

function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

// Returns undefined when absent (ok), the string when valid, or null when
// present but invalid. Callers must treat null as a validation failure.
function validateWeightString(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return null
  if (!WEIGHT_PATTERN.test(value)) return null
  return value
}

function validateMealUserData(data: unknown): MealUserData | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const v = data as Record<string, unknown>

  if (!isFiniteNumberInRange(v.totalCalories, 0, 20000)) return null
  if (!isFiniteNumberInRange(v.targetCalories, 0, 20000)) return null
  if (!isFiniteNumberInRange(v.protein, 0, 2000)) return null
  if (!isFiniteNumberInRange(v.proteinTarget, 0, 2000)) return null
  if (!isFiniteNumberInRange(v.fat, 0, 2000)) return null
  if (!isFiniteNumberInRange(v.fatTarget, 0, 2000)) return null
  if (!isFiniteNumberInRange(v.carbs, 0, 3000)) return null
  if (!isFiniteNumberInRange(v.carbsTarget, 0, 3000)) return null

  const weight = validateWeightString(v.weight)
  if (weight === null) return null

  return {
    totalCalories: v.totalCalories as number,
    targetCalories: v.targetCalories as number,
    protein: v.protein as number,
    proteinTarget: v.proteinTarget as number,
    fat: v.fat as number,
    fatTarget: v.fatTarget as number,
    carbs: v.carbs as number,
    carbsTarget: v.carbsTarget as number,
    weight,
  }
}

function validateDashboardUserData(data: unknown): DashboardUserData | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const v = data as Record<string, unknown>

  const weight = validateWeightString(v.weight)
  if (weight === null) return null
  const goalWeight = validateWeightString(v.goalWeight)
  if (goalWeight === null) return null

  if (v.activeDays !== undefined && !isFiniteNumberInRange(v.activeDays, 0, 31)) return null
  if (v.monthlyIntakeKcal !== undefined && !isFiniteNumberInRange(v.monthlyIntakeKcal, 0, 500000)) return null
  if (v.monthlyTrainingKcal !== undefined && !isFiniteNumberInRange(v.monthlyTrainingKcal, 0, 500000)) return null
  if (v.dailyTargetCalories !== undefined && !isFiniteNumberInRange(v.dailyTargetCalories, 0, 20000)) return null

  return {
    weight,
    goalWeight,
    activeDays: v.activeDays as number | undefined,
    monthlyIntakeKcal: v.monthlyIntakeKcal as number | undefined,
    monthlyTrainingKcal: v.monthlyTrainingKcal as number | undefined,
    dailyTargetCalories: v.dailyTargetCalories as number | undefined,
  }
}

type CharacterMessageInput =
  | { characterId: CharacterId; page: 'meal'; userData: MealUserData }
  | { characterId: CharacterId; page: 'dashboard'; userData: DashboardUserData }

function validateInput(data: unknown): CharacterMessageInput | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const v = data as Record<string, unknown>

  if (typeof v.characterId !== 'string' || !Object.prototype.hasOwnProperty.call(CHARACTERS, v.characterId)) {
    return null
  }
  const characterId = v.characterId as CharacterId

  if (v.page === 'meal') {
    const userData = validateMealUserData(v.userData)
    if (!userData) return null
    return { characterId, page: 'meal', userData }
  }

  if (v.page === 'dashboard') {
    const userData = validateDashboardUserData(v.userData)
    if (!userData) return null
    return { characterId, page: 'dashboard', userData }
  }

  return null
}

function buildMealContext(userData: MealUserData, characterId: CharacterId): string {
  const calDiff = userData.totalCalories - userData.targetCalories
  const proteinLeft = Math.max(0, userData.proteinTarget - userData.protein)

  let ctx = `【今日の食事データ】
- 摂取カロリー: ${userData.totalCalories}kcal / 目標: ${userData.targetCalories}kcal（${calDiff >= 0 ? '+' : ''}${Math.round(calDiff)}kcal）
- タンパク質: ${userData.protein}g / 目標: ${userData.proteinTarget}g（残り${Math.round(proteinLeft)}g）
- 脂質: ${userData.fat}g / 目標: ${userData.fatTarget}g
- 炭水化物: ${userData.carbs}g / 目標: ${userData.carbsTarget}g`

  if (userData.weight) ctx += `\n- 体重: ${userData.weight}kg`

  if (characterId === 'leo') {
    ctx += '\n\n上記データを見て、筋肥大・筋力向上の観点から2〜3文の熱いアドバイスを送ってください。タンパク質に重点を置いてください。'
  } else if (characterId === 'saya') {
    ctx += '\n\n上記データを見て、ボディメイク・ダイエットの観点から2〜3文の優しいアドバイスを送ってください。否定しないで寄り添ってください。'
  } else {
    ctx += '\n\n上記データを見て、管理栄養士として具体的な数字を使った2〜3文のアドバイスを送ってください。'
  }
  return ctx
}

function buildDashboardContext(userData: DashboardUserData, characterId: CharacterId): string {
  const wNum = parseFloat(userData.weight ?? '')
  const gwNum = parseFloat(userData.goalWeight ?? '')
  const diff = !isNaN(wNum) && !isNaN(gwNum) ? +(wNum - gwNum).toFixed(1) : null

  let ctx = `【ユーザーの状況】
- 現在体重: ${userData.weight ? `${userData.weight}kg` : '未記録'}
- 目標体重: ${userData.goalWeight ? `${userData.goalWeight}kg` : '未設定'}${diff !== null ? `（目標まで${diff > 0 ? `あと${diff}kg` : `達成済み！`}）` : ''}
- 1日の目標カロリー: ${userData.dailyTargetCalories ? `${userData.dailyTargetCalories}kcal` : '未設定'}
- 今月のトレーニング日数: ${userData.activeDays ?? 0}日
- 今月の摂取カロリー合計: ${userData.monthlyIntakeKcal ?? 0}kcal
- 今月の消費カロリー合計: ${userData.monthlyTrainingKcal ?? 0}kcal`

  if (characterId === 'leo') {
    ctx += '\n\n上記データを見て、筋トレ・体づくりの観点から2〜3文の熱い一言を送ってください。'
  } else if (characterId === 'saya') {
    ctx += '\n\n上記データを見て、ダイエット・習慣化の観点から2〜3文の寄り添うメッセージを送ってください。'
  } else {
    ctx += '\n\n上記データを見て、栄養・健康管理の観点から2〜3文のアドバイスを送ってください。'
  }
  return ctx
}

function determineExpression(page: 'meal' | 'dashboard', userData: MealUserData | DashboardUserData): ExpressionId {
  if (page === 'meal') {
    const d = userData as MealUserData
    if (d.totalCalories === 0) return 'normal'
    const calRatio = d.targetCalories > 0 ? d.totalCalories / d.targetCalories : 1
    const proteinRatio = d.proteinTarget > 0 ? d.protein / d.proteinTarget : 0
    if (calRatio > 1.2) return 'angry'
    if (proteinRatio >= 0.9 && calRatio >= 0.85 && calRatio <= 1.1) return 'happy'
    if (proteinRatio >= 0.7 && calRatio >= 0.7) return 'fun'
    if (calRatio < 0.4) return 'sad'
    return 'normal'
  } else {
    const d = userData as DashboardUserData
    const days = d.activeDays ?? 0
    const wNum = parseFloat(d.weight ?? '')
    const gwNum = parseFloat(d.goalWeight ?? '')
    const diff = !isNaN(wNum) && !isNaN(gwNum) ? wNum - gwNum : null
    if (days === 0) return 'angry'
    if (days >= 20) return 'fun'
    if (days >= 12) return 'happy'
    if (diff !== null && diff <= 0) return 'happy'
    if (days < 4) return 'sad'
    return 'normal'
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return aiErrorResponse('AUTH_REQUIRED')
  }

  const bodyResult = await readJsonBody(req, MAX_BODY_BYTES)
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
    const systemPrompt = BASE_PROMPTS[input.characterId]
    const userContext =
      input.page === 'meal'
        ? buildMealContext(input.userData, input.characterId)
        : buildDashboardContext(input.userData, input.characterId)

    let completion
    try {
      completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContext },
        ],
        max_tokens: 80,
        temperature: 0.85,
        store: false,
      })
    } catch (openaiError) {
      logAiError(ROUTE, openaiError)
      return aiErrorResponse(classifyOpenAiError(openaiError))
    }

    const message = completion.choices[0]?.message?.content?.trim() ?? ''
    if (message.length === 0 || message.length > MAX_MESSAGE_LENGTH) {
      return aiErrorResponse('AI_RESPONSE_INVALID')
    }

    const expression = determineExpression(input.page, input.userData)
    return NextResponse.json({ message, expression }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    logAiError(ROUTE, error)
    return aiErrorResponse('INTERNAL_ERROR')
  } finally {
    await releaseAiUsage(supabase, ROUTE, quota.requestId)
  }
}
