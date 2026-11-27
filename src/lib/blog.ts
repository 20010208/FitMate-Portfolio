import { createClient } from '@supabase/supabase-js'
import { getSupabasePublicKey } from './supabase/publicKey'
import { parseAllPostsResult, parsePostBySlugResult, type BlogDbRow } from './blogResultParser'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    getSupabasePublicKey()
  )
}

export type BlogPost = {
  slug: string
  title: string
  description: string
  category: string
  publishedAt: string
  readingMinutes: number
  content: string
  ogImage?: string
}

function mapPost(row: BlogDbRow): BlogPost {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    category: row.category,
    publishedAt: row.published_at,
    readingMinutes: row.reading_minutes,
    content: row.content,
    ogImage: row.og_image ?? undefined,
  }
}

const SELECT = 'slug, title, description, category, published_at, reading_minutes, content, og_image'

export async function getAllPosts(): Promise<BlogPost[]> {
  const supabase = getSupabase()
  const result = await supabase
    .from('blogs')
    .select(SELECT)
    .eq('is_published', true)
    .order('published_at', { ascending: false })
  return parseAllPostsResult(result).map(mapPost)
}

export async function getPostBySlug(slug: string): Promise<BlogPost | undefined> {
  const supabase = getSupabase()
  const result = await supabase
    .from('blogs')
    .select(SELECT)
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle()
  const row = parsePostBySlugResult(result)
  return row ? mapPost(row) : undefined
}
