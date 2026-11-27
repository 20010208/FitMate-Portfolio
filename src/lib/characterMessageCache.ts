import type { ExpressionId } from '@/lib/characters'

const TTL_MS = 6 * 60 * 60 * 1000 // 6時間

type CacheEntry = { message: string; expression?: ExpressionId; timestamp: number }

export type CachedResult = { message: string; expression?: ExpressionId }

/**
 * Phase 1D (react-hooks/set-state-in-effect fix) 由来の抽出:
 * TTL判定とJSONパースだけを行う純粋関数。localStorageには一切触れない
 * （読み取り・削除ともに呼び出し側の責務）。
 *
 * CharacterSidebar.tsxのuseSyncExternalStoreベースのcache観測が、
 * getCachedResult()と全く同じTTL/パース判定を、render中に安全に
 * （副作用なしで）再利用するために切り出した。TTL定数やJSON.parseの
 * ロジックを2箇所で重複実装しないための単一の真実源とする。
 */
export type CacheParseResult =
  | { status: 'hit'; result: CachedResult }
  | { status: 'expired' }
  | { status: 'absent' }
  | { status: 'malformed' }

/**
 * Cache exception remediation (Codex Medium finding, post-Phase-1D-review):
 * JSON.parse(raw) succeeding does not guarantee `entry` is a plain object --
 * 'null', '[]', '123', '"abc"', 'true' are all valid JSON but not usable
 * CacheEntry shapes. Accessing entry.timestamp on a JSON `null` previously
 * threw a TypeError straight out of parseCacheEntry(), and parseCacheEntry()
 * is called directly from CharacterSidebar's render path (via useMemo, with
 * no surrounding try/catch there), so that throw could crash rendering.
 * This is a real, narrow runtime shape check (not merely a TypeScript cast)
 * -- it does NOT validate individual fields, so an object-shaped entry with
 * a missing timestamp/message still falls through to the exact pre-existing
 * NaN-comparison behavior below, preserving that historical edge case
 * bit-for-bit.
 */
function isPlainCacheEntryShape(value: unknown): value is CacheEntry {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseCacheEntry(raw: string | null): CacheParseResult {
  if (!raw) return { status: 'absent' }
  let entry: unknown
  try {
    entry = JSON.parse(raw)
  } catch {
    return { status: 'malformed' }
  }
  if (!isPlainCacheEntryShape(entry)) return { status: 'malformed' }
  if (Date.now() - entry.timestamp > TTL_MS) return { status: 'expired' }
  return { status: 'hit', result: { message: entry.message, expression: entry.expression } }
}

/** localStorageの実キー文字列を組み立てる。複数箇所での文字列重複を避ける。 */
export function storageKeyFor(key: string): string {
  return `fitmate_char_${key}`
}

/**
 * Cache exception remediation (Codex Medium finding): the single
 * authoritative safe-read path for the raw cache string. localStorage.getItem()
 * can throw (Storage blocked/unavailable -- e.g. some privacy modes, disabled
 * storage policies). getCachedResult() below already caught this via its own
 * try/catch; this helper gives CharacterSidebar's render-time
 * useSyncExternalStore snapshot the same safety without a second,
 * independently-maintained try/catch at that call site. Never throws. Never
 * writes. Never touches any other storage key.
 */
export function readRawCacheEntry(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(storageKeyFor(key))
  } catch {
    return null
  }
}

export function getCachedResult(key: string): CachedResult | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = readRawCacheEntry(key)
    const parsed = parseCacheEntry(raw)
    if (parsed.status === 'hit') return parsed.result
    if (parsed.status === 'expired') {
      localStorage.removeItem(storageKeyFor(key))
    }
    return null
  } catch {
    return null
  }
}

export function setCachedResult(key: string, message: string, expression?: ExpressionId): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(storageKeyFor(key), JSON.stringify({ message, expression, timestamp: Date.now() }))
  } catch {}
}

export function removeCachedResult(key: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(storageKeyFor(key))
  } catch {}
}
