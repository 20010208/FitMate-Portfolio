import type { Metadata } from 'next'
import Link from 'next/link'

const TITLE = '利用規約 | FitMate'
const DESCRIPTION = 'FitMateの利用規約です。サービスをご利用いただく前にお読みください。'
const URL = 'https://www.fitmate.run/terms'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: URL },
  // root layoutのopenGraph/twitterを未定義のまま放置すると、root既定のtitle/description/url
  // （トップページのもの）をこのページがそのまま継承してしまう（オブジェクト単位の上書きの
  // ため、フィールド単位のマージではない）。ページ固有値を明示する。
  openGraph: {
    type: 'website',
    siteName: 'FitMate',
    title: TITLE,
    description: DESCRIPTION,
    url: URL,
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'FitMate' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og-image.png'],
  },
}

export default function TermsPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>
      <header className="px-6 py-4 flex items-center justify-between" style={{ backgroundColor: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
        <Link href="/" className="text-2xl font-black" style={{ color: 'var(--primary)' }}>
          FitMate 💪
        </Link>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-black mb-2" style={{ color: 'var(--text)' }}>利用規約</h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>最終更新日：2026年5月20日</p>

        <div className="space-y-8 text-sm leading-relaxed">

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>1. はじめに</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              本利用規約（以下「本規約」）は、FitMate（以下「当サービス」）の利用条件を定めるものです。ユーザーの皆様は本規約に同意いただいた上でご利用ください。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>2. サービスの内容</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              当サービスは、トレーニング記録・食事管理・体重管理を無料で提供するフィットネス管理アプリです。機能の追加・変更・終了は予告なく行われる場合があります。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>3. アカウント</h2>
            <ul className="list-disc list-inside space-y-1 pl-2" style={{ color: 'var(--text-muted)' }}>
              <li>アカウント登録には正確な情報を提供してください。</li>
              <li>アカウントの管理はユーザー自身の責任で行ってください。</li>
              <li>不正利用が疑われる場合、アカウントを停止することがあります。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>4. 禁止事項</h2>
            <p className="mb-2" style={{ color: 'var(--text-muted)' }}>以下の行為を禁止します。</p>
            <ul className="list-disc list-inside space-y-1 pl-2" style={{ color: 'var(--text-muted)' }}>
              <li>法令または公序良俗に違反する行為</li>
              <li>当サービスのシステムへの不正アクセス・攻撃</li>
              <li>他のユーザーへの迷惑行為</li>
              <li>当サービスの運営を妨害する行為</li>
              <li>虚偽の情報を登録する行為</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>5. 免責事項</h2>
            <ul className="list-disc list-inside space-y-1 pl-2" style={{ color: 'var(--text-muted)' }}>
              <li>当サービスが提供する情報は健康・医療の専門的なアドバイスに代わるものではありません。</li>
              <li>当サービスの利用によって生じた損害について、運営者は責任を負いません。</li>
              <li>システム障害・メンテナンスによるサービス停止について、事前の通知なく実施する場合があります。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>6. 広告の掲載</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              当サービスは Google AdSense 等の広告サービスを利用して広告を掲載しています。広告の内容は当サービスとは独立したものであり、広告主の提供するサービス・商品についての保証は行いません。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>7. 知的財産権</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              当サービスのデザイン・ロゴ・コンテンツに関する知的財産権は運営者に帰属します。無断での複製・転用・二次利用を禁止します。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>8. 規約の変更</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              本規約は必要に応じて変更されることがあります。変更後もサービスをご利用の場合は、変更後の規約に同意したものとみなします。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>9. 準拠法・管轄</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              本規約は日本法に準拠し、紛争が生じた場合は日本の裁判所を専属的合意管轄とします。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>10. お問い合わせ</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              本規約に関するご質問は
              <Link href="/contact" className="underline mx-1" style={{ color: 'var(--primary)' }}>
                お問い合わせページ
              </Link>
              よりご連絡ください。
            </p>
          </section>

        </div>
      </main>

      <footer className="text-center py-6 text-sm mt-8" style={{ backgroundColor: 'var(--secondary)', color: 'rgba(255,255,255,0.6)' }}>
        <div className="flex justify-center gap-4 mb-2 text-xs">
          <Link href="/privacy-policy" className="hover:underline">プライバシーポリシー</Link>
          <Link href="/terms" className="hover:underline">利用規約</Link>
          <Link href="/contact" className="hover:underline">お問い合わせ</Link>
        </div>
        © 2026 FitMate. All rights reserved.
      </footer>
    </div>
  )
}
