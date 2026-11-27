export type BlogDbRow = {
  slug: string
  title: string
  description: string
  category: string
  published_at: string
  reading_minutes: number
  content: string
  og_image: string | null
}

/**
 * Distinguishes a genuine "no rows" result from a Supabase/network/PostgREST
 * failure. A failure must throw rather than fall back to an empty array —
 * otherwise a DB outage during ISR revalidation would cache an empty listing
 * as if it were correct. Throwing lets Next.js keep serving the last good
 * cache instead. The message is fixed and non-sensitive; the raw Supabase
 * error is intentionally not included or logged.
 */
export function parseAllPostsResult(result: { data: BlogDbRow[] | null; error: unknown }): BlogDbRow[] {
  if (result.error) {
    throw new Error('Failed to load blog posts')
  }
  return result.data ?? []
}

/**
 * Same distinction as parseAllPostsResult, for a single-post lookup.
 * maybeSingle() also populates `error` (not just null data) when more than
 * one row matches, which must throw rather than be treated as "not found".
 */
export function parsePostBySlugResult(result: { data: BlogDbRow | null; error: unknown }): BlogDbRow | undefined {
  if (result.error) {
    throw new Error('Failed to load blog post')
  }
  return result.data ?? undefined
}
