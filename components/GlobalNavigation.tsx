// components/GlobalNavigation.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
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
} from "react-icons/fa";

export default function GlobalNavigation() {
  const { user, player, isAdmin, signOut, refreshAuth, loading } =
    useAuth() as {
      user?: any;
      player?: { id: string; handle_name?: string; display_name?: string };
      isAdmin?: boolean;
      signOut: () => Promise<void>;
      refreshAuth: () => Promise<void> | void;
      loading?: boolean;
    };

  const pathname = usePathname();
  const router = useRouter();

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // ログインモーダル関連（※ ハンドル名ではなくメールでログインに統一）
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string>("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // refreshAuth を安定化して依存警告を回避
  const doRefreshAuth = useCallback(() => {
    if (typeof refreshAuth === "function") {
      return refreshAuth();
    }
  }, [refreshAuth]);

  // 初回マウント時に認証状態を同期（依存に doRefreshAuth を入れる）
  useEffect(() => {
    void doRefreshAuth();
  }, [doRefreshAuth]);

  // ユーザーが存在するのに player がまだ取れていない場合の再同期
  useEffect(() => {
    if (user && !player && !loading) {
      void doRefreshAuth();
    }
  }, [user, player, loading, doRefreshAuth]);

  // ルート変更時にモバイルメニューを閉じる
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  // モバイルメニュー開閉に合わせて body スクロール制御
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileMenuOpen]);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setIsLoggingIn(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password,
      });
      if (error) {
        if (error.message?.toLowerCase().includes("invalid login")) {
          throw new Error("メールまたはパスワードが正しくありません");
        }
        throw error;
      }
      await doRefreshAuth();
      setShowLoginModal(false);
      setEmail("");
      setPassword("");

      // ログイン後の遷移（管理者はダッシュボード、一般はマイページ）
      setTimeout(() => {
        if (isAdmin) {
          router.push("/admin/dashboard");
        } else if (player?.id) {
          router.push(`/players/${player.id}`);
        } else {
          router.push("/mypage"); // 最低限のフォールバック
        }
      }, 50);
    } catch (err: any) {
      setLoginError(err?.message || "ログインに失敗しました");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    router.push("/");
  };

  const navItems = [
    { href: "/", icon: FaHome, label: "ホーム" },
    { href: "/players", icon: FaUsers, label: "プレイヤー" },
    { href: "/rankings", icon: FaTrophy, label: "ランキング" },
    { href: "/matches", icon: FaGamepad, label: "試合" },
  ];

  // ローディング中は描画を抑止（チラつき回避）
  if (loading) return null;

  return (
    <>
      {/* デスクトップナビ */}
      <nav className="hidden lg:block bg-gray-900/95 backdrop-blur-md border-b border-purple-500/30 sticky top-0 z-50">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            {/* ロゴ */}
            <Link href="/" className="flex items-center gap-3 group">
              <div className="p-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg group-hover:shadow-lg group-hover:shadow-purple-500/30 transition-all">
                <FaGamepad className="text-2xl text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                豊浦シャッフラーズ
              </span>
            </Link>

            {/* ナビリンク */}
            <div className="flex items-center gap-6">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                    isActive(item.href)
                      ? "bg-purple-600/20 text-purple-400 border border-purple-500/50"
                      : "text-gray-300 hover:text-white hover:bg-purple-600/10"
                  }`}
                >
                  <item.icon className="text-lg" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              ))}

              {/* 管理 */}
              {isAdmin && (
                <Link
                  href="/admin/dashboard"
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                    pathname.startsWith("/admin")
                      ? "bg-purple-600/20 text-purple-400 border border-purple-500/50"
                      : "text-gray-300 hover:text-white hover:bg-purple-600/10"
                  }`}
                >
                  <FaShieldAlt className="text-lg" />
                  <span className="font-medium">管理</span>
                </Link>
              )}
            </div>

            {/* 右側メニュー */}
            <div className="flex items-center gap-4">
              {user && player ? (
                <>
                  <Link
                    href="/matches/register"
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-700 hover:to-emerald-700 transition-all transform hover:scale-105"
                  >
                    <FaPlus className="text-sm" />
                    <span className="font-medium">試合登録</span>
                  </Link>

                  <Link
                    href={`/players/${player.id}`}
                    className="flex items-center gap-3 px-4 py-2 rounded-lg bg-gray-800/50 hover:bg-gray-800 transition-all"
                  >
                    <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                      <FaUser className="text-white text-sm" />
                    </div>
                    <span className="text-sm font-medium text-gray-300">
                      {player.handle_name ??
                        player.display_name ??
                        "マイページ"}
                    </span>
                  </Link>

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

      {/* モバイルナビ */}
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
                onClick={() => setIsMobileMenuOpen((v) => !v)}
                className="p-2 text-white hover:bg-purple-600/20 rounded-lg transition-colors"
              >
                {isMobileMenuOpen ? (
                  <FaTimes className="text-2xl" />
                ) : (
                  <FaBars className="text-2xl" />
                )}
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
                          ? "bg-purple-600/20 text-purple-400 border border-purple-500/50"
                          : "text-gray-300 hover:text-white hover:bg-purple-600/10"
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
                        pathname.startsWith("/admin")
                          ? "bg-purple-600/20 text-purple-400 border border-purple-500/50"
                          : "text-gray-300 hover:text-white hover:bg-purple-600/10"
                      }`}
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      <FaShieldAlt className="text-xl" />
                      <span className="font-medium text-lg">管理</span>
                    </Link>
                  )}

                  <div className="border-t border-purple-500/30 my-4" />

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

      {/* ログインモーダル（メール＋パスワード） */}
      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowLoginModal(false)}
          />
          <div className="relative bg-gray-900 rounded-2xl p-8 max-w-md w-full border border-purple-500/30">
            <button
              onClick={() => setShowLoginModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-200"
            >
              <FaTimes />
            </button>

            <h2 className="text-2xl font-bold text-yellow-100 mb-6 text-center">
              ログイン
            </h2>

            <form onSubmit={handleLogin} className="space-y-4">
              {loginError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <p className="text-sm text-red-400">{loginError}</p>
                </div>
              )}

              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-300 mb-2"
                >
                  メールアドレス
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  className="w-full px-4 py-2 rounded-lg bg-gray-800/50 border border-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="example@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-300 mb-2"
                >
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
                {isLoggingIn ? "ログイン中..." : "ログイン"}
              </button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-gray-400">
                アカウントをお持ちでない方は
                <Link
                  href="/register"
                  className="text-purple-400 hover:text-purple-300 ml-1"
                >
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
