import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/blog', '/login', '/signup', '/privacy-policy', '/terms', '/contact', '/dashboard', '/training', '/meal', '/weight', '/history'],
      disallow: ['/profile', '/meal/food-search', '/meal/history', '/meal/custom-items'],
    },
    sitemap: 'https://www.fitmate.run/sitemap.xml',
  }
}
