'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Props = {
  onDismiss: () => void
}

export default function GoalAchievedModal({ onDismiss }: Props) {
  const router = useRouter()
  const [targetDate, setTargetDate] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!targetDate) return
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }

    await supabase.from('profiles').upsert({
      user_id: user.id,
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
        className="rounded-2xl p-6 w-full max-w-sm shadow-2xl"
        style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div className="text-4xl mb-3 text-center">🎉</div>
        <h2 className="text-lg font-black mb-2 text-center" style={{ color: 'var(--text)' }}>
          目標日に到達しました！
        </h2>
        <p className="text-sm text-center mb-5" style={{ color: 'var(--text-muted)' }}>
          お疲れさまでした。次の目標日を設定して、引き続き頑張りましょう！
        </p>

        <div className="mb-5">
          <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>
            次の目標達成日
          </label>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
          />
        </div>

        <button
          onClick={handleSave}
          disabled={!targetDate || saving}
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
