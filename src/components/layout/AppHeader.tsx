'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useSearchParams } from 'next/navigation'
import ThemeSelector from './ThemeSelector'
import { useT, TranslationKey } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/client'
import { resolveHeaderAuthState, resolveInitialOrNextUserState, type HeaderAuthState } from '@/lib/auth/resolveHeaderAuthState'
import { createGenerationGuard } from '@/lib/auth/generationGuard'

const NAV_ITEMS: { href: string; labelKey: TranslationKey; icon: string }[] = [
  { href: '/dashboard', labelKey: 'home', icon: '🏠' },
  { href: '/training', labelKey: 'training', icon: '🏋️' },
  { href: '/meal', labelKey: 'meal', icon: '🥗' },
  { href: '/weight', labelKey: 'weight', icon: '⚖️' },
  { href: '/history', labelKey: 'history', icon: '📋' },
  { href: '/blog', labelKey: 'blog', icon: '📰' },
  { href: '/profile', labelKey: 'settings', icon: '⚙️' },
]

// 日付引き継ぎ不要なページ（プロフィール・履歴）
const NO_DATE_PAGES = new Set(['/profile', '/history'])

// useSearchParams()はNext.jsでCSR bailoutを起こすため、Suspense境界の外にある
// コンポーネントで使うとそのSuspense fallbackが表示されてしまう。NavItems全体を
// Suspenseで包むと/blog等のstaticなpageで初回HTMLからnav全体が消えてしまうため、
// このdate監視専用の小さな非表示コンポーネントだけをSuspenseで囲み、他のnav要素
// （ログイン・新規登録リンク等）は初回HTMLに残す。
//
// window.location.searchを直接読む方式（useSyncExternalStore + no-op subscribe）
// ではpathnameが変わらずqueryの`date`だけが変化したケースで再評価が起きず、
// Headerのリンクが古いdateのまま残ってしまうため使わない。useSearchParams()は
// Next.jsのrouter状態を正しく購読するため、pathname不変でのdate変更にも追従する。
function DateParamWatcher({ onChange }: { onChange: (date: string | null) => void }) {
  const searchParams = useSearchParams()
  const date = searchParams.get('date')
  useEffect(() => {
    onChange(date)
  }, [date, onChange])
  return null
}

// 初期値はnull（＝認証状態未確定）にしてサーバー側レンダリングと一致させる
// （hydration mismatch回避）。null の間はNavItemsがLogin/SignUpにもログイン済み
// UIにも倒れないneutral placeholderを描画するため、ログイン済みユーザーが一瞬だけ
// Login/SignUpを見てしまう問題が起きない。ログイン状態はここでのみclient side解決
// し、`(dashboard)/layout.tsx`にはAuthチェックを一切持たせない。これにより/blogと
// /blog/[slug]がcookies()等のdynamic APIへ依存せず、static/ISR cacheの対象になれる。
function useAuthHeaderState(): HeaderAuthState | null {
  const [state, setState] = useState<HeaderAuthState | null>(null)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    const guard = createGenerationGuard()
    // 現在のstateがどのuser idに対応しているかを追跡する。異なるuserへの
    // 切り替えを検出した時点で、nextDisplayedUserState()がnicknameなしの
    // 安全な状態を返すので、profile取得を待たずに即座へ反映する（前userの
    // nicknameが新しいuserのprofile取得完了まで残り続けることを防ぐ）。
    // 同一user（token refresh等）の場合はnullが返り、何も変更しない。
    let displayedUserId: string | null = null
    // getUser()の結果（成功／失敗）と、onAuthStateChangeの最初のイベント
    // （Supabaseが購読時に必ず発火するINITIAL_SESSIONを含む）のうち、実際に
    // 先着した方だけを「初回解決」として扱うためのフラグ。true化後は戻さない。
    let hasResolvedInitial = false

    // 呼び出し時点のgenerationを基準に、profile取得完了時点でまだ最新かどうかを
    // 確認してからのみstateへ反映する。より新しいgetUser()／onAuthStateChangeが
    // 割り込んでいた場合はここで破棄され、古い結果が新しいログイン／ログアウト
    // 状態を上書きすることはない。
    const applyUser = async (user: { id: string } | null, myGeneration: number) => {
      // 初回解決（getUser成功／失敗、またはonAuthStateChangeの最初のイベントの
      // うち先着した方）かどうかで分岐は、resolveInitialOrNextUserState()に
      // 集約している（純粋関数としてresolveHeaderAuthState.test.tsで検証済み）。
      const immediate = resolveInitialOrNextUserState(hasResolvedInitial, displayedUserId, user)
      hasResolvedInitial = true
      if (immediate) {
        displayedUserId = immediate.displayedUserId
        if (!cancelled && guard.isCurrent(myGeneration)) setState(immediate.immediateState)
      }
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('nickname')
        .eq('user_id', user.id)
        .single()
      if (cancelled || !guard.isCurrent(myGeneration)) return
      // profile取得が失敗してもuserは確定しているため、isGuest判定はuser基準の
      // ままにする（nicknameがnullへ落ちるだけで、guest/authenticatedは反転しない）。
      setState(resolveHeaderAuthState(user, profile?.nickname))
    }

    const initialGeneration = guard.next()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled || !guard.isCurrent(initialGeneration)) return
      applyUser(user, initialGeneration)
    }).catch(() => {
      // getUser()自体が失敗した場合も、未確定のままplaceholderを表示し続けず、
      // guestとして安全に解決する。ただしその間に新しいAuth eventが届いていれば
      // guard.isCurrent()がfalseになり、この古い失敗結果は破棄される。
      if (cancelled || !guard.isCurrent(initialGeneration)) return
      applyUser(null, initialGeneration)
    })

    // onAuthStateChangeが渡すsessionをそのまま使い、ここでgetUser()を再実行しない
    // （不要な追加リクエストを避け、コールバックが伝えた最新状態だけを信頼する）。
    // Supabaseは購読直後に必ずINITIAL_SESSIONを発火するため、getUser()より先に
    // ここへ到達した場合はhasResolvedInitial経由でこちらが初回解決になる。
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const myGeneration = guard.next()
      applyUser(session?.user ?? null, myGeneration)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  return state
}

