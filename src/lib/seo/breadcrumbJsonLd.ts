const SITE_ORIGIN = 'https://www.fitmate.run'

/**
 * BreadcrumbList for a single blog article: Home > ブログ > (article title).
 * Only built for articles that actually exist — never call this for a
 * missing-slug render.
 */
export function buildArticleBreadcrumbJsonLd(articleTitle: string, canonicalUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_ORIGIN },
      { '@type': 'ListItem', position: 2, name: 'ブログ', item: `${SITE_ORIGIN}/blog` },
      { '@type': 'ListItem', position: 3, name: articleTitle, item: canonicalUrl },
    ],
  }
}
