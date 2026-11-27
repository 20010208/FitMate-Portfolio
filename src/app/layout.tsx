import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { GoogleAnalytics } from '@next/third-parties/google';
import CookieConsent from "@/components/ui/CookieConsent";

export const metadata: Metadata = {
  title: { default: 'FitMate | 無料フィットネス管理アプリ', template: '%s' },
  description: 'トレーニング記録・食事管理・体重管理を無料で行えるフィットネスアプリ。PFCバランスやAI写真解析で食事を管理しよう。',
  metadataBase: new URL('https://www.fitmate.run'),
  robots: { index: true, follow: true },
  other: { 'ahrefs-site-verification': 'ec1007f2dea860c8d16a9eee8fbae00a41f258f4535735b56ad62a3e0a7990e6' },
  icons: {
    icon: '/icon.png',
    apple: '/icon.png',
  },
  openGraph: {
    type: 'website',
    siteName: 'FitMate',
    title: 'FitMate | 無料フィットネス管理アプリ',
    description: 'トレーニング記録・食事管理・体重管理を無料で行えるフィットネスアプリ。PFCバランスやAI写真解析で食事を管理しよう。',
    url: 'https://www.fitmate.run',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'FitMate' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FitMate | 無料フィットネス管理アプリ',
    description: 'トレーニング記録・食事管理・体重管理を無料で行えるフィットネスアプリ。PFCバランスやAI写真解析で食事を管理しよう。',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full">
      <body className="min-h-full">
        <ThemeProvider>{children}</ThemeProvider>
        <CookieConsent />
        <GoogleAnalytics gaId="G-QE83NHPT06" />
        <script
          src="https://analytics.ahrefs.com/analytics.js"
          data-key="Zl0u1p6m76R2Ncx5Rptiew"
          async
        />
      </body>
    </html>
  );
}
