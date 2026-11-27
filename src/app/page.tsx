import type { Metadata } from 'next'
import LandingContent from '@/components/landing/LandingContent'

const TITLE = 'FitMate | 無料筋トレ・ダイエット管理アプリ - カロリー計算・体重記録'
const DESCRIPTION = 'FitMateは筋トレ・ダイエットの管理を無料で行えるアプリ。食事のカロリー計算・PFCバランス管理、体重推移グラフ、トレーニング記録をすべて一元管理。AI写真解析で食事記録も簡単。'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: ['筋トレ アプリ 無料', 'ダイエット アプリ', 'カロリー計算', '体重管理', '食事管理', 'PFCバランス', 'トレーニング記録', 'フィットネスアプリ', 'カロリー管理アプリ', '筋トレ記録'],
  alternates: { canonical: 'https://www.fitmate.run' },
  // root layoutのopenGraph/twitterはNext.jsのmetadata継承でオブジェクト単位で丸ごと
  // 上書きされる（フィールド単位のマージではない）ため、未定義のままだとroot既定の
  // title/descriptionが使われ、上記のページ固有title/descriptionと食い違う。
  openGraph: {
    type: 'website',
    siteName: 'FitMate',
    title: TITLE,
    description: DESCRIPTION,
    url: 'https://www.fitmate.run',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'FitMate' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og-image.png'],
  },
}

const appJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'FitMate',
  applicationCategory: 'HealthApplication',
  operatingSystem: 'Web',
  url: 'https://www.fitmate.run',
  description: '筋トレ・ダイエット管理を無料で行えるフィットネスアプリ。カロリー計算・PFCバランス管理・体重記録・AI食事解析を搭載。',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'JPY' },
  featureList: ['筋トレ・トレーニング記録', '食事管理・カロリー計算', 'PFCバランス管理', '体重・体脂肪率グラフ', 'AI写真解析', 'ダイエット管理'],
}

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'FitMateは無料で使えますか？',
      acceptedAnswer: { '@type': 'Answer', text: 'はい、FitMateは完全無料で使えます。会員登録なしでもゲストとして試すことができます。' },
    },
    {
      '@type': 'Question',
      name: '筋トレの記録はどのようにできますか？',
      acceptedAnswer: { '@type': 'Answer', text: '部位別・種目別にセット数・重量・回数を記録できます。毎回の履歴を確認しながら効率よくトレーニングを管理できます。' },
    },
    {
      '@type': 'Question',
      name: 'ダイエット中のカロリー管理はできますか？',
      acceptedAnswer: { '@type': 'Answer', text: 'はい。朝食・昼食・夕食・間食ごとにカロリーと栄養素（たんぱく質・脂質・炭水化物）を記録できます。AI写真解析を使えば料理の写真を撮るだけで自動入力されます。' },
    },
    {
      '@type': 'Question',
      name: 'スマートフォンで使えますか？',
      acceptedAnswer: { '@type': 'Answer', text: 'iPhone・Androidどちらのブラウザからも快適に使えます。アプリのインストールは不要です。' },
    },
    {
      '@type': 'Question',
      name: '体重の変化をグラフで確認できますか？',
      acceptedAnswer: { '@type': 'Answer', text: '体重・体脂肪率の推移をグラフで可視化できます。目標体重を設定して達成度を確認しながらダイエットを続けられます。' },
    },
  ],
}

export default function LandingPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <LandingContent />
    </>
  )
}
