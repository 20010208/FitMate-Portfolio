'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MealItem, MealCategory } from '@/types'

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

const EMPTY_FORM = { name: '', calorie: '', protein: '', fat: '', carbohydrate: '', amount: '' }

export default function CustomItemsClient({
  dateId,
  initialCategory,
  customItems,
  userId,
}: {
  dateId: string
  initialCategory: MealCategory
  customItems: MealItem[]
  userId: string
}) {
  const router = useRouter()
  const [filter, setFilter] = useState('')
  const [savingName, setSavingName] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formSaving, setFormSaving] = useState(false)

  const filtered = customItems.filter((item) =>
    !filter.trim() || item.name.toLowerCase().includes(filter.toLowerCase())
  )

  const upsertToMealLog = async (item: MealItem) => {
    const supabase = createClient()
    const { data: existingLog } = await supabase
      .from('meal_logs')
      .select('*')
      .eq('user_id', userId)
      .eq('date_id', dateId)
      .eq('category', initialCategory)
      .maybeSingle()

    const items = existingLog
      ? [...(existingLog.items ?? []), item]
      : [item]

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
  }

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
      // 過去の食事写真（legacy公開URLまたはobject path）を新しい記録へコピーしない。
      // 同じStorage objectを複数itemで共有させない。
      photo_url: null,
    }
    await upsertToMealLog(oneServing)
    setSavingName(null)
    router.refresh()
    router.back()
  }

  const handleSaveNew = async () => {
    if (!form.name.trim() || formSaving) return
    setFormSaving(true)
    const newItem: MealItem = {
      id: crypto.randomUUID(),
      name: form.name.trim(),
      calorie: form.calorie,
      protein: form.protein,
      fat: form.fat,
      carbohydrate: form.carbohydrate,
      amount: form.amount,
      sugar: '',
      dietary_fiber: '',
      salt: '',
      sodium: '',
      potassium: '',
      calcium: '',
      magnesium: '',
      servings: 1,
    }
    await upsertToMealLog(newItem)
    setFormSaving(false)
    router.refresh()
    router.back()
  }

  const handleNumeric = (field: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/[^0-9.]/g, '').replace(/^(\d*\.?\d*).*$/, '$1')
    setForm((p) => ({ ...p, [field]: v }))
  }

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex items-center justify-center w-9 h-9 rounded-xl font-bold text-lg transition active:opacity-60 focus:outline-none"
            style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', WebkitTapHighlightColor: 'transparent' }}
          >
            ←
          </button>
          <div>
            <h1 className="font-black text-xl" style={{ color: 'var(--text)' }}>登録アイテム</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {CATEGORY_EMOJI[initialCategory]} {CATEGORY_LABEL[initialCategory]}に追加
            </p>
          </div>
        </div>
        <button
          onClick={() => { setShowAddForm(true); setForm(EMPTY_FORM) }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white transition active:opacity-80 focus:outline-none"
          style={{ backgroundColor: 'var(--primary)', WebkitTapHighlightColor: 'transparent' }}
        >
          + 食品を追加
        </button>
      </div>

      {/* 追加フォーム */}
      {showAddForm && (
        <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
          <p className="font-bold text-sm" style={{ color: 'var(--text)' }}>新しい食品を追加</p>
          <input
            placeholder="食品名（必須）"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>カロリー (kcal)</label>
              <input
                type="text" inputMode="decimal" placeholder="0"
                value={form.calorie} onChange={handleNumeric('calorie')}
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
              />
            </div>
            <div>
              <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>量 (g)</label>
              <input
                type="text" inputMode="decimal" placeholder="0"
                value={form.amount} onChange={handleNumeric('amount')}
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
              />
            </div>
            <div>
              <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>タンパク質 (g)</label>
              <input
                type="text" inputMode="decimal" placeholder="0"
                value={form.protein} onChange={handleNumeric('protein')}
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
              />
            </div>
            <div>
              <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>脂質 (g)</label>
              <input
                type="text" inputMode="decimal" placeholder="0"
                value={form.fat} onChange={handleNumeric('fat')}
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>炭水化物 (g)</label>
              <input
                type="text" inputMode="decimal" placeholder="0"
                value={form.carbohydrate} onChange={handleNumeric('carbohydrate')}
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddForm(false)}
              className="flex-1 py-2 rounded-xl text-sm font-bold transition"
              style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', backgroundColor: 'var(--bg)' }}
            >
              キャンセル
            </button>
            <button
              onClick={handleSaveNew}
              disabled={!form.name.trim() || formSaving}
              className="flex-1 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-40 transition"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {formSaving ? '追加中...' : '追加する'}
            </button>
          </div>
        </div>
      )}

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
          <div className="py-12 text-center space-y-2">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {customItems.length === 0
                ? 'まだ登録アイテムがありません'
                : '食品が見つかりません'}
            </p>
            {customItems.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                右上の「食品を追加」から登録できます
              </p>
            )}
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
