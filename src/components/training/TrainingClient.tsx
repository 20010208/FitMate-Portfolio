'use client'

import { useState } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Training, TrainingSet, TRAINING_CATEGORIES } from '@/types'
import SignupPromptModal from '@/components/ui/SignupPromptModal'
import { useT, getLocale } from '@/lib/i18n'
import { CharacterId, getCharacterImageUrl } from '@/lib/characters'
import { describeAiResponseError } from '@/lib/ai/client-errors'

const CARDIO_METS: Record<string, number> = {
  'ランニング': 8, 'Running': 8,
  'サイクリング': 6, 'Cycling': 6,
  '水泳': 7, 'Swimming': 7,
  '縄跳び': 10, 'Jump Rope': 10,
  'HIIT': 8,
  'ダンス': 5, 'Dance': 5,
}

const STRENGTH_METS: Record<string, number> = {
  '脚': 6, 'Legs': 6,
  '背中': 5, 'Back': 5,
  '胸': 4.5, 'Chest': 4.5,
  '肩': 4, 'Shoulder': 4,
  '腹筋': 3.5, 'Abs': 3.5,
  '腕': 3, 'Arms': 3,
}

// 部位別の仕事量係数（kcal/kg·rep）— 筋肉量の大きさに比例
const VOLUME_COEFF: Record<string, number> = {
  '脚': 0.15, 'Legs': 0.15,       // 最大筋群（大腿四頭筋・ハムストリングス・臀筋）
  '背中': 0.12, 'Back': 0.12,     // 大筋群（広背筋・僧帽筋）
  '胸': 0.10, 'Chest': 0.10,      // 大筋群（大胸筋・三角筋前部）
  '肩': 0.07, 'Shoulder': 0.07,   // 中筋群（三角筋）
  '腹筋': 0.05, 'Abs': 0.05,      // 中小筋群（腹直筋）
  '腕': 0.04, 'Arms': 0.04,       // 小筋群（上腕二頭筋・三頭筋）
}

type Props = {
  dateId: string
  initialTrainings: Training[]
  isGuest: boolean
  bodyWeight?: number
  characterId?: CharacterId | null
}

