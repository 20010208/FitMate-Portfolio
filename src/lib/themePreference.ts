/**
 * Phase 1E (react-hooks/set-state-in-effect fix for ThemeProvider) extraction:
 * the pure, testable primitives behind the dark-mode preference. This module
 * owns ONLY:
 *   - the storage key constant
 *   - the clock-based auto dark/light determination
 *   - a safe (never-throwing) raw read of the saved preference
 *
 * It deliberately does NOT write/remove storage, mutate the DOM, create
 * listeners, or touch the network -- those remain ThemeProvider.tsx's
 * responsibility. This module exists specifically so the logic that used to
 * be inline inside ThemeProvider's effect body can be covered by real
 * node:test runtime tests (a .tsx file containing JSX cannot be imported by
 * Node's runtime TypeScript support -- same reason characterMessageCache.ts/
 * characterMessageRequest.ts were extracted in Phase 1D).
 */

/** localStorage key for the saved dark-mode preference. Unchanged from the original inline `'fitmate-dark'` literal. */
export const FITMATE_DARK_STORAGE_KEY = 'fitmate-dark'

/**
 * Clock-based auto theme: dark during 19:00-05:59, light during 06:00-18:59.
 * Preserves the exact original `shouldBeDark()` condition
 * (`h >= 19 || h < 6`), only parameterized by an explicit hour so it is
 * directly unit-testable without mocking the global Date/timezone.
 */
export function shouldBeDarkAtHour(hour: number): boolean {
  return hour >= 19 || hour < 6
}

/**
 * Safe (never-throwing) raw read of the saved preference string.
 *
 * - No `window` (SSR): returns null.
 * - `localStorage.getItem` throwing (Storage blocked/unavailable): returns
 *   null instead of propagating the exception. This is required because
 *   this helper is called from ThemeProvider's useSyncExternalStore
 *   getSnapshot, which runs during render -- an uncaught throw there would
 *   crash rendering (the exact class of regression fixed for CharacterSidebar
 *   in Phase 1D's cache-exception remediation).
 * - Otherwise returns the exact raw string stored (or null if absent), with
 *   NO interpretation of its value -- callers decide what a given raw value
 *   means. In particular, any non-null value other than the literal string
 *   'true' still means "light" to callers that compare `=== 'true'`; this
 *   helper does not add any validation that would change that behavior.
 */
export function readSavedDarkPreference(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(FITMATE_DARK_STORAGE_KEY)
  } catch {
    return null
  }
}
