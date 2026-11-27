import type { Metadata } from 'next'
import { NO_INDEX_METADATA } from '@/lib/seo/noIndexMetadata'

export const metadata: Metadata = {
  title: 'ログイン・新規登録 | FitMate',
  description: 'FitMateにログイン・新規登録して、トレーニング・食事・体重の記録を始めましょう。',
  ...NO_INDEX_METADATA,
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
