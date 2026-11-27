'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useT } from '@/lib/i18n'

function AppMockup() {
  return (
    <div className="rounded-2xl overflow-hidden shadow-2xl w-full max-w-sm mx-auto" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
      {/* Mini header */}
      <div className="flex items-center justify-between px-3 py-2.5" style={{ backgroundColor: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
        <div className="w-16 h-3 rounded-full" style={{ backgroundColor: 'var(--primary)' }} />
        <div className="flex gap-1">
          {[1, 0.3, 0.3, 0.3, 0.3].map((o, i) => (
            <div key={i} className="w-5 h-2 rounded-sm" style={{ backgroundColor: 'var(--primary)', opacity: o }} />
          ))}
        </div>
      </div>
      {/* Content */}
      <div className="p-3 space-y-2.5">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-1.5">
          {[{ v: '12', l: 'セット' }, { v: '48', l: '回数' }, { v: '720kg', l: '総重量' }].map((s) => (
            <div key={s.l} className="rounded-xl p-2 text-center" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-black" style={{ color: 'var(--primary)' }}>{s.v}</p>
              <p style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{s.l}</p>
            </div>
          ))}
        </div>
        {/* PFC bar */}
        <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
          <p style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: '6px' }}>PFCバランス</p>
          <div className="flex gap-1 h-2 rounded-full overflow-hidden">
            <div className="h-full" style={{ width: '35%', backgroundColor: '#3B82F6', borderRadius: '999px' }} />
            <div className="h-full" style={{ width: '25%', backgroundColor: '#F59E0B', borderRadius: '999px' }} />
            <div className="h-full" style={{ width: '40%', backgroundColor: '#10B981', borderRadius: '999px' }} />
          </div>
          <div className="flex justify-between mt-1.5">
            {[['P', '#3B82F6', '92g'], ['F', '#F59E0B', '41g'], ['C', '#10B981', '185g']].map(([l, c, v]) => (
              <span key={l} style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                <span style={{ color: c, fontWeight: 'bold' }}>{l}</span> {v}
              </span>
            ))}
          </div>
        </div>
        {/* Weight graph */}
        <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
          <p style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: '6px' }}>体重推移</p>
          <svg width="100%" height="36" viewBox="0 0 200 36" preserveAspectRatio="none">
            <defs>
              <linearGradient id="wGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FF6A0D" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#FF6A0D" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon points="0,36 0,30 30,26 60,28 90,22 120,18 150,20 180,15 200,12 200,36" fill="url(#wGrad)" />
            <polyline points="0,30 30,26 60,28 90,22 120,18 150,20 180,15 200,12" fill="none" stroke="#FF6A0D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        {/* AI tag */}
        <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ backgroundColor: 'var(--accent-light)', border: '1px solid var(--border)' }}>
          <span className="text-sm">📸</span>
          <p style={{ fontSize: '9px', color: 'var(--accent)', fontWeight: 'bold' }}>AI写真解析 — 食事を撮るだけで自動記録</p>
        </div>
      </div>
    </div>
  )
}

