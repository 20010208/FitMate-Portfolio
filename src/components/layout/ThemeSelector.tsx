'use client'

import { useTheme } from './ThemeProvider'

export default function ThemeSelector() {
  const { dark, toggleDark } = useTheme()

  return (
    <button
      onClick={toggleDark}
      aria-label={dark ? 'ライトモードに切替' : 'ダークモードに切替'}
      className="w-8 h-8 flex items-center justify-center rounded-full transition hover:bg-[var(--nav-hover)]"
    >
      {dark ? '☀️' : '🌙'}
    </button>
  )
}
