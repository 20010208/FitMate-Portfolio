import type { Metadata } from 'next'
import Link from 'next/link'
import { NO_INDEX_METADATA } from '@/lib/seo/noIndexMetadata'

// Scoped to /blog/[slug] only. Without this file, Next.js falls back to its
// generic not-found boundary, which injects a bare `noindex` meta tag while
// the inherited root layout metadata still contributes `index, follow` —
// two conflicting robots directives in the same response. Declaring our own
// metadata here makes robots unambiguous for missing article URLs.
export const metadata: Metadata = {
  title: '記事が見つかりません | FitMate',
  ...NO_INDEX_METADATA,
}

export default function BlogArticleNotFound() {
  return (
    <div className="max-w-3xl mx-auto text-center py-16">
      <h1 className="text-2xl font-black mb-4" style={{ color: 'var(--text)' }}>
        記事が見つかりません
      </h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
        お探しの記事は存在しないか、削除された可能性があります。
      </p>
      <Link
        href="/blog"
        className="inline-block px-6 py-3 rounded-xl text-sm font-black text-white transition hover:opacity-80"
        style={{ backgroundColor: 'var(--primary)' }}
      >
        ← ブログ一覧に戻る
      </Link>
    </div>
  )
}
