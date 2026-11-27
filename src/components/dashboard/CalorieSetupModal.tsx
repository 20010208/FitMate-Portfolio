'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n'

type FitnessGoal = 'lose_weight' | 'maintain' | 'gain_muscle'

const GOAL_OPTIONS: { value: FitnessGoal; icon: string; label: string; desc: string }[] = [
  { value: 'lose_weight', icon: '🔥', label: '体重を減らしたい',   desc: 'カロリー制限・ダイエット向けPFC' },
  { value: 'maintain',    icon: '⚖️', label: '健康維持・引き締め', desc: '週2〜3回運動する人向けPFC' },
  { value: 'gain_muscle', icon: '💪', label: '筋肉をつけたい',     desc: '筋トレ重視・高タンパクPFC' },
]

type Props = {
  onDismiss: () => void
}

export default function CalorieSetupModal({ onDismiss }: Props) {
  const t = useT()
  const router = useRouter()
  const [fitnessGoal, setFitnessGoal] = useState<FitnessGoal | ''>('')
  const [gender, setGender] = useState<'male' | 'female' | ''>('')
  const [targetDate, setTargetDate] = useState('')
  const [saving, setSaving] = useState(false)

  const canSave = !!fitnessGoal && !!gender && !!targetDate

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }

    await supabase.from('profiles').upsert({
      user_id: user.id,
      fitness_goal: fitnessGoal,
      gender,
      target_date: targetDate,
    }, { onConflict: 'user_id' })

    router.refresh()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
    >
      <div
        className="rounded-2xl p-6 w-full max-w-sm shadow-2xl overflow-y-auto"
        style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', maxHeight: '90dvh' }}
      >
        <div className="text-3xl mb-3 text-center">⚡</div>
        <h2 className="text-lg font-black mb-1 text-center" style={{ color: 'var(--text)' }}>
          はじめに目標を設定しよう
        </h2>
        <p className="text-xs text-center mb-5" style={{ color: 'var(--text-muted)' }}>
          あなたの目的に合ったPFCバランスとカロリー目標が自動で設定されます
        </p>

        {/* フィットネスの目的 */}
        <div className="mb-4">
          <label className="text-xs font-bold block mb-2" style={{ color: 'var(--text-muted)' }}>
            フィットネスの目的
          </label>
          <div className="flex flex-col gap-2">
            {GOAL_OPTIONS.map(({ value, icon, label, desc }) => {
              const selected = fitnessGoal === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFitnessGoal(value)}
                  className="w-full rounded-xl px-4 py-3 text-left transition"
                  style={{
                    backgroundColor: selected ? 'var(--accent-light)' : 'var(--bg)',
                    border: `2px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-black" style={{ color: selected ? 'var(--primary)' : 'var(--text)' }}>
                      {icon} {label}
                    </span>
                    {selected && <span className="text-xs font-black" style={{ color: 'var(--primary)' }}>✓</span>}
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{desc}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* 性別 */}
        <div className="mb-4">
          <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>
            {t('gender')}
          </label>
          <div className="flex gap-2">
            {(['male', 'female'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGender(g)}
                className="flex-1 py-2 rounded-xl text-sm font-bold transition"
                style={{
                  backgroundColor: gender === g ? 'var(--primary)' : 'var(--bg)',
                  color: gender === g ? 'white' : 'var(--text)',
                  border: `1px solid ${gender === g ? 'var(--primary)' : 'var(--border)'}`,
                }}
              >
                {t(g)}
              </button>
            ))}
          </div>
        </div>

        {/* 目標達成日 */}
        <div className="mb-5">
          <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>
            {t('targetDaysLabel')}
          </label>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            目標体重をいつまでに達成したいか
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={!canSave || saving}
          className="w-full py-3 rounded-xl font-bold text-white mb-3 transition disabled:opacity-40"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          {saving ? '保存中...' : '設定する'}
        </button>

        <button
          onClick={onDismiss}
          className="w-full py-2 text-sm font-bold"
          style={{ color: 'var(--text-muted)' }}
        >
          後で設定する
        </button>
      </div>
    </div>
  )
}
