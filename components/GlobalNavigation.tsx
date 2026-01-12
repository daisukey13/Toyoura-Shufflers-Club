// components/GlobalNavigation.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase'; // ← 指定どおり
import {
  FaHome,
  FaUsers,
  FaTrophy,
  FaGamepad,
  FaShieldAlt,
  FaUser,
  FaBars,
  FaTimes,
  FaSignInAlt,
  FaSignOutAlt,
  FaPlus,
  FaIdCard,
} from 'react-icons/fa';

// ★ハンドル名の正規化（register と同じ思想：前後空白/全角空白/連続空白吸収）
function normalizeHandleName(s: string) {
  return (s ?? '')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type HandleLoginApiResponse =
  | { ok: true; player_id: string; is_admin: boolean; session: { access_token: string; refresh_token: string } }
  | { ok: false; message: string };

export default function GlobalNavigation() {
  const { user, player, isAdmin, signOut, refreshAuth, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // ログインモーダル関連
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [handleName, setHandleName] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // 初回マウント時に認証状態を更新
  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  // デバッグ用
  useEffect(() => {
    console.log('GlobalNavigation - user:', user?.id);
    console.log('GlobalNavigation - player:', player);
    console.log('GlobalNavigation - isAdmin:', isAdmin);
    console.log('GlobalNavigation - loading:', loading);
    console.log('GlobalNavigation - pathname:', pathname);
  }, [user, player, isAdmin, loading, pathname]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);

    try {
      const hn = normalizeHandleName(handleName);
      if (!hn) throw new Error('ハンドルネームを入力してください');

      // ✅ RLS回避：handle_name -> email 解決 & signIn はサーバーAPIで実行
      const res = await fetch('/api/auth/login-handle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle_name: hn, password }),
      });

      const j = (await res.json().catch(() => null)) as HandleLoginApiResponse | null;

      if (!res.ok || !j || j.ok !== true) {
        const msg = (j && 'message' in j && j.message) ? j.message : 'ログインに失敗しました';
        throw new Error(msg);
      }

      // ✅ 返ってきたトークンをブラウザ側にセット（通常のSupabase Authとして成立）
      const { error: se } = await supabase.auth.setSession({
        access_token: j.session.access_token,
        refresh_token: j.session.refresh_token,
      });

      if (se) throw se;

      // AuthContextを更新
      await refreshAuth();

      // モーダルを閉じる
      setShowLoginModal(false);
      setHandleName('');
      setPassword('');

      // リダイレクト処理（従来通り）
      setTimeout(() => {
        if (j.is_admin) {
          router.push('/admin/dashboard');
        } else {
          router.push(`/players/${j.player_id}`);
        }
      }, 100);
    } catch (error: any) {
      console.error('ログインエラー:', error);
      setLoginError(error?.message || 'ログインに失敗しました');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    router.push('/');
  };

  const navItems = [
    { href: '/', icon: FaHome, label: 'ホーム' },
    { href: '/players', icon: FaUsers, label: 'プレイヤー' },
    { href: '/rankings', icon: FaTrophy, label: 'ランキング' },
    { href: '/matches', icon: FaGamepad, label: '試合' },
  ];

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (isMobileMenuOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = 'unset';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isMobileMenuOpen]);

  if (loading) return null;

  return (
    <>
      {/* デスクトップナビゲーション */}
      <nav className="hidden lg:block bg-gray-900/95 backdrop-blur-md border-b border-purple-500/30 sticky top-0 z-50">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            {/* ロゴ・サイト名 */}
            <Link href="/" className="flex items-center gap-3 group">
              <div className="p-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg group-hover:shadow-lg group-hover:shadow-purple-500/30 transition-all">
                <FaGamepad className="text-2xl text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                豊浦シャッフラーズ
              </span>
            </Link>

            {/* ナビゲーションリンク */}
            <div className="flex items-center gap-6">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                    isActive(item.href)
                      ? 'bg-purple-600/20 text-purple-400 border border-purple-500/50'
                      : 'text-gray-300 hover:text-white hover:bg-purple-600/10'
                  }`}
                >
                  <item.icon className="text-lg" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              ))}

              {/* 管理者メニュー */}
              {isAdmin && (
                <Link
                  href="/admin/dashboard"
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                    pathname.startsWith('/admin')
                      ? 'bg-purple-600/20 text-purple-400 border border-purple-500/50'
                      : 'text-gray-300 hover:text-white hover:bg-purple-600/10'
                  }`}
                >
                  <FaShieldAlt className="text-lg" />
                  <span className="font-medium">管理</span>
                </Link>
              )}
            </div>

            {/* ユーザーメニュー */}
            <div className="flex items-center gap-4">
              {user && player ? (
                <>
                  {/* 試合登録ボタン */}
                  <Link
                    href="/matches/register"
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-700 hover:to-emerald-700 transition-all transform hover:scale-105"
                  >
                    <FaPlus className="text-sm" />
                    <span className="font-medium">試合登録</span>
                  </Link>

                  {/* マイページボタン */}
                  <Link
                    href={`/players/${player.id}`}
                    className="flex items-center gap-3 px-4 py-2 rounded-lg bg-gray-800/50 hover:bg-gray-800 transition-all"
                  >
                    <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                      <FaUser className="text-white text-sm" />
                    </div>
                    <span className="text-sm font-medium text-gray-300">{player.display_name}</span>
                  </Link>

                  {/* ログアウトボタン */}
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-red-400 hover:bg-red-600/10 transition-all"
                  >
                    <FaSignOutAlt />
                    <span className="font-medium">ログアウト</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setShowLoginModal(true)}
                  className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all transform hover:scale-105 shadow-lg"
                >
                  <FaSignInAlt />
                  <span className="font-medium">ログイン</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* モバイルナビゲーション */}
      <nav className="lg:hidden bg-gray-900/95 backdrop-blur-md border-b border-purple-500/30 sticky top-0 z-50">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg">
                <FaGamepad className="text-xl text-white" />
              </div>
              <span className="text-lg font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                豊浦SC
              </span>
            </Link>

            <div className="flex items-center gap-3">
              {user && player && (
                <Link
                  href={`/players/${player.id}`}
                  className="w-10 h-10 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center"
                >
                  <FaUser className="text-white text-sm" />
                </Link>
              )}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 text-white hover:bg-purple-600/20 rounded-lg transition-colors"
              >
                {isMobileMenuOpen ? <FaTimes className="text-2xl" /> : <FaBars className="text-2xl" />}
              </button>
            </div>
          </div>
        </div>

        {isMobileMenuOpen && (
          <div className="fixed inset-0 top-16 bg-black/50 z-40">
            <div className="bg-gray-900 h-full overflow-y-auto">
              <div className="container mx-auto px-4 py-6">
                <div className="space-y-2">
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                        isActive(item.href)
                          ? 'bg-purple-600/20 text-purple-400 border border-purple-500/50'
                          : 'text-gray-300 hover:text-white hover:bg-purple-600/10'
                      }`}
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      <item.icon className="text-xl" />
                      <span className="font-medium text-lg">{item.label}</span>
                    </Link>
                  ))}

                  {isAdmin && (
                    <Link
                      href="/admin/dashboard"
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                        pathname.startsWith('/admin')
                          ? 'bg-purple-600/20 text-purple-400 border border-purple-500/50'
                          : 'text-gray-300 hover:text-white hover:bg-purple-600/10'
                      }`}
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      <FaShieldAlt className="text-xl" />
                      <span className="font-medium text-lg">管理</span>
                    </Link>
                  )}

                  <div className="border-t border-purple-500/30 my-4"></div>

                  {user && player ? (
                    <>
                      <Link
                        href="/matches/register"
                        className="flex items-center gap-3 px-4 py-3 rounded-lg bg-gradient-to-r from-green-600 to-emerald-600 text-white"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        <FaPlus className="text-xl" />
                        <span className="font-medium text-lg">試合登録</span>
                      </Link>
                      <Link
                        href={`/players/${player.id}`}
                        className="flex items-center gap-3 px-4 py-3 rounded-lg bg-gray-800/50 hover:bg-gray-800 transition-all"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        <FaIdCard className="text-xl" />
                        <span className="font-medium text-lg">マイページ</span>
                      </Link>
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-red-400 hover:bg-red-600/10 transition-all"
                      >
                        <FaSignOutAlt className="text-xl" />
                        <span className="font-medium text-lg">ログアウト</span>
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        setShowLoginModal(true);
                        setIsMobileMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all"
                    >
                      <FaSignInAlt className="text-xl" />
                      <span className="font-medium text-lg">ログイン</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* ログインモーダル */}
      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowLoginModal(false)} />
          <div className="relative bg-gray-900 rounded-2xl p-8 max-w-md w-full border border-purple-500/30">
            <button
              onClick={() => setShowLoginModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-200"
            >
              <FaTimes />
            </button>

            <h2 className="text-2xl font-bold text-yellow-100 mb-6 text-center">ログイン</h2>

            <form onSubmit={handleLogin} className="space-y-4">
              {loginError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <p className="text-sm text-red-400">{loginError}</p>
                </div>
              )}

              <div>
                <label htmlFor="handle-name" className="block text-sm font-medium text-gray-300 mb-2">
                  ハンドルネーム
                </label>
                <input
                  id="handle-name"
                  name="handle-name"
                  type="text"
                  autoComplete="username"
                  required
                  className="w-full px-4 py-2 rounded-lg bg-gray-800/50 border border-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="ハンドルネーム"
                  value={handleName}
                  onChange={(e) => setHandleName(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                  パスワード
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="w-full px-4 py-2 rounded-lg bg-gray-800/50 border border-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="パスワード"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 py-3 rounded-lg text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:from-purple-700 hover:to-pink-700 transition-all"
              >
                {isLoggingIn ? 'ログイン中...' : 'ログイン'}
              </button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-gray-400">
                アカウントをお持ちでない方は
                <Link href="/register" className="text-purple-400 hover:text-purple-300 ml-1">
                  新規登録
                </Link>
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
