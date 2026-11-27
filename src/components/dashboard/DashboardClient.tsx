'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Calendar from '@/components/dashboard/Calendar'
import CalorieVisual from '@/components/dashboard/CalorieVisual'
import CalorieSetupModal from '@/components/dashboard/CalorieSetupModal'
import GoalAchievedModal from '@/components/dashboard/GoalAchievedModal'
import CharacterSelectModal from '@/components/character/CharacterSelectModal'
import CharacterSidebar from '@/components/character/CharacterSidebar'
import { useT, getLocale } from '@/lib/i18n'
import { Profile } from '@/types'
import { CharacterId, ExpressionId, getExpressionFromContext } from '@/lib/characters'
import { createClient } from '@/lib/supabase/client'
import { makeDateId, parseDateId, parseDateOnly, calendarDayDifference } from '@/lib/dashboardDateId'

type Props = {
  trainedDates: string[]
  mealDates?: string[]
  weightRecords: Record<string, string>
  isGuest: boolean
  profile?: Profile | null
  monthlyIntakeKcal?: number
  monthlyMealDays?: number
  monthlyTrainingKcal?: number
  todayMealCategories?: string[]
  // サーバーが単一のDateインスタンスから算出した「今日」(YYYYMMDD)。必須props
  // にしており、client側でnew Date()へfallbackすることはない。selectedDate・
  // todayDateId・月次計算の対象月は、マウント後もこの値に固定し続ける（clientの
  // ローカル日付へ自動的に補正しない）。これにより、SSRとclient初回renderの
  // タイムゾーン差によるhydration mismatchだけでなく、月境界をまたいだ場合に
  // 表示月とサーバー取得データの対象月がずれる問題も防ぐ。
  initialDateId: string
  // 上と同じDateインスタンスから生成したtoISOString()。「現在時刻」（時間帯に
  // 応じたキャラクター表情など）が必要な計算だけがここから導出する。
  initialNowIso: string
}

// referenceDateを引数で受け取る純粋関数。呼び出し側（DashboardClient）が
// サーバーから渡された単一snapshotを渡すことで、SSRとclient初回renderで
// 独立にnew Date()を呼んで異なる結果になることを防ぐ。birthdayは
// "YYYY-MM-DD"のdate-only文字列のため、new Date(birthday)ではなく
// parseDateOnly()でローカル日付として解析する(new Date('YYYY-MM-DD')は
// UTC日付として解釈されるため、負のUTC offset環境では前日として扱われ
// うる)。
function calcAge(birthday: string, referenceDate: Date): number {
  const birth = parseDateOnly(birthday)
  let age = referenceDate.getFullYear() - birth.getFullYear()
  const m = referenceDate.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && referenceDate.getDate() < birth.getDate())) age--
  return Math.max(0, age)
}

function calcBMR(weight: number, heightCm: number, age: number, gender: 'male' | 'female'): number {
  const base = 10 * weight + 6.25 * heightCm - 5 * age
  return Math.round(gender === 'male' ? base + 5 : base - 161)
}

// 有酸素METs（種目別）
// react-hooks/exhaustive-deps対策でmodule scopeへ移動（Phase 2B）:
// これらはコンポーネント本体内のconstだと毎render新しいobject参照になり、
// 選択日付トレーニングカロリー計算effectの依存配列に含めた場合、effect自身の
// setTrainingCalories呼び出しによる再renderのたびにeffectが再実行され、
// Supabaseへの'trainings'クエリが無制限に増える恐れがあった。値・キー・型は
// 完全に不変のため、module scopeの安定した参照へ移すことでlintを解消しつつ
// クエリ発火条件（[selectedDate, isGuest, weightRecords]のみ）を一切変えない。
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

