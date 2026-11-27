const BLOG_OG_IMAGE_PATH = '/og-image.png'
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Resolves the social-share image URL for a blog post.
 * Prefers the article's own image when it is a usable http(s) URL
 * (absolute or site-relative); otherwise falls back to FitMate's
 * shared OG image so no article ever ships without a preview image.
 */
export function resolveBlogOgImage(
  articleImage: string | null | undefined,
  siteOrigin: string
): string {
  const fallback = new URL(BLOG_OG_IMAGE_PATH, siteOrigin).toString()

  if (typeof articleImage !== 'string') return fallback

  const trimmed = articleImage.trim()
  if (trimmed.length === 0) return fallback

  try {
    const resolved = new URL(trimmed, siteOrigin)
    return ALLOWED_PROTOCOLS.has(resolved.protocol) ? resolved.toString() : fallback
  } catch {
    return fallback
  }
}
