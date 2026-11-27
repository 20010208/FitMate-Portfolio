import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getAllPosts } from '@/lib/blog'
import BlogClient from './BlogClient'
import BlogListSkeleton from './BlogListSkeleton'

export const metadata: Metadata = {
  title: 'ブログ | 筋トレ・ダイエット・食事管理の情報 | FitMate',
  description: '筋トレ・ダイエット・食事管理に役立つ情報を発信しています。PFCバランスの計算方法、コンビニ高タンパク食品まとめなど、フィットネスに関する実践的な記事を掲載。',
  openGraph: {
    title: 'ブログ | FitMate',
    description: '筋トレ・ダイエット・食事管理に役立つ情報を発信しています。',
    url: 'https://www.fitmate.run/blog',
  },
  alternates: { canonical: 'https://www.fitmate.run/blog' },
}

export const revalidate = 3600

// Data fetching lives in this nested component (not directly in the page
// body) so the Suspense boundary below stays scoped to /blog's own render
// tree. A file-convention loading.tsx at this segment would instead wrap
// /blog/[slug] too (Next.js applies an ancestor segment's loading.tsx to
// nested dynamic routes), which delays the sibling route's notFound() check
// past the point where the response has already started streaming with a
// 200 status.
async function BlogList() {
  const allPosts = await getAllPosts()
  return <BlogClient allPosts={allPosts} />
}

export default function BlogIndexPage() {
  return (
    <Suspense fallback={<BlogListSkeleton />}>
      <BlogList />
    </Suspense>
  )
}
