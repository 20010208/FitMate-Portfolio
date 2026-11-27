const SITE_ORIGIN = 'https://www.fitmate.run'

export const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`
export const WEBSITE_ID = `${SITE_ORIGIN}/#website`

/**
 * Sitewide entities, referenced by @id from page-level JSON-LD (e.g. an
 * article's `publisher`/`isPartOf`) rather than duplicated inline. Only
 * real, currently-true facts: no sameAs (no official SNS accounts wired
 * up), no SearchAction (no site search feature), no address/phone/founder.
 */
export const ORGANIZATION_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': ORGANIZATION_ID,
  name: 'FitMate',
  url: SITE_ORIGIN,
  logo: `${SITE_ORIGIN}/logo.png`,
} as const

export const WEBSITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  url: SITE_ORIGIN,
  name: 'FitMate',
  publisher: { '@id': ORGANIZATION_ID },
  inLanguage: 'ja',
} as const