export default function LandingContent() {
  const t = useT()

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>

      {/* Header */}
      <header className="sticky top-0 z-50 shadow-sm border-b" style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/">
            <Image src="/logo.png" alt="FitMate" height={36} width={120} className="object-contain" />
          </Link>
          <div className="flex gap-2">
            <Link href="/blog" className="px-4 py-2 text-sm font-bold rounded-lg transition hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
              ブログ
            </Link>
            <Link href="/login" className="px-4 py-2 text-sm font-bold rounded-lg transition hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
              {t('login')}
            </Link>
            <Link href="/signup" className="px-4 py-2 text-sm font-bold rounded-lg text-white transition hover:opacity-80" style={{ backgroundColor: 'var(--primary)' }}>
              {t('signUp')}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 pt-14 pb-20 flex flex-col lg:flex-row items-center gap-12">
        {/* Left */}
        <div className="flex-1 text-center lg:text-left">
          <div className="flex flex-wrap gap-2 justify-center lg:justify-start mb-5">
            <span className="px-3 py-1 rounded-full text-xs font-bold text-white" style={{ backgroundColor: 'var(--primary)' }}>完全無料</span>
            <span className="px-3 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>インストール不要</span>
            <span className="px-3 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>AI食事解析搭載</span>
          </div>
          <h1 className="text-4xl lg:text-5xl font-black mb-4 leading-tight" style={{ color: 'var(--text)' }}>
            ジム・食事・体重を<br />
            <span style={{ color: 'var(--primary)' }}>まとめて管理</span>
          </h1>
          <p className="text-base mb-8 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            筋トレのセット・重量を記録し、AI写真解析で食事を管理。<br />
            体重グラフで成果を可視化。すべて無料、今すぐ始められる。
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
            <Link href="/signup" className="px-8 py-4 font-black rounded-xl text-white text-base transition hover:opacity-80 shadow-md" style={{ backgroundColor: 'var(--primary)' }}>
              無料で始める →
            </Link>
            <Link href="/dashboard" className="px-8 py-4 font-bold rounded-xl text-base transition hover:opacity-80" style={{ border: '2px solid var(--border)', color: 'var(--text-muted)', backgroundColor: 'var(--card)' }}>
              登録なしで試す
            </Link>
          </div>
        </div>
        {/* Right: App mockup */}
        <div className="flex-1 w-full">
          <AppMockup />
        </div>
      </section>

      {/* Social proof strip */}
      <section className="border-y" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
        <div className="max-w-6xl mx-auto px-4 py-5 flex flex-wrap justify-center gap-8">
          {[
            { value: '500+', label: '利用ユーザー' },
            { value: '10,000+', label: 'トレーニング記録' },
            { value: '完全無料', label: '全機能' },
            { value: '0秒', label: 'インストール時間' },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-xl font-black" style={{ color: 'var(--primary)' }}>{s.value}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-black text-center mb-3" style={{ color: 'var(--text)' }}>FitMateでできること</h2>
        <p className="text-center mb-12 text-sm" style={{ color: 'var(--text-muted)' }}>フィットネスに必要なすべてが、ひとつのアプリに。</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            { icon: '🏋️', title: 'トレーニング記録', desc: '部位・種目別にセット数・重量・回数を管理。メモ機能で次回の目標も残せる。' },
            { icon: '🥗', title: '食事・カロリー管理', desc: 'PFCバランスをカテゴリ別に記録。AI写真解析で料理写真から自動入力。' },
            { icon: '⚖️', title: '体重グラフ', desc: '体重・体脂肪率の推移をグラフで可視化。目標体重との差もわかる。' },
            { icon: '📅', title: 'カレンダー履歴', desc: 'どの日にトレーニングしたか一目でわかる。継続のモチベーションに。' },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl p-6 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
              <div className="text-4xl mb-3">{f.icon}</div>
              <h3 className="font-black mb-2" style={{ color: 'var(--text)' }}>{f.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why FitMate */}
      <section className="py-16" style={{ backgroundColor: 'var(--card)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-black text-center mb-3" style={{ color: 'var(--text)' }}>なぜFitMateを選ぶのか</h2>
          <p className="text-center mb-12 text-sm" style={{ color: 'var(--text-muted)' }}>他のアプリとここが違う。</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: '📱', title: 'インストール不要', desc: 'ブラウザから即アクセス。iPhone・Androidどちらでもアプリなしで使える。' },
              { icon: '🤖', title: 'AI食事解析', desc: '料理の写真を撮るだけでカロリーとPFCを自動認識。記録の手間が激減。' },
              { icon: '🎯', title: '筋トレ×食事を一元管理', desc: '別々のアプリを使わなくていい。トレーニングも食事も体重もここで完結。' },
              { icon: '💰', title: '完全無料', desc: '全機能が無料で使える。課金要素なし。ゲストで試してから登録もOK。' },
              { icon: '🔒', title: '登録なしで試せる', desc: 'まずゲストとして使ってみて、気に入ったら登録。メアドだけで30秒。' },
              { icon: '🎨', title: 'テーマ切替対応', desc: 'ライト/ダーク、3種類のカラーテーマを搭載。自分好みの見た目で使える。' },
            ].map((item) => (
              <div key={item.title} className="flex gap-4 rounded-2xl p-5 shadow-sm" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div className="text-3xl shrink-0">{item.icon}</div>
                <div>
                  <h3 className="font-black mb-1 text-sm" style={{ color: 'var(--text)' }}>{item.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-black text-center mb-12" style={{ color: 'var(--text)' }}>他サービスとの比較</h2>
        <div className="overflow-x-auto rounded-2xl shadow-sm" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--primary)' }}>
                <th className="text-left px-6 py-4 font-black text-white">機能</th>
                <th className="px-6 py-4 font-black text-white text-center">FitMate</th>
                <th className="px-6 py-4 font-bold text-center" style={{ color: 'rgba(255,255,255,0.75)' }}>あすけん</th>
                <th className="px-6 py-4 font-bold text-center" style={{ color: 'rgba(255,255,255,0.75)' }}>MyFitnessPal</th>
                <th className="px-6 py-4 font-bold text-center" style={{ color: 'rgba(255,255,255,0.75)' }}>Strong</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['筋トレ記録', '✅', '△', '△', '✅'],
                ['食事・カロリー管理', '✅', '✅', '✅', '❌'],
                ['AI写真解析', '✅', '△', '△', '❌'],
                ['体重グラフ', '✅', '✅', '✅', '❌'],
                ['インストール不要（Web）', '✅', '△', '✅', '❌'],
                ['完全無料', '✅', '△', '△', '△'],
                ['日本語対応', '✅', '✅', '✅', '△'],
              ].map(([feature, fitmate, asken, mfp, strong], i) => (
                <tr key={feature} style={{ backgroundColor: i % 2 === 0 ? 'var(--card)' : 'var(--bg)' }}>
                  <td className="px-6 py-3 font-bold" style={{ color: 'var(--text)' }}>{feature}</td>
                  <td className="px-6 py-3 text-center text-base font-black" style={{ color: 'var(--primary)' }}>{fitmate}</td>
                  <td className="px-6 py-3 text-center" style={{ color: 'var(--text-muted)' }}>{asken}</td>
                  <td className="px-6 py-3 text-center" style={{ color: 'var(--text-muted)' }}>{mfp}</td>
                  <td className="px-6 py-3 text-center" style={{ color: 'var(--text-muted)' }}>{strong}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* For whom */}
      <section className="py-16" style={{ backgroundColor: 'var(--card)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-black text-center mb-10" style={{ color: 'var(--text)' }}>こんな人に使ってほしい</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              ['🏋️', '筋トレでバルクアップ・増量したい'],
              ['🥗', 'ダイエットでカロリーを管理したい'],
              ['⚖️', '体重・体脂肪率の変化を記録したい'],
              ['📸', 'AI写真解析で食事記録を楽にしたい'],
            ].map(([icon, text]) => (
              <div key={text} className="flex items-center gap-3 rounded-2xl p-5" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
                <span className="text-2xl">{icon}</span>
                <p className="font-bold text-sm" style={{ color: 'var(--text)' }}>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-2xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-black text-center mb-10" style={{ color: 'var(--text)' }}>{t('faqTitle')}</h2>
        <div className="space-y-4">
          {([
            ['faq1Q', 'faq1A'],
            ['faq2Q', 'faq2A'],
            ['faq3Q', 'faq3A'],
            ['faq4Q', 'faq4A'],
            ['faq5Q', 'faq5A'],
          ] as const).map(([q, a]) => (
            <div key={q} className="rounded-2xl p-5 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
              <p className="font-black text-sm mb-2" style={{ color: 'var(--text)' }}>Q. {t(q)}</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{t(a)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 text-center" style={{ backgroundColor: 'var(--primary)' }}>
        <h2 className="text-2xl font-black mb-2 text-white">今日から無料で始めよう</h2>
        <p className="mb-8 text-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>メールアドレスのみ・30秒で登録完了。</p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/signup" className="inline-block px-10 py-4 font-black rounded-full text-lg transition hover:opacity-80 shadow" style={{ backgroundColor: 'var(--card)', color: 'var(--primary)' }}>
            無料アカウントを作成
          </Link>
          <Link href="/dashboard" className="inline-block px-10 py-4 font-bold rounded-full text-lg border-2 border-white text-white hover:bg-white/10 transition">
            登録なしで試す
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ backgroundColor: 'var(--card)', borderTop: '1px solid var(--border)' }}>
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Image src="/logo.png" alt="FitMate" height={28} width={90} className="object-contain opacity-70" />
            <div className="flex flex-wrap justify-center gap-5 text-sm" style={{ color: 'var(--text-muted)' }}>
              <Link href="/privacy-policy" className="hover:underline">プライバシーポリシー</Link>
              <Link href="/terms" className="hover:underline">利用規約</Link>
              <Link href="/contact" className="hover:underline">お問い合わせ</Link>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>© 2026 FitMate. All rights reserved.</p>
          </div>
        </div>
      </footer>

    </div>
  )
}
