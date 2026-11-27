import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CustomItemsClient from './CustomItemsClient'
import { MealItem, MealCategory } from '@/types'

export const dynamic = 'force-dynamic'

export default async function CustomItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; category?: string }>
}) {
  const { date, category } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/meal')

  const { data: allLogs } = await supabase
    .from('meal_logs')
    .select('items')
    .eq('user_id', user.id)
    .order('date_id', { ascending: false })
    .limit(500)

  const seen = new Set<string>()
  const allItems: MealItem[] = []
  for (const log of allLogs ?? []) {
    for (const item of (log.items ?? []) as MealItem[]) {
      if (item.name && !seen.has(item.name)) {
        seen.add(item.name)
        allItems.push(item)
      }
    }
  }

  let customItems: MealItem[] = []
  if (allItems.length > 0) {
    const checkNames = allItems.map((i) => i.name).slice(0, 1000)
    const { data: existingFoods } = await supabase
      .from('food_items')
      .select('name')
      .in('name', checkNames)
    const convenienceNames = new Set((existingFoods ?? []).map((f: { name: string }) => f.name))
    customItems = allItems.filter((item) => !convenienceNames.has(item.name))
  }

  const validCategories: MealCategory[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacking']
  const initialCategory = validCategories.includes(category as MealCategory)
    ? (category as MealCategory)
    : 'Breakfast'

  return (
    <CustomItemsClient
      dateId={date ?? ''}
      initialCategory={initialCategory}
      customItems={customItems}
      userId={user.id}
    />
  )
}
