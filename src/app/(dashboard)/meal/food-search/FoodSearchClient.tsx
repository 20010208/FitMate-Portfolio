'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MealItem, MealCategory, FoodItem } from '@/types'

type SearchStep = 'main' | 'brand' | 'category' | 'subcategory' | 'items'

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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

const LOGO_VERSION = 2

const CONVENIENCE_BRANDS = [
  { name: 'セブンイレブン', logo: `${SUPABASE_URL}/storage/v1/object/public/Shop_logo/Seven-Eleven.png?v=${LOGO_VERSION}`, emoji: null, enabled: true },
  { name: 'ローソン', logo: `${SUPABASE_URL}/storage/v1/object/public/Shop_logo/Loson.png?v=${LOGO_VERSION}`, emoji: null, enabled: true },
  { name: 'ファミリーマート', logo: `${SUPABASE_URL}/storage/v1/object/public/Shop_logo/FamilyMart.png?v=${LOGO_VERSION}`, emoji: null, enabled: true },
  { name: 'ミニストップ', logo: `${SUPABASE_URL}/storage/v1/object/public/Shop_logo/Ministop.png?v=${LOGO_VERSION}`, emoji: null, enabled: false },
]

const RESTAURANT_BRANDS = [
  { name: 'マクドナルド', logo: null, emoji: '🍔', enabled: false },
  { name: 'すき家', logo: null, emoji: '🥩', enabled: false },
  { name: '吉野家', logo: null, emoji: '🍚', enabled: false },
  { name: 'なか卯', logo: null, emoji: '🍜', enabled: false },
  { name: 'サイゼリヤ', logo: null, emoji: '🍝', enabled: false },
  { name: 'ガスト', logo: null, emoji: '🍽️', enabled: false },
]

const SUBCATEGORY_LABEL: Record<string, string> = {
  'セブンプレミアム サラダ': 'サラダ',
  'ファミマル/おむすび': 'おむすび',
  'ファミマル/お弁当': 'お弁当',
  'ファミマル/お寿司': 'お寿司',
  'ファミマル/サンドイッチ・ロールパン': 'サンドイッチ・ロールパン',
  'ファミマル/そば・うどん・中華めん': 'そば・うどん・中華めん',
  'ファミマル/パスタ': 'パスタ',
  'ファミマル/サラダ・ドレッシング': 'サラダ・ドレッシング',
  'ファミマル/チルド惣菜': 'チルド惣菜',
  'ファミマル/スープ・グラタン・お好み焼き': 'スープ・グラタン・お好み焼き',
  'ファミマル/日配品': '日配品',
  'ファミマル/冷凍食品': '冷凍食品',
  'まちかど厨房/おにぎり': 'おにぎり',
  'まちかど厨房/お弁当': 'お弁当',
  'まちかど厨房/お惣菜': 'お惣菜',
  'まちかど厨房/サンドイッチ': 'サンドイッチ',
}

const CATEGORY_GROUPS: Record<string, string[]> = {
  '麺類': ['そば', 'うどん', '中華麺', '焼きそば・焼うどん・その他'],
  'サラダ': ['サラダ', 'パスタサラダ・おかずサラダほか', 'カット野菜・カットフルーツ'],
  'アイス': ['アイス'],
  'セブンプレミアム': ['主菜', '副菜', 'セブンプレミアム サラダ', 'その他', '生鮮食品', 'インスタント食品', 'レトルト食品', '米・米加工品', '乾麺・乾物', '珍味・缶詰', '調味料', 'ジャム・はちみつ', 'インスタントドリンク'],
  'ファミマル': [
    'ファミマル/おむすび', 'ファミマル/お弁当', 'ファミマル/お寿司',
    'ファミマル/サンドイッチ・ロールパン', 'ファミマル/そば・うどん・中華めん',
    'ファミマル/パスタ', 'ファミマル/サラダ・ドレッシング', 'ファミマル/チルド惣菜',
    'ファミマル/スープ・グラタン・お好み焼き', 'ファミマル/日配品', 'ファミマル/冷凍食品',
  ],
  'まちかど厨房': [
    'まちかど厨房/おにぎり', 'まちかど厨房/お弁当', 'まちかど厨房/お惣菜', 'まちかど厨房/サンドイッチ',
  ],
}

