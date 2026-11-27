'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'

const CONSENT_KEY = 'cookie_consent'

// react-hooks/set-state-in-effect: reading localStorage and calling
// setState synchronously in a mount effect is flagged. useSyncExternalStore
// is React's own hydration-safe mechanism for exactly this "read
// client-only mutable state" case: React renders using getServerSnapshot()
// for both the server render and the client's very first (hydration) pass
// so the two match, then React itself -- not userland effect code --
// re-checks getSnapshot() and re-renders if the real client value differs.
// No manual setState-in-effect is needed.
//
// No cross-tab/live update is needed here (the previous effect-based
// version also only ever read localStorage once, at mount), so subscribe
// is a stable no-op.
function subscribeToConsent() {
  return () => {}
}

function getConsentSnapshot() {
  return localStorage.getItem(CONSENT_KEY)
}

// The server render (and thus the client's first hydration pass) must
// match: this component always rendered with the banner hidden on first
// render before (initial useState(false)), so getServerSnapshot returns
// the same "already accepted" sentinel value accept() writes. That keeps
// server HTML and initial client hydration consistent; only after React's
// built-in snapshot correction reads the real client-side localStorage
// value does the banner appear when consent is actually absent.
function getConsentServerSnapshot() {
  return '1'
}

export default function CookieConsent() {
  const storedConsent = useSyncExternalStore(subscribeToConsent, getConsentSnapshot, getConsentServerSnapshot)
  const [dismissedThisSession, setDismissedThisSession] = useState(false)
  const visible = !storedConsent && !dismissedThisSession

  const accept = () => {
    localStorage.setItem(CONSENT_KEY, '1')
    setDismissedThisSession(true)
  }

  if (!visible) return null

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 px-4 py-4 shadow-lg"
      style={{ backgroundColor: 'var(--card)', borderTop: '1px solid var(--border)' }}
    >
      <div className="max-w-2xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <p className="text-xs flex-1" style={{ color: 'var(--text-muted)' }}>
          当サイトは Google Analytics および Google AdSense のために Cookie を使用しています。
          詳しくは
          <Link href="/privacy-policy" className="underline mx-1" style={{ color: 'var(--primary)' }}>
            プライバシーポリシー
          </Link>
          をご覧ください。
        </p>
        <button
          onClick={accept}
          className="flex-shrink-0 px-5 py-2 rounded-xl text-sm font-bold text-white transition hover:opacity-80"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          同意する
        </button>
      </div>
    </div>
  )
}
