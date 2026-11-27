'use client'

import Link from 'next/link'
import { useT } from '@/lib/i18n'

type Variant = 'default' | 'after-save' | 'ai'

type Props = {
  onClose: () => void
  variant?: Variant
}

export default function SignupPromptModal({ onClose, variant = 'default' }: Props) {
  const t = useT()

  const icon = variant === 'after-save' ? '✅' : variant === 'ai' ? '🤖' : '🔒'
  const title = variant === 'after-save' ? t('recordedTitle') : variant === 'ai' ? t('aiAnalysisRequired') : t('signupRequired')
  const desc = variant === 'after-save' ? t('recordedDesc') : variant === 'ai' ? t('aiAnalysisDesc') : t('signupDesc')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-6">
      <div className="rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="text-5xl mb-4">{icon}</div>
        <h2 className="text-xl font-black mb-2" style={{ color: 'var(--text)' }}>{title}</h2>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>{desc}</p>
        <div className="space-y-3">
          <Link
            href="/signup"
            className="block w-full py-3 font-bold rounded-xl text-white transition hover:opacity-80"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            {t('signupFree')}
          </Link>
          <Link
            href="/login"
            className="block w-full py-3 font-bold rounded-xl transition hover:opacity-80"
            style={{ border: '1px solid var(--border)', color: 'var(--text)', backgroundColor: 'var(--bg)' }}
          >
            {t('loginBtn')}
          </Link>
          <button
            onClick={onClose}
            className="text-sm hover:opacity-70 transition"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('skipSignup')}
          </button>
        </div>
      </div>
    </div>
  )
}