const CATEGORY_ORDER: string[] = [
  'おにぎり', 'お寿司', 'お弁当', 'ファミマル', 'まちかど厨房',
  'サンドイッチ・ロールパン', 'パン', '麺類', 'パスタ', 'サラダ', '惣菜',
  'グラタン・ドリア', '揚げ物・フランク・焼き鳥', 'おでん', '中華まん',
  '冷凍食品', 'スイーツ', 'ドーナツ', 'アイス', 'セブンカフェ',
  'セブンカフェベーカリー', 'セブンプレミアム',
]

const CATEGORY_EMOJI_MAP: Record<string, string> = {
  'おにぎり': '🍙', 'お寿司': '🍣', 'お弁当': '🍱', 'サンドイッチ・ロールパン': '🥪',
  'パン': '🍞', '麺類': '🍜', 'パスタ': '🍝', 'サラダ': '🥗', '惣菜': '🥘',
  'グラタン・ドリア': '🫕', '揚げ物・フランク・焼き鳥': '🍗', 'おでん': '🍢',
  '中華まん': '🥟', '冷凍食品': '🧊', 'スイーツ': '🍰', 'ドーナツ': '🍩',
  'アイス': '🍦', 'セブンカフェ': '☕', 'セブンカフェベーカリー': '🥐',
  'セブンプレミアム': '⭐', 'ファミマル': '🟢', 'まちかど厨房': '🍳',
}

const hiraToKata = (s: string) => s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
const kataToHira = (s: string) => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
const fullToHalf = (s: string) => s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
const halfToFull = (s: string) => s.replace(/[A-Za-z0-9]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0))

const buildSearchPatterns = (query: string): string[] => {
  const set = new Set<string>()
  const half = fullToHalf(query)
  const variants = [query, hiraToKata(query), kataToHira(query), half, halfToFull(query), hiraToKata(half)]
  variants.forEach(v => v.trim() && set.add(v))
  return [...set].filter(p => p.trim().length >= 1)
}

const matchesSearch = (text: string, query: string): boolean => {
  if (!query.trim()) return true
  const norm = (s: string) => hiraToKata(fullToHalf(s)).toLowerCase()
  return buildSearchPatterns(query).some(p => norm(text).includes(norm(p)))
}

const getDisplayCategories = (cats: string[]) => {
  const result: string[] = []
  const added = new Set<string>()
  for (const cat of cats) {
    const parentEntry = Object.entries(CATEGORY_GROUPS).find(([, children]) => children.includes(cat))
    if (parentEntry) {
      if (!added.has(parentEntry[0])) { result.push(parentEntry[0]); added.add(parentEntry[0]) }
    } else {
      result.push(cat)
    }
  }
  return result.sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a)
    const bi = CATEGORY_ORDER.indexOf(b)
    if (ai === -1 && bi === -1) return 0
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

