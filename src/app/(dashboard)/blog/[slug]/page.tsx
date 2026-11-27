import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getAllPosts, getPostBySlug } from '@/lib/blog'
import { getRelatedArticles } from '@/lib/seo/relatedArticles'
import { resolveBlogOgImage } from '@/lib/seo/getBlogOgImage'
import { NO_INDEX_METADATA } from '@/lib/seo/noIndexMetadata'
import { buildArticleJsonLd, resolveDateModified } from '@/lib/seo/articleJsonLd'
import { buildArticleBreadcrumbJsonLd } from '@/lib/seo/breadcrumbJsonLd'
import { ORGANIZATION_JSON_LD, WEBSITE_JSON_LD } from '@/lib/seo/siteJsonLd'
import { toSafeJsonLdString } from '@/lib/seo/safeJsonLd'
import BlogGuestCta from './BlogGuestCta'

const SITE_ORIGIN = 'https://www.fitmate.run'

type Props = { params: Promise<{ slug: string }> }

// blog/page.tsxと同じ1時間。これがないと、公開前に一度requestされたslugの404結果が
// 長期間（デフォルトで実質無期限）cacheされ、その後同じslugで実際に記事が公開されても
// 次回deployまで404のままになり得る（自動生成記事の永続的な非表示を防ぐため必須）。
export const revalidate = 3600