export default function TrainingClient({ dateId, initialTrainings, isGuest, bodyWeight = 60, characterId }: Props) {
  const t = useT()
  const locale = getLocale()
  const isJa = locale === 'ja'

  const [trainings, setTrainings] = useState<Training[]>(initialTrainings)
  const [showCategories, setShowCategories] = useState(false)
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null)
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null)
  const [sets, setSets] = useState<TrainingSet[]>([{ weight: '', reps: '', memo: '' }])
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showSignupModal, setShowSignupModal] = useState(false)
  const [signupVariant, setSignupVariant] = useState<'default' | 'after-save' | 'ai'>('default')
  const [customExercise, setCustomExercise] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [exerciseMemo, setExerciseMemo] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [aiActivity, setAiActivity] = useState('')
  const [aiDuration, setAiDuration] = useState('')
  const [aiDetail, setAiDetail] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)

  const selectedCat = TRAINING_CATEGORIES.find((c) => c.id === selectedCatId) ?? null
  const isCardio = selectedCatId === 'cardio'

  const cardioDistanceUnit = (exercise: string | null): string | null => {
    if (!exercise) return 'km'
    const timeOnlyExercises = ['HIIT', 'ダンス', 'Dance']
    const mExercises = ['水泳', 'Swimming']
    const countExercises = ['縄跳び', 'Jump Rope']
    if (timeOnlyExercises.some((e) => exercise.includes(e))) return null
    if (mExercises.some((e) => exercise.includes(e))) return 'm'
    if (countExercises.some((e) => exercise.includes(e))) return '回'
    return 'km'
  }
  const distanceUnit = cardioDistanceUnit(selectedExercise)

  // カテゴリ・種目の表示名（ロケールに応じて切り替え）
  const catDisplayName = (cat: typeof TRAINING_CATEGORIES[0]) => isJa ? cat.jaName : cat.name
  const exercises = selectedCat ? (isJa ? selectedCat.jaExercises : selectedCat.exercises) : []

  // DBへの保存用: ロケールに応じた表示名
  const catStoreName = selectedCat ? catDisplayName(selectedCat) : ''

  const totalSet = trainings.reduce((a, tr) => a + tr.sets.length, 0)
  const totalRep = trainings.reduce((a, tr) => tr.sets.reduce((b, s) => b + (parseInt(s.reps) || 0), a), 0)
  const totalLoad = trainings.reduce((a, tr) => tr.sets.reduce((b, s) => b + (parseInt(s.weight) || 0) * (parseInt(s.reps) || 0), a), 0)

  const totalBurnedKcal = Math.round(trainings.reduce((total, tr) => {
    if (tr.category === 'AI推定') {
      return total + tr.sets.reduce((s, set) => s + (set.reps === 'ai_kcal' ? parseFloat(set.weight) || 0 : 0), 0)
    }
    const cat = TRAINING_CATEGORIES.find((c) => c.name === tr.category || c.jaName === tr.category)
    const isCardioTr = cat?.id === 'cardio'
    if (isCardioTr) {
      const met = CARDIO_METS[tr.exercise] ?? 6
      return total + tr.sets.reduce((s, set) => s + met * bodyWeight * ((parseFloat(set.weight) || 0) / 60), 0)
    } else {
      const met = STRENGTH_METS[tr.category] ?? 4
      const coeff = VOLUME_COEFF[tr.category] ?? 0.08
      return total + tr.sets.reduce((s, set) => {
        const liftedKg = parseFloat(set.weight) || 0
        const reps = parseInt(set.reps) || 0
        const volumeKcal = liftedKg * reps * coeff
        const durationKcal = met * bodyWeight * ((reps * 3.5 + 90) / 3600)
        return s + volumeKcal + durationKcal
      }, 0)
    }
  }, 0))

  const handleSaveSet = async () => {
    if (!selectedExercise) return
    const isAiEdit = sets.length > 0 && sets[0].reps === 'ai_kcal'
    if (!isAiEdit && !selectedCat) return
    const filtered = isAiEdit ? sets : sets.filter((s) => s.weight || s.reps)
    if (filtered.length === 0) return
    const saveCategory = isAiEdit ? 'AI推定' : catStoreName
    if (isGuest) {
      const tempTraining: Training = {
        id: crypto.randomUUID(),
        user_id: 'guest',
        date_id: dateId,
        category: saveCategory,
        exercise: selectedExercise,
        sets: filtered,
        created_at: new Date().toISOString(),
      }
      setTrainings((prev) => [...prev, tempTraining])
      resetForm()
      setSignupVariant('after-save')
      setShowSignupModal(true)
      return
    }
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }
    if (editingId) {
      const { data } = await supabase.from('trainings').update({ sets: filtered, memo: exerciseMemo }).eq('id', editingId).select().single()
      if (data) setTrainings((prev) => prev.map((tr) => tr.id === editingId ? data : tr))
    } else {
      const { data } = await supabase.from('trainings').insert({
        user_id: user.id,
        date_id: dateId,
        category: saveCategory,
        exercise: selectedExercise,
        sets: filtered,
        memo: exerciseMemo,
      }).select().single()
      if (data) setTrainings((prev) => [...prev, data])
    }
    resetForm()
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    const supabase = createClient()
    await supabase.from('trainings').delete().eq('id', id)
    setTrainings((prev) => prev.filter((tr) => tr.id !== id))
  }

  const handleEdit = (tr: Training) => {
    setEditingId(tr.id)
    // 英語・日本語どちらの名前でも対応
    const cat = TRAINING_CATEGORIES.find((c) => c.name === tr.category || c.jaName === tr.category)
    setSelectedCatId(cat?.id ?? null)
    setSelectedExercise(tr.exercise)
    setSets(tr.sets)
    setExerciseMemo(tr.memo ?? '')
    setShowCategories(false)
  }

  const resetForm = () => {
    setShowCategories(false)
    setSelectedCatId(null)
    setSelectedExercise(null)
    setSets([{ weight: '', reps: '', memo: '' }])
    setEditingId(null)
    setCustomExercise('')
    setShowCustomInput(false)
    setExerciseMemo('')
  }

  const handleAskAI = async () => {
    if (!aiActivity.trim() || !aiDuration.trim() || aiLoading) return
    if (isGuest) { setSignupVariant('ai'); setShowSignupModal(true); return }
    setAiLoading(true)
    setAiAnswer('')
    const question = `種目: ${aiActivity}、時間: ${aiDuration}${aiDetail.trim() ? `、詳細: ${aiDetail}` : ''}`
    try {
      const res = await fetch('/api/training-calorie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, bodyWeight }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        const { message, retryAfterSeconds } = describeAiResponseError(res, data?.error)
        setAiAnswer(retryAfterSeconds ? `${message}（${retryAfterSeconds}秒後に再試行できます）` : message)
      } else {
        setAiAnswer(data?.answer ?? 'エラーが発生しました')
      }
    } catch {
      setAiAnswer('通信エラーが発生しました')
    }
    setAiLoading(false)
  }

  const handleSaveAiResult = async () => {
    if (!aiAnswer || aiSaving) return
    if (isGuest) { setSignupVariant('ai'); setShowSignupModal(true); return }

    // 「【消費カロリー推定】1,949〜1,950 kcal」からkcalを抽出して平均を取る
    const match = aiAnswer.match(/【消費カロリー推定】([\d,]+)(?:〜([\d,]+))?\s*kcal/)
    const num1 = match ? parseInt(match[1].replace(/,/g, '')) : 0
    const num2 = match?.[2] ? parseInt(match[2].replace(/,/g, '')) : num1
    const estimatedKcal = Math.round((num1 + num2) / 2)
    if (!estimatedKcal) return

    setAiSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setAiSaving(false); return }

    const { data } = await supabase.from('trainings').insert({
      user_id: user.id,
      date_id: dateId,
      category: 'AI推定',
      exercise: aiActivity,
      sets: [{ weight: estimatedKcal.toString(), reps: 'ai_kcal', memo: aiDuration }],
      memo: aiAnswer,
    }).select().single()

    if (data) {
      setTrainings((prev) => [...prev, data])
      setAiSaved(true)
    }
    setAiSaving(false)
  }

  const dateLabel = `${dateId.slice(0, 4)}/${dateId.slice(4, 6)}/${dateId.slice(6, 8)}`

  return (
    <div className="space-y-6">
      {showSignupModal && <SignupPromptModal variant={signupVariant} onClose={() => { setShowSignupModal(false); setSignupVariant('default') }} />}

      {/* Page title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black" style={{ color: 'var(--text)' }}>{t('trainings')} 🏋️</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{dateLabel}</p>
        </div>
        {!selectedExercise && (
          <button
            onClick={() => setShowCategories(true)}
            className="px-4 py-2 rounded-xl font-bold text-white text-sm transition hover:opacity-80"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            + {t('add')}
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: t('exercise'), value: trainings.length },
          { label: t('set'), value: totalSet },
          { label: t('rep'), value: totalRep },
          { label: t('load'), value: totalLoad },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl p-3 text-center shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
            <p className="text-xl font-black" style={{ color: 'var(--primary)' }}>{s.value}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Total calories burned */}
      {trainings.length > 0 && (
        <div className="rounded-2xl px-5 py-4 shadow-sm flex items-center justify-between" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
          <div>
            <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>🔥 消費カロリー（推定）</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>MET × 体重 × 時間で計算</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black" style={{ color: 'var(--primary)' }}>{totalBurnedKcal.toLocaleString()}</p>
            <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>kcal</p>
          </div>
        </div>
      )}

      {/* Category selector + AI calorie estimator (shown together on "add" screen) */}
      {showCategories && !selectedExercise && (
        <>
        <div className="rounded-2xl p-5 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-black" style={{ color: 'var(--text)' }}>{t('selectCategory')}</h3>
            <button onClick={() => setShowCategories(false)} className="text-sm" style={{ color: 'var(--text-muted)' }}>✕ {t('close')}</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {TRAINING_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCatId(selectedCatId === cat.id ? null : cat.id)}
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-left transition"
                style={{
                  border: `2px solid ${selectedCatId === cat.id ? 'var(--primary)' : 'var(--border)'}`,
                  backgroundColor: selectedCatId === cat.id ? 'var(--accent-light)' : 'transparent',
                }}
              >
                <Image src={cat.image} alt={cat.name} width={48} height={48} className="w-12 h-12 object-contain shrink-0" />
                <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{catDisplayName(cat)}</p>
              </button>
            ))}
          </div>
          {selectedCat && (
            <div className="mt-4">
              <p className="font-bold text-sm mb-2" style={{ color: 'var(--text-muted)' }}>{t('selectExercise')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {exercises.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => { setSelectedExercise(ex); setSets([{ weight: '', reps: '', memo: '' }]); setShowCustomInput(false) }}
                    className="text-left px-4 py-3 rounded-xl text-sm font-medium transition hover:opacity-80"
                    style={{ backgroundColor: 'var(--accent-light)', color: 'var(--text)' }}
                  >
                    {ex}
                  </button>
                ))}
                {/* その他（自由入力） */}
                {!showCustomInput ? (
                  <button
                    onClick={() => setShowCustomInput(true)}
                    className="text-left px-4 py-3 rounded-xl text-sm font-medium transition hover:opacity-80"
                    style={{ backgroundColor: 'var(--accent-light)', color: 'var(--primary)', fontWeight: 'bold' }}
                  >
                    {t('otherCustom')}
                  </button>
                ) : (
                  <div className="sm:col-span-2 flex gap-2 items-center">
                    <input
                      autoFocus
                      type="text"
                      placeholder={t('exerciseName')}
                      value={customExercise}
                      onChange={(e) => setCustomExercise(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && customExercise.trim()) {
                          setSelectedExercise(customExercise.trim())
                          setSets([{ weight: '', reps: '', memo: '' }])
                        }
                        if (e.key === 'Escape') setShowCustomInput(false)
                      }}
                      className="flex-1 border rounded-xl px-3 py-2 text-sm focus:outline-none"
                      style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
                    />
                    <button
                      onClick={() => {
                        if (customExercise.trim()) {
                          setSelectedExercise(customExercise.trim())
                          setSets([{ weight: '', reps: '', memo: '' }])
                        }
                      }}
                      className="px-4 py-2 rounded-xl text-sm font-bold text-white"
                      style={{ backgroundColor: 'var(--primary)' }}
                    >
                      {t('ok')}
                    </button>
                    <button
                      onClick={() => { setShowCustomInput(false); setCustomExercise('') }}
                      className="px-3 py-2 rounded-xl text-sm"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* AI calorie estimator (inside add screen) */}
        <div className="rounded-2xl shadow-sm overflow-hidden mt-3" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
          <button
            onClick={() => setAiOpen((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-4 text-left"
          >
            <div>
              <span className="font-black text-sm flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
                {characterId
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={getCharacterImageUrl(characterId, 'normal')} alt="" className="w-5 h-5 object-contain inline-block" />
                  : '🤖'
                }
                AIカロリー相談
              </span>
              <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>フットサル・水泳など記録外の運動を概算</span>
            </div>
            <span className="text-lg" style={{ color: 'var(--text-muted)' }}>{aiOpen ? '▲' : '▼'}</span>
          </button>
          {aiOpen && (
            <div className="px-5 pb-5 space-y-3">
              <div>
                <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>種目名 *</label>
                <input
                  type="text"
                  placeholder="例: フットサル、水泳、バスケ"
                  value={aiActivity}
                  onChange={(e) => setAiActivity(e.target.value)}
                  className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>
              <div>
                <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>時間 *</label>
                <input
                  type="text"
                  placeholder="例: 60分、1時間30分"
                  value={aiDuration}
                  onChange={(e) => setAiDuration(e.target.value)}
                  className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>
              <div>
                <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>詳細・強度（任意）</label>
                <input
                  type="text"
                  placeholder="例: 激しい試合、のんびりペース、インターバルあり"
                  value={aiDetail}
                  onChange={(e) => setAiDetail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAskAI() }}
                  className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>
              <button
                onClick={handleAskAI}
                disabled={aiLoading || !aiActivity.trim() || !aiDuration.trim()}
                className="w-full py-3 rounded-xl text-sm font-bold text-white transition disabled:opacity-50"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                {aiLoading ? '計算中…' : '消費カロリーを計算する'}
              </button>
              {aiAnswer && (
                <div>
                  <div className="rounded-xl p-4 text-sm whitespace-pre-wrap mb-3" style={{ backgroundColor: 'var(--bg)', color: 'var(--text)', lineHeight: 1.8 }}>
                    {aiAnswer}
                  </div>
                  <button
                    onClick={handleSaveAiResult}
                    disabled={aiSaving || aiSaved}
                    className="w-full py-3 rounded-xl text-sm font-bold text-white transition disabled:opacity-50"
                    style={{ backgroundColor: aiSaved ? '#22C55E' : 'var(--accent)' }}
                  >
                    {aiSaved ? '✅ 保存しました' : aiSaving ? '保存中…' : '📥 この結果を記録に保存する'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        </>
      )}

      {/* Set input form */}
      {selectedExercise && (() => {
        const isAiRecord = sets.length > 0 && sets[0].reps === 'ai_kcal'
        return (
          <div className="rounded-2xl p-5 shadow-sm overflow-hidden" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
            <div className="flex justify-between items-center mb-1">
              <h3 className="font-black text-lg truncate pr-4" style={{ color: 'var(--text)' }}>{selectedExercise}</h3>
              <button onClick={resetForm} className="text-sm shrink-0" style={{ color: 'var(--text-muted)' }}>✕ {t('cancel')}</button>
            </div>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>{isAiRecord ? 'AI推定' : catStoreName}</p>
            {isAiRecord ? (
              <div className="space-y-3 mb-4">
                <div>
                  <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>時間</label>
                  <input
                    type="text"
                    placeholder="例: 3時間、90分"
                    value={sets[0].memo ?? ''}
                    onChange={(e) => setSets([{ ...sets[0], memo: e.target.value }])}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)', fontSize: '16px' }}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>消費カロリー (kcal)</label>
                  <input
                    type="number"
                    placeholder="例: 1540"
                    value={sets[0].weight ?? ''}
                    onChange={(e) => setSets([{ ...sets[0], weight: e.target.value }])}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)', fontSize: '16px' }}
                  />
                </div>
                {exerciseMemo && (
                  <div>
                    <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>AI計算詳細</label>
                    <div
                      className="rounded-lg px-3 py-2 text-xs whitespace-pre-wrap"
                      style={{ backgroundColor: 'var(--bg)', color: 'var(--text-muted)', border: '1px solid var(--border)', lineHeight: 1.7 }}
                    >
                      {exerciseMemo}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {sets.map((set, i) => (
                    <div key={i} className="flex gap-2 items-center w-full">
                      <span className="text-xs font-bold w-10 shrink-0 text-center" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
                      <input type="number" placeholder={isCardio ? '時間 (分)' : 'kg'} value={set.weight}
                        onChange={(e) => setSets((prev) => prev.map((s, j) => j === i ? { ...s, weight: e.target.value } : s))}
                        className="min-w-0 flex-1 border rounded-lg px-3 py-2 focus:outline-none"
                        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', fontSize: '16px' }}
                      />
                      {(!isCardio || distanceUnit !== null) && (
                        <input type="number" placeholder={isCardio ? `距離 (${distanceUnit})` : 'reps'} value={set.reps}
                          onChange={(e) => setSets((prev) => prev.map((s, j) => j === i ? { ...s, reps: e.target.value } : s))}
                          className="min-w-0 flex-1 border rounded-lg px-3 py-2 focus:outline-none"
                          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', fontSize: '16px' }}
                        />
                      )}
                      {sets.length > 1 && (
                        <button onClick={() => setSets((prev) => prev.filter((_, j) => j !== i))} className="text-red-400 text-sm px-1 shrink-0">✕</button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setSets((prev) => [...prev, { weight: '', reps: '', memo: '' }])}
                  className="text-sm font-bold mt-3 mb-4"
                  style={{ color: 'var(--primary)' }}
                >
                  {t('addSet')}
                </button>
                <textarea
                  placeholder="メモ（例：次回は重量を増やす）"
                  value={exerciseMemo}
                  onChange={(e) => setExerciseMemo(e.target.value)}
                  rows={2}
                  className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none resize-none mb-3"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
                />
              </>
            )}
            <button
              onClick={handleSaveSet}
              disabled={saving}
              className="w-full py-3 rounded-xl font-bold text-white transition disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {saving ? t('saving') : t('save')}
            </button>
          </div>
        )
      })()}

      {/* Training records */}
      {!selectedExercise && !showCategories && trainings.length === 0 && (
        <button
          onClick={() => setShowCategories(true)}
          className="w-full rounded-2xl p-12 text-center shadow-sm transition hover:opacity-80"
          style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <p className="text-5xl mb-3">🏋️</p>
          <p className="font-bold" style={{ color: 'var(--text-muted)' }}>{t('addTraining')}</p>
        </button>
      )}

      {trainings.length > 0 && !selectedExercise && !showCategories && (
        <div className="space-y-3">
          {trainings.map((tr) => (
            <div key={tr.id} className="rounded-2xl p-4 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-black" style={{ color: 'var(--text)' }}>{tr.exercise}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{tr.category}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleEdit(tr)} className="px-3 py-1 rounded-lg text-xs font-bold text-white" style={{ backgroundColor: 'var(--accent)' }}>{t('edit')}</button>
                  <button onClick={() => handleDelete(tr.id)} className="px-3 py-1 rounded-lg text-xs font-bold text-white bg-red-400">{t('del')}</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {tr.sets.map((s, i) => {
                  const isAiRecord = s.reps === 'ai_kcal'
                  const cat = TRAINING_CATEGORIES.find((c) => c.name === tr.category || c.jaName === tr.category)
                  const isCardioRecord = cat?.id === 'cardio'
                  const unit = cardioDistanceUnit(tr.exercise)
                  return (
                    <span key={i} className="text-xs px-2 py-1 rounded-lg font-medium" style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>
                      {isAiRecord
                        ? `🤖 AI推定 ${parseInt(s.weight).toLocaleString()} kcal（${s.memo}）`
                        : isCardioRecord
                        ? `${s.weight ? `${s.weight}分` : ''}${s.reps ? ` ${s.reps}${unit}` : ''}`
                        : `Set ${i + 1}: ${s.weight}kg × ${s.reps}reps`}
                    </span>
                  )
                })}
              </div>
              {tr.memo && (
                <p className="text-xs mt-2 px-1" style={{ color: 'var(--text-muted)' }}>📝 {tr.memo}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
