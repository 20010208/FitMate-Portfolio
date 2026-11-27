'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { BlogPost } from '@/lib/blog'

const CATEGORIES = ['すべて', '食事管理', '筋トレ', 'ダイエット', '栄養', 'ライフスタイル']

export default function BlogClient({ allPosts }: { allPosts: BlogPost[] }) {
  const [activeCategory, setActiveCategory] = useState('すべて')

  const posts = activeCategory === 'すべて'
    ? allPosts
    : allPosts.filter((p) => p.category === activeCategory)

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <p className="text-sm font-bold mb-2" style={{ color: 'var(--primary)' }}>BLOG</p>
        <h1 className="text-3xl font-black mb-3" style={{ color: 'var(--text)' }}>筋トレ・ダイエット・食事管理の情報</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>PFCバランス・カロリー計算・コンビニ飯など、フィットネスに役立つ知識を発信しています。</p>
      </div>

      {/* カテゴリフィルター（クライアント側で即時切り替え） */}
      <div className="flex flex-wrap gap-2 mb-8">
        {CATEGORIES.map((cat) => {
          const isActive = cat === activeCategory
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className="px-4 py-1.5 rounded-full text-sm font-bold transition"
              style={
                isActive
                  ? { backgroundColor: 'var(--primary)', color: '#fff' }
                  : { backgroundColor: 'var(--card)', color: 'var(--text-muted)', border: '1px solid var(--border)' }
              }
            >
              {cat}
            </button>
          )
        })}
      </div>

      {posts.length === 0 ? (
        <p className="text-sm text-center py-16" style={{ color: 'var(--text-muted)' }}>
          このカテゴリの記事はまだありません。
        </p>
      ) : (
        <div className="space-y-6">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="flex flex-col sm:flex-row overflow-hidden rounded-2xl shadow-sm transition hover:shadow-md hover:opacity-95"
              style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
            >
              {post.ogImage && (
                <>
                  <div className="sm:hidden w-full overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={post.ogImage} alt={post.title} className="w-full h-auto block" loading="lazy" />
                  </div>
                  <div className="hidden sm:block flex-shrink-0 w-[374px] overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={post.ogImage} alt={post.title} className="w-full h-auto block" loading="lazy" />
                  </div>
                </>
              )}
              <div className="p-4 sm:p-5 flex flex-col justify-between flex-1 min-w-0">
                <div>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold" style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>
                      {post.category}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      約{post.readingMinutes}分で読める · {post.publishedAt.replace(/-/g, '/')}
                    </span>
                  </div>
                  <h2 className="text-base font-black mb-2 leading-snug line-clamp-2" style={{ color: 'var(--text)' }}>{post.title}</h2>
                  <p className="text-sm leading-relaxed line-clamp-3" style={{ color: 'var(--text-muted)' }}>{post.description}</p>
                </div>
                <p className="mt-3 text-sm font-bold" style={{ color: 'var(--primary)' }}>続きを読む →</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
