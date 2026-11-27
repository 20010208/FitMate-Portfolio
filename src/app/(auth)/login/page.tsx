'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n'
import { getAuthErrorMessageKey } from '@/lib/auth/getAuthErrorMessage'

export const dynamic = 'force-dynamic'

export default function LoginPage() {
  const t = useT()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleEmailLogin = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(t(getAuthErrorMessageKey(error, 'login')))
      } else {
        router.push('/dashboard')
        router.refresh()
      }
    } catch {
      setError(t(getAuthErrorMessageKey(undefined, 'login')))
    }
    setLoading(false)
  }

  const handleGoogleLogin = async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${location.origin}/auth/callback` },
      })
      if (error) setError(t(getAuthErrorMessageKey(error, 'login')))
    } catch {
      setError(t(getAuthErrorMessageKey(undefined, 'login')))
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12" style={{ backgroundColor: 'var(--bg)' }}>
      {/* Logo */}
      <div className="text-center mb-10">
        <div className="text-7xl mb-4">💪</div>
        <h1 className="text-4xl font-black" style={{ color: 'var(--primary)' }}>FitMate</h1>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm rounded-3xl p-8 shadow-xl" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
        <h2 className="text-xl font-black mb-6 text-center" style={{ color: 'var(--text)' }}>{t('loginTitle')}</h2>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleEmailLogin} className="space-y-4">
          <input
            type="email"
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-4 py-3 border rounded-xl text-sm focus:outline-none"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
          />
          <input
            type="password"
            placeholder={t('passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-4 py-3 border rounded-xl text-sm focus:outline-none"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 font-bold text-white rounded-xl transition disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            {loading ? t('loggingIn') : t('loginTitle')}
          </button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('orSeparator')}</span>
          <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }} />
        </div>

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full py-3 border font-bold rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-50 hover:opacity-80"
          style={{ borderColor: 'var(--border)', color: 'var(--text)', backgroundColor: 'var(--bg)' }}
        >
          <span>🌐</span> {t('loginWithGoogle')}
        </button>

        <p className="text-center text-sm mt-6" style={{ color: 'var(--text-muted)' }}>
          {t('noAccount')}{' '}
          <Link href="/signup" className="font-bold hover:underline" style={{ color: 'var(--primary)' }}>
            {t('signUp')}
          </Link>
        </p>
      </div>

      <Link href="/" className="mt-6 text-sm hover:underline" style={{ color: 'var(--text-muted)' }}>
        {t('backToTop')}
      </Link>
    </div>
  )
}
