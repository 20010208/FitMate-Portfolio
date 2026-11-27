import type { Metadata } from 'next'
import Link from 'next/link'

const TITLE = 'お問い合わせ | FitMate'
const DESCRIPTION = 'FitMateへのお問い合わせページです。ご質問・ご要望はこちらからどうぞ。'
const URL = 'https://www.fitmate.run/contact'

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

export default function ContactPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>
      <header className="px-6 py-4 flex items-center justify-between" style={{ backgroundColor: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
        <Link href="/" className="text-2xl font-black" style={{ color: 'var(--primary)' }}>
          FitMate 💪
        </Link>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-black mb-2" style={{ color: 'var(--text)' }}>お問い合わせ</h1>
        <p className="text-sm mb-10" style={{ color: 'var(--text-muted)' }}>
          FitMate に関するご質問・ご意見・不具合の報告などはこちらからどうぞ。
        </p>

        <div className="rounded-2xl p-8 space-y-6" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
          <div>
            <h2 className="text-base font-black mb-1" style={{ color: 'var(--text)' }}>📧 メールでのお問い合わせ</h2>
            <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
              以下のメールアドレスへお送りください。通常 3 営業日以内にご返信いたします。
            </p>
            <a
              href="mailto:moveworth.app@gmail.com"
              className="inline-block px-5 py-3 rounded-xl font-bold text-sm text-white transition hover:opacity-80"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              moveworth.app@gmail.com
            </a>
          </div>

          <hr style={{ borderColor: 'var(--border)' }} />

          <div>
            <h2 className="text-base font-black mb-2" style={{ color: 'var(--text)' }}>📝 お問い合わせの種類</h2>
            <ul className="text-sm space-y-1 pl-2" style={{ color: 'var(--text-muted)' }}>
              <li>・ 機能に関するご要望・フィードバック</li>
              <li>・ 不具合・エラーの報告</li>
              <li>・ アカウントの削除リクエスト</li>
              <li>・ プライバシーポリシーに関するご質問</li>
              <li>・ その他のお問い合わせ</li>
            </ul>
          </div>

          <hr style={{ borderColor: 'var(--border)' }} />

          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
            <p>※ アカウント削除をご希望の場合は、件名に「アカウント削除依頼」とご記入の上、登録メールアドレスをお知らせください。</p>
          </div>
        </div>

        <div className="mt-8 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
          <Link href="/privacy-policy" className="underline mr-4 hover:opacity-80" style={{ color: 'var(--primary)' }}>
            プライバシーポリシー
          </Link>
          <Link href="/terms" className="underline hover:opacity-80" style={{ color: 'var(--primary)' }}>
            利用規約
          </Link>
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
