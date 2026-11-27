import type { Metadata } from 'next'

/**
 * Shared robots directive for authenticated-app routes (dashboard, training,
 * meal, weight, history) that render a public guest view but should never
 * appear in search results. Defines robots only — spread this into a
 * route's own `metadata` object so title/description/canonical stay intact.
 */
export const NO_INDEX_METADATA = {
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
} as const satisfies Metadata