function NavItems({ authState }: { authState: HeaderAuthState | null }) {
  const pathname = usePathname()
  const t = useT()
  // 初期値null（サーバー描画・hydration時と一致、mismatch回避）。マウント後、
  // DateParamWatcherがuseSearchParams()経由で実際のdateを渡してくる。pathname
  // が変わらずqueryのdateだけが変化した場合も、useSearchParams()自体がNext.jsの
  // router状態を購読しているためここへ確実に伝わる。
  const [dateParam, setDateParam] = useState<string | null>(null)

  const buildHref = (base: string) =>
    dateParam && !NO_DATE_PAGES.has(base) ? `${base}?date=${dateParam}` : base

  return (
    <>
      <Suspense fallback={null}>
        <DateParamWatcher onChange={setDateParam} />
      </Suspense>

      {/* Nav links (desktop) */}
      <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={buildHref(item.href)}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold transition ${
                isActive
                  ? 'bg-[var(--primary)] text-white'
                  : 'hover:bg-[var(--nav-hover)]'
              }`}
              style={{ color: isActive ? undefined : 'var(--nav-text)' }}
            >
              {t(item.labelKey)}
            </Link>
          )
        })}
      </nav>

      {/* Right side */}
      <div className="flex items-center gap-3">
        <ThemeSelector />
        {authState === null ? (
          // 認証状態が未確定の間は、ログイン済み・未ログインのどちらにも偏らない
          // neutral placeholderを表示する。プロフィールアイコンと同じ幅・高さを
          // 確保することで、ログイン済みユーザーの多くを占める最終状態への
          // レイアウトシフトを最小限にしつつ、Login/SignUpが一瞬表示されるのを防ぐ。
          <div className="w-8 h-8 rounded-full" style={{ backgroundColor: 'var(--nav-hover)' }} aria-hidden="true" />
        ) : authState.isGuest ? (
          <div className="hidden md:flex gap-2">
            <Link
              href="/login"
              className="px-3 py-1.5 text-sm font-bold transition"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('login')}
            </Link>
            <Link
              href="/signup"
              className="px-3 py-1.5 text-sm font-bold bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-dark)] transition"
            >
              {t('signUp')}
            </Link>
          </div>
        ) : (
          <Link href="/profile" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[var(--primary)] flex items-center justify-center text-white text-sm font-bold">
              👤
            </div>
            {authState.nickname && (
              <span className="text-sm font-bold hidden md:inline" style={{ color: 'var(--text)' }}>{authState.nickname}</span>
            )}
          </Link>
        )}
      </div>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 flex border-t z-50"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', touchAction: 'manipulation' }}
      >
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={buildHref(item.href)}
              className={`flex-1 flex flex-col items-center py-3 gap-1 text-xs font-bold ${
                isActive ? 'text-[var(--primary)]' : 'text-[var(--text-muted)]'
              }`}
              style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
            >
              <span className="text-2xl">{item.icon}</span>
              <span className="text-[10px]">{t(item.labelKey)}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}

export default function AppHeader() {
  const authState = useAuthHeaderState()
  return (
    <header
      className="sticky top-0 z-50 shadow-sm border-b"
      style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
    >
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/dashboard">
          <Image src="/logo.png" alt="FitMate" height={36} width={120} className="object-contain" />
        </Link>

        <NavItems authState={authState} />
      </div>
    </header>
  )
}
