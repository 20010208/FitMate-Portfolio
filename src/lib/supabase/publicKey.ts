// クライアント・サーバー双方から利用される公開キー解決ヘルパー。
// Supabaseの公開接続にはPublishable Keyのみを使用する。Legacy anon keyへのフォールバックは行わない。
// 管理キー（Secret Key / Service Role Key）はここに置かない。
export function getSupabasePublicKey(): string {
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '').trim()

  if (!key) {
    throw new Error('Supabase publishable key is missing. Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.')
  }

  return key
}
