import type { MetadataRoute } from 'next'

const SITE_ORIGIN = 'https://www.fitmate.run'

/**
 * Parses a value into a Date only if it's genuinely a valid date. Never
 * falls back to "now" — a missing or invalid value means "no real
 * modification date is known", which callers should treat as "omit
 * lastModified" rather than guessing at one.
 */
export function parseValidSitemapDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

/**
 * The latest of several possibly-invalid/missing date values, ignoring
 * invalid ones and independent of input order. Returns undefined only when
 * none of the inputs are valid dates (e.g. there are no published posts).
 */
export function getLatestPublishedDate(
  dates: readonly (string | null | undefined)[]
): Date | undefined {
  let latest: Date | undefined
  for (const value of dates) {
    const parsed = parseValidSitemapDate(value)
    if (parsed && (!latest || parsed.getTime() > latest.getTime())) {
      latest = parsed
    }
  }
  return latest
}

/**
 * The non-blog, Supabase-free portion of the sitemap. Kept in its own module
 * (no `@/` imports) so it can be exercised directly in tests without pulling
 * in Supabase via src/lib/blog.ts. /login and /signup are intentionally
 * absent: they're noindex (see src/lib/seo/noIndexMetadata.ts) and shouldn't
 * be submitted for indexing.
 *
 * None of these pages have a real "last modified" data source in this
 * codebase, so `lastModified` is omitted for all of them except /blog,
 * which reflects the latest published article date when one is known
 * (passed in by src/app/sitemap.ts, which already fetches the posts).
 * Never the current time or the build time — see parseValidSitemapDate.
 */
export function getStaticSitemapEntries(blogLastModified?: Date): MetadataRoute.Sitemap {
  return [
    { url: SITE_ORIGIN, changeFrequency: 'weekly', priority: 1.0 },
    {
      url: `${SITE_ORIGIN}/blog`,
      ...(blogLastModified ? { lastModified: blogLastModified } : {}),
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    { url: `${SITE_ORIGIN}/privacy-policy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_ORIGIN}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_ORIGIN}/contact`, changeFrequency: 'yearly', priority: 0.4 },
  ]
}
