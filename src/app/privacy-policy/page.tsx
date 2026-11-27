import type { Metadata } from 'next'
import Link from 'next/link'

const TITLE = 'プライバシーポリシー | FitMate'
const DESCRIPTION = 'FitMateのプライバシーポリシーです。個人情報の取り扱いについて説明しています。'
const URL = 'https://www.fitmate.run/privacy-policy'

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

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>
      <header className="px-6 py-4 flex items-center justify-between" style={{ backgroundColor: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
        <Link href="/" className="text-2xl font-black" style={{ color: 'var(--primary)' }}>
          FitMate 💪
        </Link>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-black mb-2" style={{ color: 'var(--text)' }}>プライバシーポリシー</h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>最終更新日：2026年7月24日</p>

        <div className="space-y-8 text-sm leading-relaxed" style={{ color: 'var(--text)' }}>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>1. はじめに</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              FitMate（以下「当サービス」）は、ユーザーの皆様のプライバシーを尊重し、個人情報の保護に努めています。本プライバシーポリシーは、当サービスが収集する情報の種類、利用目的、および取り扱い方法についてご説明するものです。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>2. 収集する情報</h2>
            <p className="mb-2" style={{ color: 'var(--text-muted)' }}>当サービスは以下の情報を収集する場合があります。</p>
            <ul className="list-disc list-inside space-y-1 pl-2" style={{ color: 'var(--text-muted)' }}>
              <li>メールアドレス（アカウント登録時）</li>
              <li>ユーザーが入力した体重・食事・トレーニングのデータ</li>
              <li>目標体重・プロフィール情報</li>
              <li>アクセスログ・利用状況（Google Analytics）</li>
              <li>Cookie および類似の技術により収集されるデータ</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>3. 情報の利用目的</h2>
            <ul className="list-disc list-inside space-y-1 pl-2" style={{ color: 'var(--text-muted)' }}>
              <li>当サービスの提供・運営・改善</li>
              <li>ユーザーサポートの提供</li>
              <li>サービス利用状況の分析</li>
              <li>不正利用の防止・セキュリティの確保</li>
              <li>広告の配信（詳細は「5. 広告について」をご参照ください）</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>4. Cookie（クッキー）について</h2>
            <p className="mb-2" style={{ color: 'var(--text-muted)' }}>
              当サービスは、Cookie を使用してサービスの利便性向上および利用状況の分析を行っています。Cookie はブラウザの設定から無効にすることが可能ですが、一部の機能が利用できなくなる場合があります。
            </p>
            <p style={{ color: 'var(--text-muted)' }}>
              Cookie の利用には Google Analytics および Google AdSense による Cookie が含まれます。これらの Cookie は、広告のパーソナライズやサービス改善のために使用されます。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>5. 広告について</h2>
            <p className="mb-2" style={{ color: 'var(--text-muted)' }}>
              当サービスは Google AdSense を使用して広告を掲載しています。Google はユーザーの興味に基づく広告を表示するために Cookie を使用する場合があります。
            </p>
            <p className="mb-2" style={{ color: 'var(--text-muted)' }}>
              Google による Cookie の利用方法については、
              <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener noreferrer" className="underline ml-1" style={{ color: 'var(--primary)' }}>
                Google の広告に関するポリシー
              </a>
              をご参照ください。
            </p>
            <p style={{ color: 'var(--text-muted)' }}>
              広告のパーソナライズは
              <a href="https://adssettings.google.com/" target="_blank" rel="noopener noreferrer" className="underline ml-1" style={{ color: 'var(--primary)' }}>
                Google 広告設定
              </a>
              からオプトアウトすることができます。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>6. アクセス解析について</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              当サービスは Google Analytics を使用してアクセス解析を行っています。Google Analytics は Cookie を利用してアクセス情報を収集しますが、個人を特定する情報は含まれません。収集されたデータは Google のプライバシーポリシーに基づき管理されます。Google Analytics のデータ収集を無効化したい場合は、
              <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer" className="underline ml-1" style={{ color: 'var(--primary)' }}>
                Google Analytics オプトアウトアドオン
              </a>
              をご利用ください。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>7. AI機能（OpenAI API）について</h2>
            <p className="mb-2" style={{ color: 'var(--text-muted)' }}>
              当サービスのAI食事解析、AIキャラクターメッセージ、トレーニング消費カロリー推定機能では、ユーザーが送信した食事の画像や入力テキストが、解析目的で第三者サービスであるOpenAIのAPIへ送信される場合があります。
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2 mb-2" style={{ color: 'var(--text-muted)' }}>
              <li>送信目的：食事内容の分析、AIキャラクターによるメッセージ生成、運動内容に基づく消費カロリーの推定</li>
              <li>OpenAI APIへ送信した入力・出力は、利用者が別途明示的に共有へ同意しない限り、OpenAIのデフォルトの取り扱いではモデルの学習には使用されません</li>
              <li>不正利用の監視等の目的で、OpenAI側において一定期間データが保持される場合があります</li>
            </ul>
            <p className="mb-2" style={{ color: 'var(--text-muted)' }}>
              データの具体的な保持期間や取り扱いの詳細は変更される場合があるため、最新の内容はOpenAIが公開するデータ利用方針をご参照ください。また、当サービスはOpenAI APIの利用に必要なAPIキーをブラウザ等のクライアント側に公開しない構成としています。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>8. 第三者へのデータ提供</h2>
            <p className="mb-2" style={{ color: 'var(--text-muted)' }}>
              当サービスは、以下の場合を除き、ユーザーの個人情報を第三者に提供しません。
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2" style={{ color: 'var(--text-muted)' }}>
              <li>ユーザーの同意がある場合</li>
              <li>法令に基づく開示が必要な場合</li>
              <li>人命・身体・財産の保護のために必要な場合</li>
            </ul>
            <p className="mt-2" style={{ color: 'var(--text-muted)' }}>
              なお、データの保存には Supabase（米国）のサービスを利用しています。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>9. データの保管と削除</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              ユーザーが登録したデータは、アカウント削除をリクエストするまで保管されます。アカウントの削除をご希望の場合は、お問い合わせページからご連絡ください。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>10. プライバシーポリシーの変更</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              本ポリシーは予告なく変更される場合があります。変更後のポリシーはこのページに掲載し、掲載日をもって効力が発生するものとします。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-black mb-3" style={{ color: 'var(--text)' }}>11. お問い合わせ</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              本ポリシーに関するご質問は
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
