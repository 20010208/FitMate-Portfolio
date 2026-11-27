'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { createGenerationGuard } from '@/lib/auth/generationGuard'

// Resolves login state client-side (defaulting to null/unresolved, matching
// what the server renders — no CTA either way) so /blog/[slug] never needs a
// server-side cookies()/auth.getUser() call — that dependency is what forced
// this route into dynamic rendering and defeated its static/ISR caching.
// isGuest: null = not yet resolved (no CTA), true = guest (show CTA),
// false = authenticated (no CTA). Keeping it null until resolved (instead of
// defaulting to true) stops the CTA from flashing for logged-in users while
// getUser() is still in flight.
export default function BlogGuestCta({ children }: { children: React.ReactNode }) {
  const [isGuest, setIsGuest] = useState<boolean | null>(null)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    const guard = createGenerationGuard()

    // 初期getUser()より後にonAuthStateChangeが発火した場合、getUser()の結果が
    // 遅れて解決してもgenerationがずれているため破棄され、古い判定で新しい
    // ログイン／ログアウト状態を上書きすることはない。getUser()自体がreject
    // した場合も同じgenerationチェックを通したうえでguestへ安全に解決する
    // （未処理rejectionを残さず、未確定のまま止まることも防ぐ）。
    const initialGeneration = guard.next()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled || !guard.isCurrent(initialGeneration)) return
      setIsGuest(!user)
    }).catch(() => {
      if (cancelled || !guard.isCurrent(initialGeneration)) return
      setIsGuest(true)
    })

    // onAuthStateChangeが渡すsessionをそのまま使い、ここでgetUser()を再実行しない。
    // INITIAL_SESSIONイベントもこのコールバックで受け取るため、getUser()より
    // 先に届いた場合はgeneration.next()により上のgetUser()側が確実に無効化される。
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      guard.next()
      if (cancelled) return
      setIsGuest(!session?.user)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  if (isGuest !== true) return null
  return <>{children}</>
}
