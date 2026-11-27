'use client'

import { useState, useEffect, useMemo, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { CharacterId, ExpressionId, CHARACTERS, getCharacterImageUrl } from '@/lib/characters'
import { getCachedResult, setCachedResult, readRawCacheEntry, parseCacheEntry } from '@/lib/characterMessageCache'
import { subscribeToInFlight, isRequestInFlight, getOrCreateCharacterMessageRequest, DashboardAiContext } from '@/lib/characterMessageRequest'

type Props = {
  characterId: CharacterId
  mobile?: boolean
  expression?: ExpressionId
  aiContext?: DashboardAiContext
}

function todayDateId(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

// Request/dedup logic (fetch, in-flight Map, notify/subscribe) lives in
// @/lib/characterMessageRequest -- extracted to a plain .ts file (Phase 1D)
// specifically so it can be runtime-tested with node:test + a mocked
// fetch, which is not possible for logic defined inside this .tsx file.
// See that module's own comment for the "why" behind the dedup Map.

// react-hooks/set-state-in-effect: this effect used to call setAiMessage
// (and setLoading) synchronously in its body. Both are now derived instead
// of being separate imperative state:
//
// - the current cache entry for `cacheKey` is observed via
//   useSyncExternalStore reading the raw localStorage string (a stable
//   primitive) and parsed with the exact same pure parseCacheEntry() the
//   real getCachedResult() uses internally -- no TTL/parse logic
//   duplicated, and safe to call during render (no localStorage writes
//   happen here; expired-entry cleanup still only happens from the effect,
//   exactly matching the previous timing).
// - `loading` is observed via useSyncExternalStore reading
//   isRequestInFlight(cacheKey) from the same dedup Map the effect already
//   used, notified by getOrCreateCharacterMessageRequest itself. This
//   means both getServerSnapshot values are the same "nothing yet" state
//   the component always rendered first in the original implementation
//   (server: no cache reflected, no request in flight), so the very first
//   client render still matches SSR exactly as before -- no new hydration
//   mismatch, and no loading-text flash for what turns out to be a cache
//   hit, exactly like the original behavior.
// - the async fetch result is stored tagged with the exact cacheKey it was
//   fetched for, so a response for an old character/day can never be
//   displayed after characterId/aiContext changes to a new key.
//
// The effect itself now only ever calls getCachedResult() (a plain read,
// with its existing expired-entry cleanup side effect preserved) to decide
// whether to skip fetching, and attaches real async completion handlers.
// No setState call remains directly in the effect body.
export default function CharacterSidebar({ characterId, mobile = false, expression: expressionProp, aiContext }: Props) {
  const char = CHARACTERS[characterId]
  // SSRとclient初回renderで同じ値になるよう、フォールバックは常に配列の先頭
  // （決定的な値）を使う。乱数はサーバーとクライアントで異なる結果を返し、
  // React hydration error #418の原因になるため、render中には使用しない。
  const fallbackExpression = useMemo(() => expressionProp ?? 'normal', [expressionProp])
  const fallbackMessage = useMemo(() => char.defaultMessages[0], [char])

  const cacheKey = aiContext ? `dashboard_${characterId}_${todayDateId()}` : null

  const [fetchedResult, setFetchedResult] = useState<{ key: string; message: string; expression?: ExpressionId } | null>(null)

  // Cache exception remediation: getSnapshot must never throw during render.
  // readRawCacheEntry() (characterMessageCache.ts) is the single safe-read
  // path -- it catches a blocked/unavailable Storage access exception and
  // returns null (cache miss) instead of letting it escape here.
  const rawCacheSnapshot = useSyncExternalStore(
    subscribeToCacheNoop,
    () => (cacheKey ? readRawCacheEntry(cacheKey) : null),
    () => null
  )
  const cacheParsed = useMemo(() => parseCacheEntry(rawCacheSnapshot), [rawCacheSnapshot])

  const loading = useSyncExternalStore(
    subscribeToInFlight,
    () => (cacheKey ? isRequestInFlight(cacheKey) : false),
    () => false
  )

  useEffect(() => {
    if (!aiContext || !cacheKey) return
    if (getCachedResult(cacheKey)) return

    let cancelled = false
    getOrCreateCharacterMessageRequest(cacheKey, characterId, aiContext)
      .then((result) => {
        if (cancelled || !result) return
        setCachedResult(cacheKey, result.message, result.expression)
        setFetchedResult({ key: cacheKey, message: result.message, expression: result.expression })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [characterId, aiContext, cacheKey])

  const effectiveResult =
    fetchedResult && cacheKey && fetchedResult.key === cacheKey
      ? fetchedResult
      : cacheParsed.status === 'hit' && cacheKey
        ? { key: cacheKey, ...cacheParsed.result }
        : null

  // AI表情 > 親から渡された表情 > ランダム
  const expression = effectiveResult?.expression ?? fallbackExpression
  const displayMessage = effectiveResult?.message ?? fallbackMessage
  const imageUrl = getCharacterImageUrl(characterId, expression)

  if (mobile) {
    return (
      <div className="rounded-2xl p-4 flex items-center gap-3" style={{ backgroundColor: char.bgColor, border: `1px solid ${char.accentColor}40` }}>
        <div className="w-14 h-14 flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={char.name} className="w-full h-full object-contain" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs font-black" style={{ color: char.accentColor }}>{char.name}</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>/ {char.role}</span>
          </div>
          <p className="text-xs font-bold leading-snug" style={{ color: 'var(--text)' }}>
            {loading ? '...' : displayMessage}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
      {/* キャラ画像 */}
      <div className="w-full flex items-end justify-center pt-4 px-4" style={{ backgroundColor: char.bgColor, minHeight: 180 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={char.name}
          className="w-full object-contain"
          style={{ maxHeight: 200 }}
        />
      </div>

      {/* Info */}
      <div className="p-4">
        <p className="text-xs font-bold mb-0.5" style={{ color: char.accentColor }}>{char.role}</p>
        <p className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>{char.name}</p>
        <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: char.bgColor }}>
          <p className="text-xs font-bold leading-relaxed" style={{ color: 'var(--text)' }}>
            &ldquo;{loading ? '考え中...' : displayMessage}&rdquo;
          </p>
        </div>
        <Link href="/profile" className="block text-center text-xs font-bold py-2 rounded-xl transition hover:opacity-80"
          style={{ color: char.accentColor, backgroundColor: char.bgColor }}>
          キャラを変える →
        </Link>
      </div>
    </div>
  )
}

// Stable no-op subscribe for the cache-raw-string store: our own successful
// fetch already updates the display via the tagged `fetchedResult` state
// (which takes precedence over the store-derived value for the exact key it
// was fetched for), so this store never needs to react to our own writes.
// Matches the same no-op-subscribe reasoning already used in
// ThemeProvider/CookieConsent for other localStorage-derived, non-live
// values.
function subscribeToCacheNoop() {
  return () => {}
}
