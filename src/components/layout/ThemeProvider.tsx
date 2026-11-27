'use client'

import { createContext, useContext, useEffect, useSyncExternalStore } from 'react'
import { FITMATE_DARK_STORAGE_KEY, shouldBeDarkAtHour, readSavedDarkPreference } from '@/lib/themePreference'

function applyDark(isDark: boolean) {
  document.documentElement.setAttribute('data-dark', isDark ? 'true' : 'false')
}

const ThemeContext = createContext<{
  dark: boolean
  toggleDark: () => void
}>({ dark: false, toggleDark: () => {} })

// react-hooks/set-state-in-effect (Phase 1E): the mount effect used to call
// setDark(initial) synchronously in its body. `dark` is now derived instead
// of being independent React state:
//
// - the effective theme is observed via useSyncExternalStore, reading the
//   saved preference (readSavedDarkPreference(), from @/lib/themePreference
//   -- the same safe, never-throwing helper used both here and in tests) and
//   falling back to the clock-based shouldBeDarkAtHour() when nothing is
//   saved. This is a pure, side-effect-free computation safe to call during
//   render.
// - the server snapshot is a fixed `false`, reproducing the exact SSR/
//   first-client-render value the original `useState(false)` always
//   produced -- so the very first client render still matches SSR exactly
//   (no new hydration mismatch), and the pre-existing flash-of-light-theme
//   characteristic on load/reload is preserved unchanged, not fixed here.
// - a tiny module-scope listener registry (subscribeTheme/notifyThemeChange)
//   replaces the direct setDark() calls: toggleDark() and the 06:00/19:00
//   auto-reset both write to localStorage and then call notifyThemeChange()
//   instead of setting state directly, so useSyncExternalStore re-renders
//   with the freshly-derived value. A real subscription (not a no-op) is
//   used here, unlike CharacterSidebar's cache store, because there is no
//   separate "tagged result" state to take precedence -- localStorage is the
//   only source of truth for the saved preference, so the store must
//   actually react to its own writes to stay correct.
// - DOM synchronization (`data-dark`) is a separate effect keyed on the
//   derived `dark` value: it only calls applyDark(dark), never a React state
//   setter, which is exactly what react-hooks/set-state-in-effect's own
//   guidance allows ("update external systems with the latest state from
//   React").
//
// No setState call remains directly in any effect body.
const themeListeners = new Set<() => void>()

function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener)
  return () => {
    themeListeners.delete(listener)
  }
}

function notifyThemeChange() {
  for (const listener of themeListeners) listener()
}

function getThemeSnapshot(): boolean {
  const saved = readSavedDarkPreference()
  if (saved !== null) return saved === 'true'
  return shouldBeDarkAtHour(new Date().getHours())
}

function getServerThemeSnapshot(): boolean {
  return false
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const dark = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot)

  useEffect(() => {
    applyDark(dark)
  }, [dark])

  useEffect(() => {
    // 毎分チェック：6:00 / 19:00 の切り替えタイミングで強制切替
    const interval = setInterval(() => {
      const now = new Date()
      const h = now.getHours()
      const m = now.getMinutes()
      if (m === 0 && (h === 6 || h === 19)) {
        localStorage.removeItem(FITMATE_DARK_STORAGE_KEY)
        notifyThemeChange()
      }
    }, 60_000)

    return () => clearInterval(interval)
  }, [])

  const toggleDark = () => {
    const next = !dark
    localStorage.setItem(FITMATE_DARK_STORAGE_KEY, String(next))
    notifyThemeChange()
  }

  return (
    <ThemeContext.Provider value={{ dark, toggleDark }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
