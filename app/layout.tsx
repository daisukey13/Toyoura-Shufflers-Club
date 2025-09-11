// app/layout.tsx
import type { Metadata, Viewport } from 'next';
import './globals.css';
import Link from 'next/link';
import AuthCookieSync from './AuthCookieSync';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import {
  FaHome,
  FaTrophy,
  FaUsers,
  FaFlagCheckered,
  FaIdBadge,
  FaUserCircle,
} from 'react-icons/fa';

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

// 最新のログイン状態を反映
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // サーバで認証状態チェック（Server Component では cookie の set/remove が禁止のため try/catch で握り潰す）
  let authed = false;
  try {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          // Server Component の render 中は cookie を変更できないため、ここは失敗しても無視
          set(name: string, value: string, options: CookieOptions) {
            try {
              cookieStore.set({ name, value, ...options });
            } catch {
              /* no-op on server component render */
            }
          },
          remove(name: string, options: CookieOptions) {
            try {
              cookieStore.set({ name, value: '', ...options });
            } catch {
              /* no-op on server component render */
            }
          },
        },
      }
    );
    const { data } = await supabase.auth.getUser();
    authed = !!data.user;
  } catch {
    authed = false;
  }

  const statusRing = authed ? 'ring-2 ring-green-400/70' : 'ring-2 ring-purple-400/60';
  const statusDotClass =
    'absolute -right-0.5 -top-0.5 w-3.5 h-3.5 rounded-full ' +
    (authed
      ? 'bg-green-400 shadow-[0_0_12px_2px_rgba(74,222,128,0.6)]'
      : 'bg-purple-400 shadow-[0_0_12px_2px_rgba(192,132,252,0.6)]');

  const loginStatusHref = authed ? '/mypage' : '/login?redirect=/mypage';

  return (
    <html lang="ja" suppressHydrationWarning>
      <body className="min-h-screen bg-[#2a2a3e] text-gray-100 antialiased">
        {/* クライアント側での Supabase セッション→Cookie 同期 */}
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

              <Link
                href={loginStatusHref}
                prefetch={false}
                className={`relative p-3 sm:p-4 rounded-2xl hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30 ${statusRing}`}
                aria-label={authed ? 'ログイン中' : '未ログイン'}
                title={authed ? 'ログイン中' : '未ログイン'}
              >
                <FaUserCircle className="text-3xl sm:text-4xl" />
                <span className={statusDotClass} />
              </Link>
            </div>
          </nav>
        </header>

        {/* 本文 */}
        <main className="pt-20 sm:pt-24">{children}</main>

        {/* Portals */}
        <div id="modal-root" />
        <div id="mobile-menu-portal" />
      </body>
    </html>
  );
}