export async function generateStaticParams() {
  const posts = await getAllPosts()
  return posts.map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = await getPostBySlug(slug)
  if (!post) return { ...NO_INDEX_METADATA }
  const ogImageUrl = resolveBlogOgImage(post.ogImage, SITE_ORIGIN)
  return {
    title: `${post.title} | FitMate`,
    description: post.description,
    openGraph: {
      siteName: 'FitMate',
      title: post.title,
      description: post.description,
      url: `https://www.fitmate.run/blog/${post.slug}`,
      type: 'article',
      publishedTime: post.publishedAt,
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: 'summary_large_image',
      images: [ogImageUrl],
    },
    alternates: { canonical: `https://www.fitmate.run/blog/${post.slug}` },
  }
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params
  const post = await getPostBySlug(slug)
  if (!post) notFound()

  const allPosts = await getAllPosts()
  const currentIndex = allPosts.findIndex((p) => p.slug === slug)
  const prevPost = currentIndex > 0 ? allPosts[currentIndex - 1] : null
  const nextPost = currentIndex < allPosts.length - 1 ? allPosts[currentIndex + 1] : null
  // Same-category articles, reusing allPosts (already fetched above) --
  // no additional Supabase query.
  const relatedArticles = getRelatedArticles(allPosts, post.slug, post.category)

  const canonicalUrl = `${SITE_ORIGIN}/blog/${post.slug}`
  const articleImageUrl = resolveBlogOgImage(post.ogImage, SITE_ORIGIN)
  const articleJsonLd = buildArticleJsonLd({
    canonicalUrl,
    headline: post.title,
    description: post.description,
    imageUrl: articleImageUrl,
    datePublished: post.publishedAt,
    // No `updated_at` column exists on `blogs` today, so this always falls
    // back to publishedAt (see resolveDateModified's own comment).
    dateModified: resolveDateModified(undefined, post.publishedAt),
    articleSection: post.category,
    keywords: post.category ? [post.category] : null,
    organizationId: ORGANIZATION_JSON_LD['@id'],
    websiteId: WEBSITE_JSON_LD['@id'],
  })
  const breadcrumbJsonLd = buildArticleBreadcrumbJsonLd(post.title, canonicalUrl)

  return (
    <div className="max-w-3xl mx-auto">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toSafeJsonLdString(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toSafeJsonLdString(breadcrumbJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toSafeJsonLdString(ORGANIZATION_JSON_LD) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toSafeJsonLdString(WEBSITE_JSON_LD) }} />

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs mb-8" style={{ color: 'var(--text-muted)' }}>
        <Link href="/" className="hover:underline">ホーム</Link>
        <span>/</span>
        <Link href="/blog" className="hover:underline">ブログ</Link>
        <span>/</span>
        <span style={{ color: 'var(--text)' }}>{post.title.slice(0, 30)}...</span>
      </nav>

      {/* Article header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold" style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>
            {post.category}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {post.publishedAt.replace(/-/g, '/')} · 約{post.readingMinutes}分で読める
          </span>
        </div>
        <h1 className="text-2xl font-black leading-snug mb-4" style={{ color: 'var(--text)' }}>{post.title}</h1>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{post.description}</p>
      </div>

      {/* CTA top - ゲストのみ表示（client側で判定、詳細はBlogGuestCta参照） */}
      <BlogGuestCta>
        <div className="rounded-2xl p-5 mb-8" style={{ backgroundColor: 'var(--accent-light)', border: '2px solid var(--accent)' }}>
          <p className="font-black text-sm mb-1" style={{ color: 'var(--text)' }}>🏋️ この記事で紹介する管理を無料で始める</p>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>FitMateはPFCバランス・食事・体重・トレーニングをまとめて無料で管理できるアプリです。</p>
          <Link
            href="/signup"
            className="inline-block px-5 py-2 rounded-xl text-sm font-black text-white transition hover:opacity-80"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            無料で始める →
          </Link>
        </div>
      </BlogGuestCta>

      {/* Article content */}
      <article
        className="blog-content"
        dangerouslySetInnerHTML={{ __html: post.content }}
      />

      {/* CTA bottom - ゲストのみ表示（client側で判定、詳細はBlogGuestCta参照） */}
      <BlogGuestCta>
        <div className="rounded-2xl p-6 mt-10 text-center" style={{ backgroundColor: 'var(--primary)' }}>
          <p className="font-black text-lg text-white mb-2">FitMateで今日から食事管理を始めよう</p>
          <p className="text-sm mb-5" style={{ color: 'rgba(255,255,255,0.8)' }}>PFCバランス・カロリー計算・体重記録がすべて無料。AI写真解析で記録も簡単。</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/signup" className="inline-block px-8 py-3 rounded-xl font-black text-sm transition hover:opacity-80 shadow" style={{ backgroundColor: 'var(--card)', color: 'var(--primary)' }}>
              無料アカウントを作成
            </Link>
            <Link href="/dashboard" className="inline-block px-8 py-3 rounded-xl font-bold text-sm border-2 border-white text-white hover:bg-white/10 transition">
              登録なしで試す
            </Link>
          </div>
        </div>
      </BlogGuestCta>

      {/* Prev / Next navigation */}
      <div className="mt-10 grid grid-cols-2 gap-3">
        <div>
          {prevPost && (
            <Link
              href={`/blog/${prevPost.slug}`}
              className="flex flex-col gap-1 rounded-xl p-4 h-full transition hover:opacity-80"
              style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
            >
              <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>← 前の記事</span>
              <span className="text-sm font-black leading-snug line-clamp-2" style={{ color: 'var(--text)' }}>{prevPost.title}</span>
            </Link>
          )}
        </div>
        <div>
          {nextPost && (
            <Link
              href={`/blog/${nextPost.slug}`}
              className="flex flex-col gap-1 rounded-xl p-4 h-full text-right transition hover:opacity-80"
              style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
            >
              <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>次の記事 →</span>
              <span className="text-sm font-black leading-snug line-clamp-2" style={{ color: 'var(--text)' }}>{nextPost.title}</span>
            </Link>
          )}
        </div>
      </div>

      {/* Related articles - same category, excludes this article itself */}
      {relatedArticles.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-black mb-3" style={{ color: 'var(--text)' }}>関連記事</h2>
          <ul className="space-y-2">
            {relatedArticles.map((related) => (
              <li key={related.slug}>
                <Link
                  href={`/blog/${related.slug}`}
                  className="flex flex-col gap-1 rounded-xl p-4 transition hover:opacity-80"
                  style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
                >
                  <span className="text-sm font-black leading-snug" style={{ color: 'var(--text)' }}>{related.title}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {related.category} · {related.publishedAt.replace(/-/g, '/')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Back to blog */}
      <div className="mt-6 text-center">
        <Link href="/blog" className="text-sm font-bold hover:underline" style={{ color: 'var(--text-muted)' }}>
          ← ブログ一覧に戻る
        </Link>
      </div>
    </div>
  )
}
