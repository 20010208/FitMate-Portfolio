import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import FoodSearchClient from './FoodSearchClient'
import { MealCategory } from '@/types'

export const dynamic = 'force-dynamic'

export default async function FoodSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; category?: string }>
}) {
  const { date, category } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/meal')

  const validCategories: MealCategory[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacking']
  const initialCategory = validCategories.includes(category as MealCategory)
    ? (category as MealCategory)
    : 'Breakfast'

  return (
    <FoodSearchClient
      dateId={date ?? ''}
      initialCategory={initialCategory}
      userId={user.id}
    />
  )
}
