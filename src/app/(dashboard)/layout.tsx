import AppHeader from '@/components/layout/AppHeader'

// このlayoutはCookieやSupabase Authを一切呼び出さない（AppHeaderが自身でclient側解決する）。
// /blog・/blog/[slug]を含むこのroute group配下の全pageがdynamic renderingへ強制されるのを防ぐため。
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>
      <AppHeader />
      <main className="max-w-6xl mx-auto px-4 py-6 pb-24 md:pb-6">
        {children}
      </main>
    </div>
  )
}