export default function FoodSearchClient({
  dateId,
  initialCategory,
  userId,
}: {
  dateId: string
  initialCategory: MealCategory
  userId: string
}) {
  const router = useRouter()
  const [step, setStep] = useState<SearchStep>('main')
  const [searchType, setSearchType] = useState<'convenience' | 'restaurant' | 'jisui'>('convenience')
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedParentCategory, setSelectedParentCategory] = useState<string | null>(null)
  const [brandCategories, setBrandCategories] = useState<string[]>([])
  const [brandItems, setBrandItems] = useState<FoodItem[]>([])
  const [loading, setLoading] = useState(false)
  const [itemFilter, setItemFilter] = useState('')
  const [globalSearch, setGlobalSearch] = useState('')
  const [globalSearchResults, setGlobalSearchResults] = useState<FoodItem[]>([])
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  const brands = searchType === 'convenience' ? CONVENIENCE_BRANDS : RESTAURANT_BRANDS

  const handleGlobalSearch = async (query: string, brand?: string | null) => {
    setGlobalSearch(query)
    if (query.trim().length < 1) { setGlobalSearchResults([]); return }
    setGlobalSearchLoading(true)
    const supabase = createClient()
    const patterns = buildSearchPatterns(query)
    const nameConds = patterns.map(p => `name.ilike.%${p}%`)
    const readingConds = patterns.map(p => `reading.ilike.%${p}%`)
    const orCondition = [...nameConds, ...readingConds].join(',')
    let req = supabase.from('food_items').select('*').or(orCondition).order('name').limit(50)
    if (brand) req = req.eq('brand', brand)
    const { data } = await req
    setGlobalSearchResults((data as FoodItem[]) ?? [])
    setGlobalSearchLoading(false)
  }

  const resetGlobalSearch = () => { setGlobalSearch(''); setGlobalSearchResults([]) }

  const selectBrand = async (brand: string) => {
    setSelectedBrand(brand)
    setSelectedParentCategory(null)
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase.rpc('get_brand_categories', { brand_name: brand })
    const categories = (data ?? []).map((d: { category: string }) => d.category).filter(Boolean)
    setBrandCategories(categories)
    setStep('category')
    setLoading(false)
  }

  const selectDisplayCategory = (displayCat: string) => {
    const children = CATEGORY_GROUPS[displayCat]
    if (children) {
      setSelectedParentCategory(displayCat)
      setStep('subcategory')
    } else {
      fetchCategoryItems(displayCat)
    }
  }

  const fetchCategoryItems = async (category: string) => {
    setSelectedCategory(category)
    setStep('items')
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase.from('food_items').select('*').eq('brand', selectedBrand!).eq('category', category).order('name')
    setBrandItems((data as FoodItem[]) ?? [])
    setLoading(false)
  }

  const handleSelectItem = async (f: FoodItem) => {
    if (savingId) return
    setSavingId(f.id)
    const newItem: MealItem = {
      id: crypto.randomUUID(),
      name: f.name,
      amount: f.amount ?? '',
      calorie: f.calorie ?? '',
      protein: f.protein ?? '',
      fat: f.fat ?? '',
      carbohydrate: f.carbohydrate ?? '',
      sugar: '', dietary_fiber: '', salt: '', sodium: '', potassium: '', calcium: '', magnesium: '',
      servings: 1,
    }
    const supabase = createClient()
    const { data: existingLog } = await supabase
      .from('meal_logs').select('*')
      .eq('user_id', userId).eq('date_id', dateId).eq('category', initialCategory)
      .maybeSingle()
    const items = existingLog ? [...(existingLog.items ?? []), newItem] : [newItem]
    await supabase.from('meal_logs').upsert(
      { ...(existingLog ? { id: existingLog.id } : {}), user_id: userId, date_id: dateId, category: initialCategory, items, did_not_eat: false },
      { onConflict: 'user_id,date_id,category' }
    )
    setSavingId(null)
    router.refresh()
    router.back()
  }

  const handleBack = () => {
    resetGlobalSearch()
    setItemFilter('')
    if (step === 'brand') { setStep('main') }
    else if (step === 'category') {
      if (searchType === 'jisui') { setStep('main'); setSelectedBrand(null) }
      else { setStep('brand'); setSelectedBrand(null) }
    }
    else if (step === 'subcategory') { setStep('category'); setSelectedParentCategory(null) }
    else if (step === 'items') { setStep(selectedParentCategory ? 'subcategory' : 'category'); setSelectedCategory(null) }
  }

  const ItemButton = ({ f }: { f: FoodItem }) => {
    const isSaving = savingId === f.id
    return (
      <button
        onClick={() => handleSelectItem(f)}
        disabled={!!savingId}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition active:opacity-60 focus:outline-none text-left"
        style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', opacity: savingId && !isSaving ? 0.5 : 1, WebkitTapHighlightColor: 'transparent' }}
      >
        <div className="flex-1 min-w-0 mr-2">
          <p className="text-sm font-bold truncate" style={{ color: 'var(--text)' }}>{f.name}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {[f.amount && `${f.amount}g`, f.calorie && `${f.calorie}kcal`, f.protein && `P:${f.protein}g`, f.fat && `F:${f.fat}g`].filter(Boolean).join(' • ')}
          </p>
        </div>
        <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center font-black text-xs text-white" style={{ backgroundColor: isSaving ? 'var(--border)' : 'var(--primary)' }}>
          {isSaving ? '…' : '+'}
        </span>
      </button>
    )
  }

  const stepTitle = step === 'main' ? '食品を検索'
    : step === 'brand' ? (searchType === 'convenience' ? 'コンビニを選択' : '外食チェーンを選択')
    : selectedBrand ?? ''
  const breadcrumb = [selectedBrand, selectedParentCategory, selectedCategory].filter(Boolean).join(' › ')

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => step === 'main' ? router.back() : handleBack()}
          className="flex items-center justify-center w-9 h-9 rounded-xl font-bold text-lg transition active:opacity-60 focus:outline-none"
          style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', WebkitTapHighlightColor: 'transparent' }}
        >
          ←
        </button>
        <div>
          <h1 className="font-black text-xl" style={{ color: 'var(--text)' }}>{stepTitle}</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {CATEGORY_EMOJI[initialCategory]} {CATEGORY_LABEL[initialCategory]}に追加
            {breadcrumb && <span className="ml-1">› {breadcrumb}</span>}
          </p>
        </div>
      </div>

      {/* メイン: 検索 + コンビニ/外食/自炊カード */}
      {step === 'main' && (
        <div className="space-y-3">
          <input
            placeholder="食品名で検索..."
            value={globalSearch}
            onChange={(e) => handleGlobalSearch(e.target.value, null)}
            autoFocus
            className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'var(--text)' }}
          />
          {globalSearch.trim().length >= 1 ? (
            globalSearchLoading ? (
              <p className="text-center py-4 text-sm" style={{ color: 'var(--text-muted)' }}>検索中...</p>
            ) : globalSearchResults.length > 0 ? (
              <div className="space-y-1">
                {globalSearchResults.map((f) => <ItemButton key={f.id} f={f} />)}
              </div>
            ) : (
              <p className="text-center py-4 text-sm" style={{ color: 'var(--text-muted)' }}>商品が見つかりません</p>
            )
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => { setSearchType('convenience'); setStep('brand') }}
                className="flex flex-col items-center gap-1.5 py-4 rounded-xl font-bold text-sm transition active:opacity-60 focus:outline-none"
                style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', WebkitTapHighlightColor: 'transparent' }}
              >
                <span className="text-2xl">🏪</span>
                <span>コンビニ</span>
              </button>
              <button
                disabled
                className="flex flex-col items-center gap-1.5 py-4 rounded-xl font-bold text-sm opacity-40"
                style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
              >
                <span className="text-2xl">🍽️</span>
                <span>外食</span>
              </button>
              <button
                onClick={() => { setSearchType('jisui'); selectBrand('自炊') }}
                className="flex flex-col items-center gap-1.5 py-4 rounded-xl font-bold text-sm transition active:opacity-60 focus:outline-none"
                style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', WebkitTapHighlightColor: 'transparent' }}
              >
                <span className="text-2xl">🍳</span>
                <span>自炊</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ブランド選択 */}
      {step === 'brand' && (
        <div className="space-y-3">
          <input
            placeholder="商品名で検索..."
            value={globalSearch}
            onChange={(e) => handleGlobalSearch(e.target.value, null)}
            className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'var(--text)' }}
          />
          {globalSearch.trim().length >= 1 ? (
            globalSearchLoading ? (
              <p className="text-center py-4 text-sm" style={{ color: 'var(--text-muted)' }}>検索中...</p>
            ) : globalSearchResults.length > 0 ? (
              <div className="space-y-1">
                {globalSearchResults.map((f) => <ItemButton key={f.id} f={f} />)}
              </div>
            ) : (
              <p className="text-center py-4 text-sm" style={{ color: 'var(--text-muted)' }}>商品が見つかりません</p>
            )
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {brands.map((b) => (
                <button
                  key={b.name}
                  onClick={() => b.enabled && selectBrand(b.name)}
                  disabled={!b.enabled}
                  className="py-4 rounded-xl text-sm font-bold flex flex-col items-center gap-2 transition active:opacity-60 focus:outline-none"
                  style={{
                    backgroundColor: 'var(--card)', border: '1px solid var(--border)',
                    color: b.enabled ? 'var(--text)' : 'var(--text-muted)',
                    opacity: b.enabled ? 1 : 0.4, cursor: b.enabled ? 'pointer' : 'not-allowed',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {b.logo
                    ? <Image src={b.logo} alt={b.name} width={80} height={80} className="w-20 h-20 object-contain rounded-2xl" />
                    : <span className="text-2xl">{b.emoji}</span>
                  }
                  <span>{b.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* カテゴリ選択 */}
      {step === 'category' && (
        <div className="space-y-3">
          <input
            placeholder={`${selectedBrand ?? ''}の商品を検索...`}
            value={globalSearch}
            onChange={(e) => handleGlobalSearch(e.target.value, selectedBrand)}
            className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'var(--text)' }}
          />
          {globalSearch.trim().length >= 1 ? (
            globalSearchLoading ? (
              <p className="text-center py-4 text-sm" style={{ color: 'var(--text-muted)' }}>検索中...</p>
            ) : globalSearchResults.length > 0 ? (
              <div className="space-y-1">
                {globalSearchResults.map((f) => <ItemButton key={f.id} f={f} />)}
              </div>
            ) : (
              <p className="text-center py-4 text-sm" style={{ color: 'var(--text-muted)' }}>商品が見つかりません</p>
            )
          ) : loading ? (
            <p className="text-center py-4 text-sm" style={{ color: 'var(--text-muted)' }}>読み込み中...</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {getDisplayCategories(brandCategories).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => { resetGlobalSearch(); selectDisplayCategory(cat) }}
                    className="py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition active:opacity-60 focus:outline-none"
                    style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', WebkitTapHighlightColor: 'transparent' }}
                  >
                    {CATEGORY_EMOJI_MAP[cat] && <span>{CATEGORY_EMOJI_MAP[cat]}</span>}
                    {cat}
                  </button>
                ))}
              </div>
              {selectedBrand === '自炊' && (
                <p className="text-center text-xs pt-1 pb-2" style={{ color: 'var(--text-muted)' }}>
                  栄養データ出典：文部科学省「日本食品標準成分表2020年版（八訂）」
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* サブカテゴリ選択 */}
      {step === 'subcategory' && (
        <div className="space-y-3">
          <input
            placeholder={`${selectedBrand ?? ''}の商品を検索...`}
            value={globalSearch}
            onChange={(e) => handleGlobalSearch(e.target.value, selectedBrand)}
            className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'var(--text)' }}
          />
          {globalSearch.trim().length >= 1 ? (
            globalSearchLoading ? (
              <p className="text-center py-4 text-sm" style={{ color: 'var(--text-muted)' }}>検索中...</p>
            ) : globalSearchResults.length > 0 ? (
              <div className="space-y-1">
                {globalSearchResults.map((f) => <ItemButton key={f.id} f={f} />)}
              </div>
            ) : (
              <p className="text-center py-4 text-sm" style={{ color: 'var(--text-muted)' }}>商品が見つかりません</p>
            )
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {(CATEGORY_GROUPS[selectedParentCategory!] ?? [])
                .filter((sub) => brandCategories.includes(sub))
                .map((sub) => (
                  <button
                    key={sub}
                    onClick={() => { resetGlobalSearch(); fetchCategoryItems(sub) }}
                    className="py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition active:opacity-60 focus:outline-none"
                    style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', WebkitTapHighlightColor: 'transparent' }}
                  >
                    {CATEGORY_EMOJI_MAP[sub] && <span>{CATEGORY_EMOJI_MAP[sub]}</span>}
                    {SUBCATEGORY_LABEL[sub] ?? sub}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {/* 商品リスト */}
      {step === 'items' && (
        <div className="space-y-3">
          <input
            placeholder="絞り込み..."
            value={itemFilter}
            onChange={(e) => setItemFilter(e.target.value)}
            className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'var(--text)' }}
          />
          {loading ? (
            <p className="text-center py-4 text-sm" style={{ color: 'var(--text-muted)' }}>読み込み中...</p>
          ) : (
            <div className="space-y-1">
              {brandItems
                .filter((f) => !itemFilter.trim() || matchesSearch(f.name, itemFilter) || (f.reading ? matchesSearch(f.reading, itemFilter) : false))
                .map((f) => <ItemButton key={f.id} f={f} />)}
              {brandItems.filter((f) => !itemFilter.trim() || matchesSearch(f.name, itemFilter)).length === 0 && (
                <p className="text-center py-4 text-sm" style={{ color: 'var(--text-muted)' }}>商品が見つかりません</p>
              )}
            </div>
          )}
          {selectedBrand === '自炊' && (
            <p className="text-center text-xs pt-1 pb-2" style={{ color: 'var(--text-muted)' }}>
              栄養データ出典：文部科学省「日本食品標準成分表2020年版（八訂）」
            </p>
          )}
        </div>
      )}
    </div>
  )
}
