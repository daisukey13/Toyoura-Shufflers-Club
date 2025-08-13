// app/layout.tsx
import type { Metadata, Viewport } from 'next';
import './globals.css';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { ReactNode } from 'react';

// もし AuthContext を使っている場合はプロバイダで全体を囲みます
// （contexts/AuthContext.tsx は 'use client' のコンポーネントである必要があります）
import { AuthProvider } from '@/contexts/AuthContext';

// 必要に応じてフォントを使う場合（未使用なら削除可）
// import { Inter } from 'next/font/google';
// const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Toyoura Shufflers Club',
  description: 'Toyoura Shufflers Club – ランキング・試合・メンバー情報',
  // 必要に応じて追記
  // icons: { icon: '/favicon.ico' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#111827',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      {/* フォントを使うなら body に inter.className を追加 */}
      <body className="min-h-screen bg-[#2a2a3e] text-gray-100 antialiased">
        <AuthProvider>
          {/* ヘッダーは body 直下に必ず配置（モバイルメニューは Header 内で body ポータルへ描画） */}
          <Header />

          {/* 64px (= h-16) のヘッダー高さを考慮して最低高さを確保 */}
          <main className="min-h-[calc(100vh-64px)]">
            {children}
          </main>

          <Footer />

          {/* 将来モーダル等に使うルート（必要なければ削除可） */}
          <div id="modal-root" />
        </AuthProvider>
      </body>
    </html>
  );
}
