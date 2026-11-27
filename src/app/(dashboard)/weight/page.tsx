import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import WeightClient from '@/components/weight/WeightClient'
import LocalDateRedirect from '@/components/ui/LocalDateRedirect'
import { NO_INDEX_METADATA } from '@/lib/seo/noIndexMetadata'

export const metadata: Metadata = {
  title: '体重・体脂肪記録 | FitMate',
  description: '体重・体脂肪率の推移をグラフで可視化。目標体重に向けた進捗を毎日記録して理想の体へ。',
  ...NO_INDEX_METADATA,
}

export const dynamic = 'force-dynamic'

export default async function WeightPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const params = await searchParams
  if (!params.date) return <LocalDateRedirect basePath="/weight" />

  const targetDateId = params.date

  if (!user) {
    return <WeightClient initialRecords={[]} height="" goalWeight="" isGuest targetDateId={targetDateId} />
  }

  const { data: records } = await supabase
    .from('weight_records')
    .select('*')
    .eq('user_id', user.id)
    .order('date_id', { ascending: true })

  const { data: profile } = await supabase
    .from('profiles')
    .select('height, goal_weight')
    .eq('user_id', user.id)
    .single()

  return (
    <WeightClient
      initialRecords={records ?? []}
      height={profile?.height ?? ''}
      goalWeight={profile?.goal_weight ?? ''}
      isGuest={false}
      targetDateId={targetDateId}
    />
  )
}
