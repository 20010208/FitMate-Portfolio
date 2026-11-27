import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import MealHistoryClient from './MealHistoryClient'
import { MealItem, MealCategory } from '@/types'

export const dynamic = 'force-dynamic'

export default async function MealHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; category?: string; tab?: string }>
}) {
  const { date, category, tab } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/meal')

  const { data: allLogs } = await supabase
    .from('meal_logs')
    .select('items, category')
    .eq('user_id', user.id)
    .order('date_id', { ascending: false })
    .limit(500)

  const CATS = ['Breakfast', 'Lunch', 'Dinner', 'Snacking'] as const
  const seenBycat = Object.fromEntries(CATS.map((c) => [c, new Set<string>()])) as Record<string, Set<string>>
  const recentByCategory = Object.fromEntries(CATS.map((c) => [c, [] as MealItem[]])) as Record<string, MealItem[]>
  const seenAll = new Set<string>()
  const allItems: MealItem[] = []

  for (const log of allLogs ?? []) {
    const cat = log.category as string
    for (const item of (log.items ?? []) as MealItem[]) {
      if (!item.name) continue
      if (seenBycat[cat] && !seenBycat[cat].has(item.name) && recentByCategory[cat].length < 100) {
        seenBycat[cat].add(item.name)
        recentByCategory[cat].push(item)
      }
      if (!seenAll.has(item.name)) {
        seenAll.add(item.name)
        allItems.push(item)
      }
    }
  }

  const validCategories: MealCategory[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacking']
  const initialCategory = validCategories.includes(category as MealCategory)
    ? (category as MealCategory)
    : 'Breakfast'
  const initialTab = tab === 'all' ? 'all' : 'category'

  return (
    <MealHistoryClient
      dateId={date ?? ''}
      initialCategory={initialCategory}
      initialTab={initialTab}
      recentByCategory={recentByCategory}
      allItems={allItems}
      userId={user.id}
    />
  )
}
