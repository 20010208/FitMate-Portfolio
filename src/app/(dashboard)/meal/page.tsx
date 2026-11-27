import type { Metadata } from 'next'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import MealClient from '@/components/meal/MealClient'
import LocalDateRedirect from '@/components/ui/LocalDateRedirect'
import { NO_INDEX_METADATA } from '@/lib/seo/noIndexMetadata'

export const dynamic = 'force-dynamic'

// react-hooks/purity: Date.now() is an impure call and is not allowed
// directly in a Server Component's render body. Wrapping it with React's
// cache() memoizes the result per request (Next.js gives each request its
// own cache scope), so every call within this render returns the exact
// same timestamp -- satisfying purity while still reflecting real
// request-time, not a stale/hard-coded value. Must stay module-scope (not
// re-created inside the component) so the memoization actually applies.
const getServerNow = cache(() => Date.now())

export const metadata: Metadata = {
  title: '食事記録・PFCバランス | FitMate',
  description: '食事のカロリーとPFC（タンパク質・脂質・炭水化物）バランスを記録。AI写真解析で食品を自動認識。',
  ...NO_INDEX_METADATA,
}

export default async function MealPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const { date } = await searchParams
  if (!date) return <LocalDateRedirect basePath="/meal" />

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const dateId = date

  if (!user) {
    return <MealClient key={dateId} dateId={dateId} initialMealLogs={[]} isGuest goalWeight={null} />
  }

  const [{ data: mealLogs }, { data: profile }, { data: latestWeight }] = await Promise.all([
    supabase.from('meal_logs').select('*').eq('user_id', user.id).eq('date_id', dateId),
    supabase.from('profiles').select('goal_weight, character, gender, birthday, height, target_date, fitness_goal').eq('user_id', user.id).single(),
    supabase.from('weight_records').select('weight').eq('user_id', user.id).order('date_id', { ascending: false }).limit(1).single(),
  ])

  const bodyWeight = latestWeight?.weight ?? profile?.goal_weight ?? null

  // BMRベースの1日目標カロリーを計算（ダッシュボードと同じロジック）
  let targetCalories: number | undefined
  if (profile?.gender && profile?.birthday && profile?.height && profile?.goal_weight && profile?.target_date) {
    const now = getServerNow()
    const heightNum = parseFloat(profile.height)
    const bw = parseFloat(latestWeight?.weight ?? '') || parseFloat(profile.goal_weight) || 60
    const birthday = new Date(profile.birthday)
    const age = Math.max(0, Math.floor((now - birthday.getTime()) / (365.25 * 24 * 60 * 60 * 1000)))
    if (heightNum > 0 && age > 0) {
      const base = 10 * bw + 6.25 * heightNum - 5 * age
      const bmr = Math.round(profile.gender === 'male' ? base + 5 : base - 161)
      const tdee = Math.round(bmr * 1.3)
      const goalWeightNum = parseFloat(profile.goal_weight)
      const daysLeft = Math.max(1, Math.ceil((new Date(profile.target_date).getTime() - now) / (24 * 60 * 60 * 1000)))
      const dailyDeficit = Math.round((bw - goalWeightNum) * 7700 / daysLeft)
      targetCalories = Math.max(1200, tdee - dailyDeficit)
    }
  }

  return <MealClient key={dateId} dateId={dateId} initialMealLogs={mealLogs ?? []} isGuest={false} goalWeight={bodyWeight} characterId={(profile?.character ?? null) as 'leo' | 'saya' | 'mina' | null} targetCalories={targetCalories} fitnessGoal={(profile?.fitness_goal ?? null) as 'lose_weight' | 'maintain' | 'gain_muscle' | null} />
}
