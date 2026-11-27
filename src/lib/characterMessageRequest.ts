import type { CharacterId } from '@/lib/characters'
import type { CachedResult } from '@/lib/characterMessageCache'

export type DashboardAiContext = {
  weight?: string
  goalWeight?: string
  activeDays?: number
  monthlyIntakeKcal?: number
  monthlyTrainingKcal?: number
  dailyTargetCalories?: number
}

// Phase 1D extraction: this module was previously defined inline inside
// CharacterSidebar.tsx. It is pulled out into its own plain .ts file
// (unchanged logic, only relocated) specifically so the request
// deduplication behavior -- the property most directly tied to
// /api/character-message (and therefore OpenAI) call frequency -- can be
// exercised by node:test with a mocked fetch, which is not possible for
// logic living inside a .tsx file (Node's runtime TypeScript support does
// not handle JSX).
//
// Dashboard mounts a PC and a mobile CharacterSidebar at the same time,
// both with the same cacheKey. Without this, they would fire two
// independent /api/character-message requests and the server's same-user
// concurrency limit (1) would turn one of them into a 429. This
// module-scope map lets concurrent callers for the same cacheKey share one
// in-flight request.
const inFlightCharacterMessages = new Map<string, Promise<CachedResult | null>>()
const inFlightListeners = new Set<() => void>()

function notifyInFlightChange() {
  for (const listener of inFlightListeners) listener()
}

/** Subscribes to in-flight-request changes for any key. Used by CharacterSidebar's useSyncExternalStore-derived `loading`. */
export function subscribeToInFlight(listener: () => void): () => void {
  inFlightListeners.add(listener)
  return () => {
    inFlightListeners.delete(listener)
  }
}

export function isRequestInFlight(cacheKey: string): boolean {
  return inFlightCharacterMessages.has(cacheKey)
}

export async function requestCharacterMessage(
  characterId: CharacterId,
  aiContext: DashboardAiContext
): Promise<CachedResult | null> {
  const res = await fetch('/api/character-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterId, page: 'dashboard', userData: aiContext }),
  })
  if (!res.ok) return null

  const data = await res.json().catch(() => null)
  if (!data || typeof data.message !== 'string' || data.message.length === 0) return null

  return { message: data.message, expression: data.expression }
}

export function getOrCreateCharacterMessageRequest(
  cacheKey: string,
  characterId: CharacterId,
  aiContext: DashboardAiContext
): Promise<CachedResult | null> {
  const existing = inFlightCharacterMessages.get(cacheKey)
  if (existing) return existing

  const request = requestCharacterMessage(characterId, aiContext).finally(() => {
    inFlightCharacterMessages.delete(cacheKey)
    notifyInFlightChange()
  })
  inFlightCharacterMessages.set(cacheKey, request)
  notifyInFlightChange()
  return request
}

/**
 * Test-only: clears in-flight request/listener state between test cases.
 * Never called by application runtime code (not imported by
 * CharacterSidebar.tsx).
 */
export function __resetInFlightRequestsForTests(): void {
  inFlightCharacterMessages.clear()
  inFlightListeners.clear()
}
