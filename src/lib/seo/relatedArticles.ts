/**
 * Same-category related articles for a single post, excluding the post
 * itself. Pure — takes the `allPosts` array a caller already fetched (e.g.
 * for prev/next navigation) rather than querying again; using this never
 * introduces a new Supabase call. `allPosts` is expected in the order
 * getAllPosts() returns it (published_at DESC), so "up to maxCount" is
 * naturally the most recent same-category articles first — intentionally
 * simple, no scoring/ranking algorithm.
 *
 * Generic over T (rather than importing BlogPost from src/lib/blog.ts) so
 * this file has no `@/` imports, matching staticSitemapEntries.ts's own
 * documented reason for the same choice: it can be exercised directly in
 * tests without pulling in Supabase.
 */
export function getRelatedArticles<T extends { slug: string; category: string }>(
  allPosts: readonly T[],
  currentSlug: string,
  category: string,
  maxCount = 3
): T[] {
  const related: T[] = []
  for (const post of allPosts) {
    if (related.length >= maxCount) break
    if (post.slug === currentSlug) continue
    if (post.category !== category) continue
    related.push(post)
  }
  return related
}
