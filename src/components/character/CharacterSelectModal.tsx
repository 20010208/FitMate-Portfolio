'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CHARACTER_LIST, CharacterId, getCharacterImageUrl } from '@/lib/characters'

type Props = {
  onSelect: (character: CharacterId) => void
}

export default function CharacterSelectModal({ onSelect }: Props) {
  const [selecting, setSelecting] = useState<CharacterId | null>(null)

  const handleSelect = async (id: CharacterId) => {
    setSelecting(id)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSelecting(null); return }
    await supabase.from('profiles').upsert(
      { user_id: user.id, character: id },
      { onConflict: 'user_id' }
    )
    onSelect(id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-lg rounded-3xl p-6 shadow-2xl" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="text-center mb-6">
          <p className="text-xs font-bold mb-1" style={{ color: 'var(--primary)' }}>FITMATE PARTNER</p>
          <h2 className="text-xl font-black mb-2" style={{ color: 'var(--text)' }}>あなたの目標を教えてください</h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>目標に合った専属パートナーをご紹介します</p>
        </div>

        <div className="space-y-3">
          {CHARACTER_LIST.map((char) => (
            <button
              key={char.id}
              onClick={() => handleSelect(char.id)}
              disabled={selecting !== null}
              className="w-full rounded-2xl p-4 flex items-center gap-4 text-left transition hover:opacity-90 active:scale-[0.98]"
              style={{ backgroundColor: char.bgColor, border: `2px solid ${char.accentColor}`, opacity: selecting && selecting !== char.id ? 0.5 : 1 }}
            >
              <div className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden"
                style={{ backgroundColor: char.bgColor }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={getCharacterImageUrl(char.id, 'normal')} alt={char.name} className="w-full h-full object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-black text-sm" style={{ color: char.accentColor }}>{char.goalLabel}</span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: char.accentColor }}>
                    {char.name}
                  </span>
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{char.goalDescription}</p>
              </div>
              {selecting === char.id && (
                <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0"
                  style={{ borderColor: char.accentColor, borderTopColor: 'transparent' }} />
              )}
            </button>
          ))}
        </div>

        <p className="text-xs text-center mt-4" style={{ color: 'var(--text-muted)' }}>
          ※ あとでプロフィール設定から変更できます
        </p>
      </div>
    </div>
  )
}
