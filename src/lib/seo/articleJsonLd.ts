/**
 * `dateModified` priority: a valid `updatedAt` first, else the (valid)
 * `publishedAt`. The `blogs` table has no `updated_at` column today (see
 * scripts/migrate-blogs.mjs's documented schema), so `updatedAt` is always
 * undefined in practice and this always falls back to `publishedAt` — never
 * the current time or the build time. If `updated_at` tracking is added to
 * the schema later, passing it through here picks it up automatically with
 * no change to this function.
 */
export function resolveDateModified(
  updatedAt: string | null | undefined,
  publishedAt: string
): string {
  if (updatedAt) {
    const parsed = new Date(updatedAt)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  const published = new Date(publishedAt)
  return Number.isNaN(published.getTime()) ? publishedAt : published.toISOString()
}

export type ArticleJsonLdInput = {
  canonicalUrl: string
  headline: string
  description: string
  imageUrl: string
  datePublished: string
  /** Already resolved (see resolveDateModified) — this function does no fallback of its own. */
  dateModified: string
  /** Real article category only; omit the field entirely when absent, never a placeholder. */
  articleSection?: string | null
  /** Real tags/keywords only (e.g. the category); omit when there is nothing real to report. */
  keywords?: readonly string[] | null
  /** @id of the sitewide Organization entity (see siteJsonLd.ts) — passed in rather than imported so this stays a standalone pure function. */
  organizationId: string
  /** @id of the sitewide WebSite entity (see siteJsonLd.ts). */
  websiteId: string
}

export function buildArticleJsonLd(input: ArticleJsonLdInput) {
  const keywords = input.keywords ? Array.from(new Set(input.keywords)).filter(Boolean) : []

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${input.canonicalUrl}#article`,
    url: input.canonicalUrl,
    headline: input.headline,
    description: input.description,
    image: input.imageUrl,
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    mainEntityOfPage: { '@type': 'WebPage', '@id': input.canonicalUrl },
    ...(input.articleSection ? { articleSection: input.articleSection } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
    author: { '@type': 'Organization', '@id': input.organizationId },
    publisher: { '@type': 'Organization', '@id': input.organizationId },
    isPartOf: { '@type': 'WebSite', '@id': input.websiteId },
  }
}
