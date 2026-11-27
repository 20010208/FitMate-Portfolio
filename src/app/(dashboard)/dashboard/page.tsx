import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import DashboardClient from '@/components/dashboard/DashboardClient'
import { NO_INDEX_METADATA } from '@/lib/seo/noIndexMetadata'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  ...NO_INDEX_METADATA,
}

const CARDIO_METS: Record<string, number> = {
  'ランニング': 8, 'Running': 8,
  'サイクリング': 6, 'Cycling': 6,
  '水泳': 7, 'Swimming': 7,
  '縄跳び': 10, 'Jump Rope': 10,
  'HIIT': 8,
  'ダンス': 5, 'Dance': 5,
}

const STRENGTH_METS: Record<string, number> = {
  '脚': 6, 'Legs': 6,
  '背中': 5, 'Back': 5,
  '胸': 4.5, 'Chest': 4.5,
  '肩': 4, 'Shoulder': 4,
  '腹筋': 3.5, 'Abs': 3.5,
  '腕': 3, 'Arms': 3,
}

const VOLUME_COEFF: Record<string, number> = {
  '脚': 0.15, 'Legs': 0.15,
  '背中': 0.12, 'Back': 0.12,
  '胸': 0.10, 'Chest': 0.10,
  '肩': 0.07, 'Shoulder': 0.07,
  '腹筋': 0.05, 'Abs': 0.05,
  '腕': 0.04, 'Arms': 0.04,
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // サーバーでの「今回のrequestにおける現在日時」を単一のDateインスタンスから
  // 一度だけ算出し、initialDateId・initialNowIsoの両方をDashboardClientへ渡す。
  // client側で改めてnew Date()を呼ぶと、サーバー(UTC)とブラウザのタイムゾーン差
  // により初回renderの日付・時刻・キャラクター表情等が食い違い、React hydration
  // error #418の原因になる。両方とも同じ`now`インスタンスから作ることで、
  // 「今日」と「今の時刻」がずれることも防ぐ。
  const now = new Date()
  const monthPrefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const todayDateId = `${monthPrefix}${String(now.getDate()).padStart(2, '0')}`
  const initialNowIso = now.toISOString()

  if (!user) {
    return <DashboardClient trainedDates={[]} weightRecords={{}} isGuest initialDateId={todayDateId} initialNowIso={initialNowIso} />
  }

  const [trainingsRes, weightsRes, profileRes, mealRes, monthlyMealRes, monthlyTrainingsRes, monthlyStepsRes, todayMealCatRes] = await Promise.all([
    supabase.from('trainings').select('date_id').eq('user_id', user.id),
    supabase.from('weight_records').select('date_id, weight').eq('user_id', user.id),
    supabase.from('profiles').select('*').eq('user_id', user.id).single(),
    supabase.from('meal_logs').select('date_id').eq('user_id', user.id),
    supabase.from('meal_logs').select('date_id, items').eq('user_id', user.id).gte('date_id', `${monthPrefix}01`).lte('date_id', `${monthPrefix}31`),
    supabase.from('trainings').select('category, exercise, sets').eq('user_id', user.id).gte('date_id', `${monthPrefix}01`).lte('date_id', `${monthPrefix}31`),
    supabase.from('step_logs').select('steps').eq('user_id', user.id).gte('date_id', `${monthPrefix}01`).lte('date_id', `${monthPrefix}31`),
    supabase.from('meal_logs').select('category').eq('user_id', user.id).eq('date_id', todayDateId),
  ])

  const trainedDates = new Set((trainingsRes.data ?? []).map((t) => t.date_id))
  const mealDates = [...new Set((mealRes.data ?? []).map((m) => m.date_id))]

  const weightRecords: Record<string, string> = {}
  for (const w of weightsRes.data ?? []) {
    weightRecords[w.date_id] = w.weight
  }

  // 今月の摂取カロリー集計
  type MealItem = { calorie?: string | number }
  const monthlyMealLogs = monthlyMealRes.data ?? []
  const monthlyMealDays = new Set(monthlyMealLogs.map((l) => l.date_id)).size
  const monthlyIntakeKcal = Math.round(
    monthlyMealLogs.reduce((total, log) => {
      return total + ((log.items ?? []) as MealItem[]).reduce((sum, item) => sum + (parseFloat(String(item.calorie ?? 0)) || 0), 0)
    }, 0)
  )

  // 今月のトレーニング消費カロリー（MET計算）
  const latestWeight = [...(weightsRes.data ?? [])].sort((a, b) => b.date_id.localeCompare(a.date_id))[0]?.weight
  const bw = parseFloat(latestWeight ?? '60') || 60

  type TrainingSet = { weight?: string; reps?: string }
  let monthlyTrainingKcal = 0
  for (const tr of monthlyTrainingsRes.data ?? []) {
    const isAiEstimated = tr.category === 'AI推定'
    const isCardio = tr.category === '有酸素' || tr.category === 'Cardio'
    if (isAiEstimated) {
      // AI推定レコードはweightにkcalが直接入っている
      for (const s of (tr.sets ?? []) as TrainingSet[]) {
        if (s.reps === 'ai_kcal') monthlyTrainingKcal += parseFloat(s.weight ?? '0') || 0
      }
    } else if (isCardio) {
      const met = CARDIO_METS[tr.exercise] ?? 6
      for (const s of (tr.sets ?? []) as TrainingSet[]) {
        const minutes = parseFloat(s.weight ?? '0') || 0
        monthlyTrainingKcal += met * bw * (minutes / 60)
      }
    } else {
      const met = STRENGTH_METS[tr.category] ?? 4
      const coeff = VOLUME_COEFF[tr.category] ?? 0.08
      for (const s of (tr.sets ?? []) as TrainingSet[]) {
        const liftedKg = parseFloat(s.weight ?? '0') || 0
        const reps = parseInt(s.reps ?? '0') || 0
        const volumeKcal = liftedKg * reps * coeff
        const durationKcal = met * bw * ((reps * 3.5 + 90) / 3600)
        monthlyTrainingKcal += volumeKcal + durationKcal
      }
    }
  }
  monthlyTrainingKcal = Math.round(monthlyTrainingKcal)

  // 今月の歩数消費カロリー（歩数 × 体重 × 0.0005）
  const monthlyStepKcal = Math.round(
    (monthlyStepsRes.data ?? []).reduce((sum, row) => sum + (parseInt(row.steps ?? '0') || 0), 0) * bw * 0.0005
  )

  const todayMealCategories = (todayMealCatRes.data ?? []).map((r) => r.category as string)

  return (
    <DashboardClient
      trainedDates={Array.from(trainedDates)}
      mealDates={mealDates}
      weightRecords={weightRecords}
      isGuest={false}
      profile={profileRes.data ?? null}
      monthlyIntakeKcal={monthlyIntakeKcal}
      monthlyMealDays={monthlyMealDays}
      monthlyTrainingKcal={monthlyTrainingKcal + monthlyStepKcal}
      todayMealCategories={todayMealCategories}
      initialDateId={todayDateId}
      initialNowIso={initialNowIso}
    />
  )
}
