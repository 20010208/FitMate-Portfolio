import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import TrainingClient from '@/components/training/TrainingClient'
import LocalDateRedirect from '@/components/ui/LocalDateRedirect'
import { NO_INDEX_METADATA } from '@/lib/seo/noIndexMetadata'

export const metadata: Metadata = {
  title: 'トレーニング記録 | FitMate',
  description: '筋トレ・有酸素運動を部位別に記録。セット数・重量・回数を管理してトレーニングの進捗を可視化。',
  ...NO_INDEX_METADATA,
}

export default async function TrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const { date } = await searchParams
  if (!date) return <LocalDateRedirect basePath="/training" />

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const dateId = date

  if (!user) {
    return <TrainingClient dateId={dateId} initialTrainings={[]} isGuest />
  }

  const [trainingsRes, weightsRes, profileRes] = await Promise.all([
    supabase.from('trainings').select('*').eq('user_id', user.id).eq('date_id', dateId).order('created_at', { ascending: true }),
    supabase.from('weight_records').select('date_id, weight').eq('user_id', user.id).order('date_id', { ascending: false }).limit(1),
    supabase.from('profiles').select('character').eq('user_id', user.id).single(),
  ])

  const latestWeight = parseFloat(weightsRes.data?.[0]?.weight ?? '60') || 60
  const characterId = (profileRes.data?.character ?? null) as 'leo' | 'saya' | 'mina' | null

  return <TrainingClient dateId={dateId} initialTrainings={trainingsRes.data ?? []} isGuest={false} bodyWeight={latestWeight} characterId={characterId} />
}
