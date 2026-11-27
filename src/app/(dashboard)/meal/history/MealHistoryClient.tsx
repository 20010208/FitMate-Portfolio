'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MealItem, MealCategory } from '@/types'

type Tab = 'category' | 'all'

const CATEGORY_LABEL: Record<MealCategory, string> = {
  Breakfast: '朝食',
  Lunch: '昼食',
  Dinner: '夕食',
  Snacking: '間食',
}

const CATEGORY_EMOJI: Record<MealCategory, string> = {
  Breakfast: '🌅',
  Lunch: '☀️',
  Dinner: '🌙',
  Snacking: '🍪',
}

const per1 = (v: string, s: number): string => {
  if (!v || s === 1) return v
  const n = parseFloat(v)
  return isNaN(n) ? v : String(Math.round((n / s) * 10) / 10)
}

export default function MealHistoryClient({
  dateId,
  initialCategory,
  initialTab,
  recentByCategory,
  allItems,
  userId,
}: {
  dateId: string
  initialCategory: MealCategory
  initialTab: Tab
  recentByCategory: Record<string, MealItem[]>
  allItems: MealItem[]
  userId: string
}) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [filter, setFilter] = useState('')
  const [savingName, setSavingName] = useState<string | null>(null)

  const tabItems: Record<Tab, MealItem[]> = {
    category: recentByCategory[initialCategory] ?? [],
    all: allItems,
  }

  const filtered = tabItems[activeTab].filter((item) =>
    !filter.trim() || item.name.toLowerCase().includes(filter.toLowerCase())
  )

  const handleAdd = async (item: MealItem) => {
    if (savingName) return
    setSavingName(item.name)

    const s = item.servings ?? 1
    const oneServing: MealItem = {
      ...item,
      id: crypto.randomUUID(),
      servings: 1,
      calorie: per1(item.calorie, s),
      protein: per1(item.protein, s),
      fat: per1(item.fat, s),
      carbohydrate: per1(item.carbohydrate, s),
      amount: per1(item.amount, s),
      // 過去の食事写真（legacy公開URLまたはobject path）を新しい記録へコピーしない
      photo_url: null,
    }

    const supabase = createClient()
    const { data: existingLog } = await supabase
      .from('meal_logs')
      .select('*')
      .eq('user_id', userId)
      .eq('date_id', dateId)
      .eq('category', initialCategory)
      .maybeSingle()

    const items = existingLog
      ? [...(existingLog.items ?? []), oneServing]
      : [oneServing]

    await supabase.from('meal_logs').upsert(
      {
        ...(existingLog ? { id: existingLog.id } : {}),
        user_id: userId,
        date_id: dateId,
        category: initialCategory,
        items,
        did_not_eat: false,
      },
      { onConflict: 'user_id,date_id,category' }
    )

    setSavingName(null)
    router.refresh()
    router.back()
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'category', label: CATEGORY_LABEL[initialCategory] },
    { key: 'all', label: 'すべて' },
  ]

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="flex items-center justify-center w-9 h-9 rounded-xl font-bold text-lg transition active:opacity-60 focus:outline-none"
          style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', WebkitTapHighlightColor: 'transparent' }}
        >
          ←
        </button>
        <div>
          <h1 className="font-black text-xl" style={{ color: 'var(--text)' }}>食品履歴</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {CATEGORY_EMOJI[initialCategory]} {CATEGORY_LABEL[initialCategory]}に追加
          </p>
        </div>
      </div>

      {/* タブ */}
      <div className="flex gap-2">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setActiveTab(key); setFilter('') }}
            className="px-3 py-1.5 rounded-full text-xs font-bold transition focus:outline-none"
            style={{
              backgroundColor: activeTab === key ? 'var(--primary)' : 'var(--bg)',
              color: activeTab === key ? '#fff' : 'var(--text-muted)',
              border: `1px solid ${activeTab === key ? 'var(--primary)' : 'var(--border)'}`,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 検索 */}
      <input
        placeholder="食品名で検索..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'var(--text)' }}
      />

      {/* リスト */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>食品が見つかりません</p>
          </div>
        ) : (
          filtered.map((item) => {
            const s = item.servings ?? 1
            const isSaving = savingName === item.name
            return (
              <button
                key={item.name}
                onClick={() => handleAdd(item)}
                disabled={!!savingName}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition active:opacity-60 focus:outline-none text-left"
                style={{
                  backgroundColor: 'var(--card)',
                  border: '1px solid var(--border)',
                  opacity: savingName && !isSaving ? 0.5 : 1,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <div className="flex-1 min-w-0 mr-3">
                  <p className="font-bold text-sm truncate" style={{ color: 'var(--text)' }}>{item.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {[
                      item.calorie ? `${per1(item.calorie, s)}kcal` : '',
                      item.protein ? `P:${per1(item.protein, s)}g` : '',
                      item.fat ? `F:${per1(item.fat, s)}g` : '',
                      item.carbohydrate ? `C:${per1(item.carbohydrate, s)}g` : '',
                    ].filter(Boolean).join(' • ')}
                    {s > 1 ? ' /人前' : ''}
                  </p>
                </div>
                <span
                  className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center font-black text-sm"
                  style={{ backgroundColor: isSaving ? 'var(--border)' : 'var(--primary)', color: '#fff' }}
                >
                  {isSaving ? '…' : '+'}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
