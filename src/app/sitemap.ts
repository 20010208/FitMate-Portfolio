import type { MetadataRoute } from 'next'
import { getAllPosts } from '@/lib/blog'
import {
  getStaticSitemapEntries,
  getLatestPublishedDate,
  parseValidSitemapDate,
} from '@/lib/seo/staticSitemapEntries'

const SITE_ORIGIN = 'https://www.fitmate.run'

// Same 1-hour policy as /blog and /blog/[slug] (see src/app/(dashboard)/blog).
// Without this, the sitemap has no revalidation at all and stays frozen at
// whatever it looked like at the last deploy — new auto-published articles
// would never appear until the next redeploy.
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getAllPosts()

  const blogPages: MetadataRoute.Sitemap = posts.map((post) => {
    const lastModified = parseValidSitemapDate(post.publishedAt)
    return {
      url: `${SITE_ORIGIN}/blog/${post.slug}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    }
  })

  const blogListingLastModified = getLatestPublishedDate(posts.map((post) => post.publishedAt))

  return [...getStaticSitemapEntries(blogListingLastModified), ...blogPages]
}
