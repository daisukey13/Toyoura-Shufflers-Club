// app/layout.tsx
import type { Metadata, Viewport } from 'next';
import './globals.css';
import Link from 'next/link';

import AuthCookieSync from './AuthCookieSync';
import LoginStatusIcon from './LoginStatusIcon';

import { FaHome, FaTrophy, FaUsers, FaFlagCheckered, FaIdBadge } from 'react-icons/fa';
import InteractionRecovery from '@/components/system/InteractionRecovery';

export const metadata: Metadata = {
  title: 'Toyoura Shufflers Club',
  description: 'Toyoura Shufflers Club – ランキング・試合・メンバー情報',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#111827',
};

//（残してOK：ログイン状態をクライアントで即反映したい意図なら）
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const year = new Date().getFullYear();

  return (
    <html lang="ja" suppressHydrationWarning>
      {/* ✅ footerを最下部に置くため flex-col */}
      <body className="min-h-screen bg-[#2a2a3e] text-gray-100 antialiased flex flex-col">
        {/* クライアント側で Supabase セッション→Cookie 同期（軽量） */}
        <AuthCookieSync />

        {/* ヘッダー（アイコンのみ） */}
        <header className="fixed inset-x-0 top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-black/35 bg-black/40 border-b border-white/10">
          <nav className="mx-auto max-w-6xl px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
            {/* 左：ホーム */}
            <Link
              href="/"
              prefetch={false}
              className="relative p-3 sm:p-4 rounded-2xl hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30"
              aria-label="ホーム"
              title="ホーム"
            >
              <FaHome className="text-3xl sm:text-4xl" />
            </Link>

            {/* 中央：ランキング / メンバー / 試合結果 */}
            <div className="flex items-center gap-2 sm:gap-3">
              <Link
                href="/rankings"
                prefetch={false}
                className="p-3 sm:p-4 rounded-2xl hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30"
                aria-label="ランキング"
                title="ランキング"
              >
                <FaTrophy className="text-3xl sm:text-4xl" />
              </Link>

              <Link
                href="/players"
                prefetch={false}
                className="p-3 sm:p-4 rounded-2xl hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30"
                aria-label="メンバー"
                title="メンバー"
              >
                <FaUsers className="text-3xl sm:text-4xl" />
              </Link>

              <Link
                href="/matches"
                prefetch={false}
                className="p-3 sm:p-4 rounded-2xl hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30"
                aria-label="試合結果"
                title="試合結果"
              >
                <FaFlagCheckered className="text-3xl sm:text-4xl" />
              </Link>
            </div>

            {/* 右：マイページ / ログイン状況 */}
            <div className="flex items-center gap-2 sm:gap-3">
              <Link
                href="/mypage"
                prefetch={false}
                className="relative p-3 sm:p-4 rounded-2xl hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30"
                aria-label="マイページ"
                title="マイページ"
              >
                <FaIdBadge className="text-3xl sm:text-4xl" />
              </Link>

              {/* ここだけクライアントで whoami 判定（UIは同じ） */}
              <LoginStatusIcon />
            </div>
          </nav>
        </header>

        {/* 本文 */}
        <main className="pt-20 sm:pt-24 flex-1">{children}</main>

        {/* ✅ フッター（最小：既存デザインに馴染むガラス表現） */}
        <footer className="border-t border-white/10 bg-black/25 backdrop-blur supports-[backdrop-filter]:bg-black/20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 sm:items-center sm:justify-between">
              <div className="text-xs sm:text-sm text-gray-300">
                <div className="font-semibold text-yellow-100">Toyoura Shufflers Club</div>
                <div className="text-gray-400 mt-1">© {year} Toyoura Shufflers Club</div>
              </div>

              <div className="flex items-center gap-3 sm:gap-4 text-xs sm:text-sm">
                <Link href="/terms" prefetch={false} className="text-gray-300 hover:text-yellow-100 transition-colors">
                  利用規約
                </Link>
                <span className="text-white/15">•</span>
                <Link href="/notices" prefetch={false} className="text-gray-300 hover:text-yellow-100 transition-colors">
                  お知らせ
                </Link>
              </div>
            </div>
          </div>
        </footer>

        {/* Interaction recovery（既存挙動維持） */}
        <InteractionRecovery />

        {/* Portals */}
        <div id="modal-root" />
        <div id="mobile-menu-portal" />
      </body>
    </html>
  );
}
