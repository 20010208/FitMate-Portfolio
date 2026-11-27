import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import HistoryClient from '@/components/history/HistoryClient'
import { NO_INDEX_METADATA } from '@/lib/seo/noIndexMetadata'

export const metadata: Metadata = {
  title: 'トレーニング履歴 | FitMate',
  description: '過去のトレーニング記録を日付別に確認。カレンダーで活動日を一目で把握してモチベーションを維持。',
  ...NO_INDEX_METADATA,
}

export default async function HistoryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return <HistoryClient trainings={[]} isGuest />
  }

  const { data: trainings } = await supabase
    .from('trainings')
    .select('*')
    .eq('user_id', user.id)
    .order('date_id', { ascending: false })

  return <HistoryClient trainings={trainings ?? []} />
}
