'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Profile } from '@/types'
import { useT } from '@/lib/i18n'
import { CHARACTER_LIST, CharacterId, getCharacterImageUrl } from '@/lib/characters'

type Props = {
  initialProfile: Profile | null
  userEmail: string
}

export default function ProfileClient({ initialProfile, userEmail }: Props) {
  const t = useT()
  const [name, setName] = useState(initialProfile?.name ?? '')
  const [nickname, setNickname] = useState(initialProfile?.nickname ?? '')
  const [height, setHeight] = useState(initialProfile?.height ?? '')
  const [goalWeight, setGoalWeight] = useState(initialProfile?.goal_weight ?? '')
  const [birthday, setBirthday] = useState(initialProfile?.birthday ?? '')
  const [gender, setGender] = useState<'male' | 'female' | ''>(initialProfile?.gender ?? '')
  const [targetDate, setTargetDate] = useState(initialProfile?.target_date ?? '')
  const [character, setCharacter] = useState<CharacterId | null>(initialProfile?.character ?? null)
  const [fitnessGoal, setFitnessGoal] = useState<'lose_weight' | 'maintain' | 'gain_muscle'>(initialProfile?.fitness_goal ?? 'maintain')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const router = useRouter()

  const handleSave = async () => {
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }

    await supabase.from('profiles').upsert({
      user_id: user.id,
      name,
      nickname: nickname || null,
      height,
      goal_weight: goalWeight,
      birthday: birthday || null,
      gender: gender || null,
      target_date: targetDate || null,
      character: character || null,
      fitness_goal: fitnessGoal,
    }, { onConflict: 'user_id' })

    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    setSaving(false)
    router.refresh()
  }

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* Page title */}
      <h1 className="text-2xl font-black" style={{ color: 'var(--text)' }}>Profile ⚙️</h1>

      {/* User email */}
      <div className="rounded-2xl p-4 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
        <p className="text-xs font-bold mb-1" style={{ color: 'var(--text-muted)' }}>{t('email')}</p>
        <p className="font-bold" style={{ color: 'var(--text)' }}>{userEmail}</p>
      </div>

      {/* Profile form */}
      <div className="rounded-2xl p-5 shadow-sm space-y-4" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
        <h3 className="font-black" style={{ color: 'var(--text)' }}>{t('profile')}</h3>
        <div>
          <label className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{t('name')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('name')}
            className="w-full border rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
          />
        </div>
        <div>
          <label className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{t('nickname')}</label>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={t('nickname')}
            className="w-full border rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
          />
        </div>
        <div>
          <label className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{t('birthday')}</label>
          <input
            type="date"
            value={birthday}
            onChange={(e) => setBirthday(e.target.value)}
            className="w-full border rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{t('heightLabel')}</label>
            <input
              type="number"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              placeholder="170"
              className="w-full border rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
            />
          </div>
          <div>
            <label className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{t('goalWeightLabel')}</label>
            <input
              type="number"
              step="0.1"
              value={goalWeight}
              onChange={(e) => setGoalWeight(e.target.value)}
              placeholder="65.0"
              className="w-full border rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{t('gender')}</label>
          <div className="flex gap-2 mt-1">
            {(['male', 'female'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGender(gender === g ? '' : g)}
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
        <div>
          <label className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{t('targetDaysLabel')}</label>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="w-full border rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
          />
        </div>
        <div>
          <label className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>フィットネスの目的</label>
          <p className="text-xs mb-2 mt-0.5" style={{ color: 'var(--text-muted)' }}>PFCバランスの目標値が自動で変わります</p>
          <div className="flex flex-col gap-2">
            {([
              { value: 'lose_weight',  label: '体重を減らしたい',    icon: '🔥', desc: 'タンパク質 ×1.2 / 脂質 ×0.7 / 炭水化物 ×3' },
              { value: 'maintain',     label: '健康維持・引き締め',  icon: '⚖️', desc: 'タンパク質 ×1.6 / 脂質 ×0.8 / 炭水化物 ×4' },
              { value: 'gain_muscle',  label: '筋肉をつけたい',      icon: '💪', desc: 'タンパク質 ×2.0 / 脂質 ×0.8 / 炭水化物 ×5' },
            ] as const).map(({ value, label, icon, desc }) => {
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
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 rounded-xl font-bold text-white transition disabled:opacity-50"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          {saved ? t('profileSaved') : saving ? t('saving') : t('saveProfile')}
        </button>
      </div>

      {/* キャラクター設定 */}
      <div className="rounded-2xl p-5 shadow-sm space-y-3" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
        <h3 className="font-black" style={{ color: 'var(--text)' }}>FitMateパートナー</h3>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>一緒に頑張るパートナーを選んでください</p>
        <div className="space-y-2">
          {CHARACTER_LIST.map((char) => {
            const selected = character === char.id
            return (
              <button
                key={char.id}
                type="button"
                onClick={() => setCharacter(char.id)}
                className="w-full rounded-xl p-3 flex items-center gap-3 text-left transition"
                style={{
                  backgroundColor: selected ? char.bgColor : 'var(--bg)',
                  border: `2px solid ${selected ? char.accentColor : 'var(--border)'}`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getCharacterImageUrl(char.id, 'normal')}
                  alt={char.name}
                  className="w-10 h-10 object-contain flex-shrink-0"
                />
                <div>
                  <p className="text-sm font-black" style={{ color: selected ? char.accentColor : 'var(--text)' }}>
                    {char.name}
                    <span className="text-xs font-normal ml-1" style={{ color: 'var(--text-muted)' }}>/ {char.role}</span>
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{char.goalLabel}・{char.goalDescription}</p>
                </div>
                {selected && <span className="ml-auto text-sm font-black" style={{ color: char.accentColor }}>✓</span>}
              </button>
            )
          })}
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2.5 rounded-xl font-bold text-white text-sm transition disabled:opacity-50"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          {saved ? '保存しました！' : saving ? '保存中...' : 'パートナーを保存'}
        </button>
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full py-3 rounded-xl font-bold transition hover:opacity-80"
        style={{ border: '2px solid #f87171', color: '#f87171', backgroundColor: 'transparent' }}
      >
        {t('logout')}
      </button>
    </div>
  )
}