export default function DashboardClient({ trainedDates, mealDates = [], weightRecords, isGuest, profile, monthlyIntakeKcal = 0, monthlyMealDays = 0, monthlyTrainingKcal = 0, todayMealCategories = [], initialDateId, initialNowIso }: Props) {
  const t = useT()
  const locale = getLocale()
  const dateLocale = locale === 'ja' ? 'ja-JP' : 'en-US'
  const router = useRouter()

  // サーバーsnapshotをそのまま「今日」として使い続ける（mount後もclientの
  // ローカル日付へ自動補正しない）。理由は月境界対策: もしここでclientの
  // ローカル日付へ切り替えると、既にサーバーから取得済みのtrainedDates／
  // weightRecords等（サーバー時点の月を対象に取得済み）と、表示上の「今月」が
  // 月をまたいだ瞬間にずれてしまう。真に必要なのは「初回表示とサーバー取得
  // データの一貫性」であり、「利用者の real-time ローカル日付」ではない。
  const todayDateId = initialDateId
  // todayDateIdをローカル日付として表すDate。calcAgeの基準日や、記録日数の
  // 差分計算など、「カレンダー日付同士の比較」はすべてこれを使う
  // （parseDateId自体はrenderのたびに呼んでも副作用のない純粋関数だが、
  // 同一インスタンスを使い回すためuseMemo化する）。
  const referenceDate = useMemo(() => parseDateId(todayDateId), [todayDateId])
  // 「現在時刻」（時間帯に応じたキャラクター表情など）が必要な箇所だけがここから
  // 読む。render中に独自でnew Date()を呼ばない。
  const initialNow = useMemo(() => new Date(initialNowIso), [initialNowIso])

  const [selectedDate, setSelectedDate] = useState(() => parseDateId(initialDateId))
  const [steps, setSteps] = useState('')
  const [setupDismissed, setSetupDismissed] = useState(false)
  const [goalModalDismissed, setGoalModalDismissed] = useState(false)
  const [character, setCharacter] = useState<CharacterId | null>(profile?.character ?? null)

  const characterExpression = useMemo((): ExpressionId => {
    const trainedToday = trainedDates.includes(todayDateId) ? 1 : 0
    const todayEntryCount = trainedToday + todayMealCategories.length

    const allEntryDates = [...trainedDates, ...mealDates]
    let daysSinceLastEntry = 999
    if (allEntryDates.length > 0) {
      const latestStr = allEntryDates.reduce((max, d) => d > max ? d : max, '0')
      const latestDate = parseDateId(latestStr)
      // ローカルmidnight同士のgetTime()差を86,400,000で割る方式は、DSTの開始・
      // 終了をまたぐtimezoneでは暦日数と食い違う(例: DST開始をまたぐと7暦日が
      // 167時間になり、Math.floorで6日と誤算出されうる)。年月日成分だけを使う
      // calendarDayDifference()で暦日差を算出することでこれを避ける。
      daysSinceLastEntry = calendarDayDifference(latestDate, referenceDate)
    }

    return getExpressionFromContext({
      // サーバーとclientでローカルタイムゾーンが異なっても同じ値になるよう、
      // UTC時を使う（initialNowIsoは絶対時刻のため、getHours()等のローカル
      // accessorだとサーバー/client間で読み取り結果が変わり得る）。
      currentHour: initialNow.getUTCHours(),
      todayEntryCount,
      daysSinceLastEntry,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character])
  const [mealCalories, setMealCalories] = useState(0)
  const [trainingCalories, setTrainingCalories] = useState(0)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // カレンダーで日付が変わったら URL に反映（ナビリンクが日付を引き継げるように）
  useEffect(() => {
    const dateId = makeDateId(selectedDate)
    router.replace(dateId === todayDateId ? '/dashboard' : `/dashboard?date=${dateId}`, { scroll: false })
  }, [selectedDate, router, todayDateId])

  // 日付が変わったら歩数をリセットし、保存済みの歩数を読み込む
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSteps('')
    setSaveStatus('idle')
    if (isGuest) return
    const supabase = createClient()
    supabase
      .from('step_logs')
      .select('steps')
      .eq('date_id', makeDateId(selectedDate))
      .single()
      .then(({ data }) => {
        if (data?.steps != null) setSteps(data.steps.toString())
      })
  }, [selectedDate, isGuest])

  const handleStepsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '')
    setSteps(value)
    if (isGuest) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSaveStatus('saving')
    saveTimerRef.current = setTimeout(async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('step_logs').upsert({
        user_id: user.id,
        date_id: makeDateId(selectedDate),
        steps: parseInt(value) || 0,
      }, { onConflict: 'user_id,date_id' })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    }, 700)
  }

  // 選択日付のトレーニングカロリーを計算
  useEffect(() => {
    if (isGuest) return
    const supabase = createClient()
    const todayW = weightRecords[makeDateId(new Date())] ?? ''
    const latestW = todayW || (Object.entries(weightRecords).sort((a, b) => b[0].localeCompare(a[0]))[0]?.[1] ?? '')
    const bw = parseFloat(latestW) || 60
    supabase
      .from('trainings')
      .select('category, exercise, sets')
      .eq('date_id', makeDateId(selectedDate))
      .then(({ data }) => {
        let total = 0
        for (const tr of data ?? []) {
          if (tr.category === 'AI推定') {
            for (const s of tr.sets ?? []) {
              if (s.reps === 'ai_kcal') total += parseFloat(s.weight) || 0
            }
          } else if (tr.category === '有酸素' || tr.category === 'Cardio') {
            const met = CARDIO_METS[tr.exercise] ?? 6
            for (const s of tr.sets ?? []) {
              total += met * bw * ((parseFloat(s.weight) || 0) / 60)
            }
          } else {
            const met = STRENGTH_METS[tr.category] ?? 4
            const coeff = VOLUME_COEFF[tr.category] ?? 0.08
            for (const s of tr.sets ?? []) {
              const liftedKg = parseFloat(s.weight) || 0
              const reps = parseInt(s.reps) || 0
              total += liftedKg * reps * coeff + met * bw * ((reps * 3.5 + 90) / 3600)
            }
          }
        }
        setTrainingCalories(Math.round(total))
      })
  }, [selectedDate, isGuest, weightRecords])

  // 選択日付が変わるたびに食事カロリーを再取得（ローカル日付を使用）
  useEffect(() => {
    if (isGuest) return
    const supabase = createClient()
    const dateId = makeDateId(selectedDate)
    supabase
      .from('meal_logs')
      .select('items')
      .eq('date_id', dateId)
      .then(({ data }) => {
        let total = 0
        for (const log of data ?? []) {
          for (const item of log.items ?? []) {
            total += parseFloat(item.calorie) || 0
          }
        }
        setMealCalories(Math.round(total))
      })
  }, [selectedDate, isGuest])

  const showSetupModal = !isGuest && !setupDismissed && (!profile?.gender || !profile?.target_date || profile?.fitness_goal === null)
  const trainedSet = new Set(trainedDates)
  const mealSet = new Set(mealDates)

  const selectedDateId = makeDateId(selectedDate)
  const selectedWeight = weightRecords[selectedDateId] ?? ''

  const todayWeight = weightRecords[todayDateId] ?? ''

  // 今日の記録がなければ過去の最新記録を使用
  const latestWeight = todayWeight || (
    Object.entries(weightRecords)
      .sort((a, b) => b[0].localeCompare(a[0]))[0]?.[1] ?? ''
  )

  // todayDateId("YYYYMMDD")の先頭6文字がそのまま"YYYYMM"になる
  const currentMonthPrefix = todayDateId.slice(0, 6)
  const activeDays = trainedDates.filter((d) => d.startsWith(currentMonthPrefix)).length

  const selectedDateStr = selectedDate.toLocaleDateString(dateLocale, {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  const weight = parseFloat(latestWeight) || 60
  const stepsNum = parseInt(steps) || 0
  const stepCalories = Math.round(stepsNum * weight * 0.0005)
  const caloriesBurned = stepCalories + trainingCalories

  // 目標日までの残り日数（負の値 = 目標日が過ぎた）。ローカルmidnight同士の
  // getTime()差ではなく、年月日成分だけを使うcalendarDayDifference()で算出する
  // (DSTの開始・終了をまたぐtimezoneでは1日が23時間/25時間になり、
  // ローカルmidnight差÷86,400,000だとカレンダー上の日数と食い違うため)。
  const rawDaysLeft = profile?.target_date
    ? calendarDayDifference(referenceDate, parseDateOnly(profile.target_date))
    : null
  const daysLeft = rawDaysLeft !== null ? Math.max(0, rawDaysLeft) : null
  const showGoalAchievedModal = !isGuest && !goalModalDismissed && rawDaysLeft !== null && rawDaysLeft < 0

  // BMR calculation
  const bmr = (() => {
    if (profile?.gender && profile?.birthday && profile?.height) {
      const heightNum = parseFloat(profile.height)
      if (heightNum > 0) return calcBMR(weight, heightNum, calcAge(profile.birthday, referenceDate), profile.gender)
    }
    return null
  })()

  // BMR & target calorie calculation
  let targetCalories = 0
  if (bmr !== null && profile?.goal_weight && profile?.target_date && daysLeft !== null && daysLeft > 0) {
    const goalWeightNum = parseFloat(profile.goal_weight)
    const tdee = Math.round(bmr * 1.3)
    const dailyDeficit = Math.round((weight - goalWeightNum) * 7700 / daysLeft)
    targetCalories = Math.max(1200, tdee - dailyDeficit)
  }

  // 体重進捗（最古の記録→目標体重への達成率）
  const sortedWeightEntries = Object.entries(weightRecords).sort((a, b) => a[0].localeCompare(b[0]))
  const startWeightNum = parseFloat(sortedWeightEntries[0]?.[1] ?? '') || null
  const currentWeightNum = parseFloat(latestWeight) || null
  const goalWeightNum = parseFloat(profile?.goal_weight ?? '') || null
  const weightProgress: number | null =
    startWeightNum && currentWeightNum && goalWeightNum && Math.abs(startWeightNum - goalWeightNum) > 0.1
      ? Math.min(100, Math.max(0, (Math.abs(startWeightNum - currentWeightNum) / Math.abs(startWeightNum - goalWeightNum)) * 100))
      : null

  const actions = [
    { href: `/training?date=${selectedDateId}`, icon: '🏋️', label: t('addTrainingAction'), desc: t('addTrainingDesc') },
    { href: `/meal?date=${selectedDateId}`, icon: '🥗', label: t('addMealAction'), desc: t('addMealDesc') },
    { href: `/weight?date=${selectedDateId}`, icon: '⚖️', label: t('addWeightAction'), desc: t('addWeightDesc') },
    { href: '/profile', icon: '📏', label: t('settings'), desc: t('settingsDesc') },
  ]

  return (
    <div className="flex gap-6">
      {/* キャラクターサイドバー（PC: aside自体がsticky追従） */}
      {!isGuest && character && (
        <aside className="hidden lg:block w-52 flex-shrink-0 self-start sticky top-24">
          <CharacterSidebar
            characterId={character}
            expression={characterExpression}
            aiContext={{
              weight: latestWeight,
              goalWeight: profile?.goal_weight ?? undefined,
              activeDays,
              monthlyIntakeKcal,
              monthlyTrainingKcal,
              dailyTargetCalories: targetCalories > 0 ? targetCalories : undefined,
            }}
          />
        </aside>
      )}

      <div className="flex-1 min-w-0 space-y-6">
      {/* キャラ未選択モーダル */}
      {!isGuest && !character && (
        <CharacterSelectModal onSelect={(id) => setCharacter(id)} />
      )}
      {showSetupModal && (
        <CalorieSetupModal onDismiss={() => setSetupDismissed(true)} />
      )}
      {showGoalAchievedModal && (
        <GoalAchievedModal onDismiss={() => setGoalModalDismissed(true)} />
      )}
      {/* Guest banner */}
      {isGuest && (
        <div
          className="rounded-2xl px-5 py-3 flex items-center justify-between"
          style={{ backgroundColor: 'var(--accent-light)', border: '1px solid var(--accent)' }}
        >
          <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
            🔒 {t('guestBanner')}
          </p>
          <Link href="/signup" className="text-xs font-black px-3 py-1 rounded-lg text-white" style={{ backgroundColor: 'var(--primary)' }}>
            {t('freeSignup')}
          </Link>
        </div>
      )}

      {/* Top grid: Calendar + Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar */}
        <div className="lg:col-span-2 rounded-2xl p-5 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
          <Calendar selectedDate={selectedDate} onDateSelect={setSelectedDate} trainedDates={trainedSet} mealDates={mealSet} todayDateId={todayDateId} />
          {/* スマホ用キャラカード（カレンダー直下） */}
          {!isGuest && character && (
            <div className="lg:hidden mt-4">
              <CharacterSidebar
                characterId={character}
                expression={characterExpression}
                mobile
                aiContext={{
                  weight: latestWeight,
                  goalWeight: profile?.goal_weight ?? undefined,
                  activeDays,
                  monthlyIntakeKcal,
                  monthlyTrainingKcal,
                  dailyTargetCalories: targetCalories > 0 ? targetCalories : undefined,
                }}
              />
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="flex flex-col gap-4">
          {/* Monthly Active */}
          <div className="rounded-2xl p-5 shadow-sm flex items-center gap-4" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
            <div className="w-14 h-14 rounded-full flex flex-col items-center justify-center shrink-0" style={{ backgroundColor: 'var(--accent-light)' }}>
              <span className="text-xl font-black" style={{ color: 'var(--accent)' }}>{activeDays}</span>
            </div>
            <div>
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{t('monthlyActive')}</p>
              <p className="font-black text-lg" style={{ color: 'var(--text)' }}>{activeDays} {t('days')}</p>
            </div>
          </div>

          {/* Weight card — links to /weight with selected date */}
          <Link href={`/weight?date=${selectedDateId}`}>
            <div className="rounded-2xl p-5 shadow-sm hover:opacity-90 transition" style={{ backgroundColor: 'var(--primary)' }}>
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                  <span className="text-lg font-black text-white">{selectedWeight || '--'}</span>
                </div>
                <div>
                  <p className="text-xs font-bold text-white/80">
                    {selectedDate.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })}
                  </p>
                  <p className="font-black text-lg text-white">
                    {selectedWeight ? `${selectedWeight} kg` : t('tapToRecord')}
                  </p>
                  {selectedWeight && (
                    <p className="text-xs text-white/60 mt-0.5">{t('tapToChange')}</p>
                  )}
                </div>
              </div>
            </div>
          </Link>

          {/* Selected date info */}
          <div className="rounded-2xl p-4 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-bold mb-1" style={{ color: 'var(--text-muted)' }}>{t('recordingFor')}</p>
            <p className="font-bold text-sm" style={{ color: 'var(--text)' }}>{selectedDateStr}</p>
          </div>

          {/* Days left to goal + 体重進捗円グラフ */}
          {daysLeft !== null && (
            <div className="rounded-2xl p-4 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3">
                {/* 円グラフ */}
                {weightProgress !== null && (() => {
                  const r = 22
                  const circ = 2 * Math.PI * r
                  const offset = circ * (1 - weightProgress / 100)
                  const done = weightProgress >= 100
                  const color = done ? '#22c55e' : 'var(--primary)'
                  return (
                    <svg width={56} height={56} viewBox="0 0 56 56" className="flex-shrink-0">
                      <circle cx={28} cy={28} r={r} fill="none" stroke="var(--border)" strokeWidth={5} />
                      <circle
                        cx={28} cy={28} r={r}
                        fill="none" stroke={color} strokeWidth={5}
                        strokeDasharray={circ} strokeDashoffset={offset}
                        strokeLinecap="round"
                        transform="rotate(-90 28 28)"
                      />
                      <text x={28} y={33} textAnchor="middle" fontSize={11} fontWeight="bold" fill={color}>
                        {Math.round(weightProgress)}%
                      </text>
                    </svg>
                  )
                })()}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>目標まで</p>
                  {daysLeft > 0 ? (
                    <p className="font-black text-lg leading-tight" style={{ color: 'var(--primary)' }}>
                      あと <span className="text-2xl">{daysLeft}</span> 日
                    </p>
                  ) : (
                    <p className="font-black text-lg" style={{ color: '#ef4444' }}>目標日到来！</p>
                  )}
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {parseDateOnly(profile!.target_date!).toLocaleDateString(dateLocale, { month: 'long', day: 'numeric' })}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Calorie Balance Visual */}
      {!isGuest && (
        <CalorieVisual
          intakeKcal={mealCalories}
          targetKcal={targetCalories}
          burnedKcal={caloriesBurned}
          bmr={bmr}
        />
      )}

      {/* 今月のカロリー収支 */}
      {!isGuest && bmr !== null && monthlyIntakeKcal > 0 && (() => {
        const tdee = Math.round(bmr * 1.3)
        const recordedDays = monthlyMealDays > 0 ? monthlyMealDays : 1
        const daysInMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate()
        const monthlyMaintenance = tdee * recordedDays
        // 収支 = 摂取 − (維持カロリー + トレーニング消費)
        const monthlyExpenditure = monthlyMaintenance + monthlyTrainingKcal
        const balance = monthlyIntakeKcal - monthlyExpenditure
        const fatKg = balance / 7500
        const isDeficit = balance < 0
        const projectedBalance = (balance / recordedDays) * daysInMonth
        const projectedFatKg = projectedBalance / 7500
        return (
          <div className="rounded-2xl p-5 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
            <h2 className="font-black mb-1" style={{ color: 'var(--text)' }}>📊 今月のカロリー収支</h2>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
              維持 {tdee.toLocaleString()} kcal × 記録{recordedDays}日
              {monthlyTrainingKcal > 0 && ` + 運動 ${monthlyTrainingKcal.toLocaleString()} kcal`}
              {' '}= 消費 {monthlyExpenditure.toLocaleString()} kcal
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--bg)' }}>
                <p className="text-xs font-bold mb-1" style={{ color: 'var(--text-muted)' }}>今月の摂取</p>
                <p className="text-lg font-black" style={{ color: 'var(--text)' }}>{monthlyIntakeKcal.toLocaleString()}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>kcal</p>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--bg)' }}>
                <p className="text-xs font-bold mb-1" style={{ color: 'var(--text-muted)' }}>収支</p>
                <p className="text-lg font-black" style={{ color: isDeficit ? '#3B82F6' : '#EF4444' }}>
                  {isDeficit ? '' : '+'}{Math.round(balance).toLocaleString()}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>kcal</p>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--bg)' }}>
                <p className="text-xs font-bold mb-1" style={{ color: 'var(--text-muted)' }}>脂肪換算</p>
                <p className="text-lg font-black" style={{ color: isDeficit ? '#3B82F6' : '#EF4444' }}>
                  {isDeficit ? '' : '+'}{fatKg.toFixed(2)}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>kg</p>
              </div>
            </div>
            <p className="text-xs mt-3 text-center" style={{ color: 'var(--text-muted)' }}>
              このペースで月末まで続くと脂肪 {isDeficit ? '約' : '+'}{projectedFatKg.toFixed(2)}kg {isDeficit ? '減少' : '増加'}の見込み
            </p>
          </div>
        )
      })()}

      {/* Steps & Calorie Calculator */}
      <div className="rounded-2xl p-5 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
        <h2 className="font-black mb-1" style={{ color: 'var(--text)' }}>🚶 {t('stepsCalorie')}</h2>
        <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
          {latestWeight
            ? `${latestWeight}kg ${t('weightCalcNote')}${!todayWeight ? (locale === 'ja' ? '（直近の記録）' : ' (latest record)') : ''}`
            : t('weightNotRecorded')}
        </p>
        <div className="flex gap-3 items-center">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{t('stepsToday')}</label>
              {saveStatus === 'saving' && (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>保存中...</span>
              )}
              {saveStatus === 'saved' && (
                <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>✓ 保存</span>
              )}
            </div>
            <input
              type="text"
              inputMode="numeric"
              placeholder={t('stepsPlaceholder')}
              value={steps}
              onChange={handleStepsChange}
              className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
            />
          </div>
          <div className="rounded-xl px-4 py-3 text-center shrink-0" style={{ backgroundColor: 'var(--accent-light)' }}>
            <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{t('caloriesBurned')}</p>
            <p className="text-2xl font-black" style={{ color: 'var(--primary)' }}>{stepsNum > 0 ? stepCalories.toLocaleString() : '--'}</p>
            <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>kcal</p>
          </div>
          <div className="rounded-xl px-4 py-3 text-center shrink-0" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>基礎代謝</p>
            <p className="text-2xl font-black" style={{ color: 'var(--text)' }}>{bmr ?? '--'}</p>
            <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>kcal</p>
          </div>
        </div>
        {stepsNum > 0 && (
          <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            {stepsNum.toLocaleString()} {t('steps')} × {weight}kg × 0.0005 = {stepCalories.toLocaleString()} kcal
          </p>
        )}
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-sm font-black mb-3 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('quickActions')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {actions.map((a) => (
            <Link key={a.href} href={a.href}>
              <div className="rounded-2xl p-4 shadow-sm hover:shadow-md transition cursor-pointer" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
                <div className="text-3xl mb-2">{a.icon}</div>
                <p className="font-black text-sm" style={{ color: 'var(--text)' }}>{a.label}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{a.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
      </div>
    </div>
  )
}
