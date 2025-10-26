// components/layout/Header.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FaBars,
  FaTimes,
  FaTrophy,
  FaUsers,
  FaChartLine,
  FaUserPlus,
  FaHistory,
  FaCog,
  FaUserCircle,
  FaSignOutAlt,
  FaSignInAlt,
} from "react-icons/fa";
import { useAuth } from "@/contexts/AuthContext";
import { createClient } from "@/lib/supabase/client";

export default function Header() {
  const supabase = useMemo(() => createClient(), []);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { isAdmin } = useAuth(); // 既存の AuthContext を利用
  const [loggedIn, setLoggedIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // Supabase セッション監視（ログイン状態・userId）
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const session = data.session ?? null;
      setLoggedIn(!!session);
      setUserId(session?.user?.id ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!mounted) return;
      setLoggedIn(!!session);
      setUserId(session?.user?.id ?? null);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [supabase]);

  // body 直下ポータル
  const portalRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const existing = document.getElementById(
      "mobile-menu-portal",
    ) as HTMLDivElement | null;
    const el = existing ?? document.createElement("div");
    el.id = "mobile-menu-portal";
    if (!existing) document.body.appendChild(el);
    portalRef.current = el;
  }, []);

  // 背景スクロール抑制（開いている間）
  useEffect(() => {
    if (!isMenuOpen) return;
    const body = document.body;
    const html = document.documentElement;
    const prevOverflow = body.style.overflow;
    const prevPad = body.style.paddingRight;
    const sbw = window.innerWidth - html.clientWidth; // スクロールバー幅
    body.style.overflow = "hidden";
    if (sbw > 0) body.style.paddingRight = `${sbw}px`;
    return () => {
      body.style.overflow = prevOverflow || "";
      body.style.paddingRight = prevPad || "";
    };
  }, [isMenuOpen]);

  // Escで閉じる
  useEffect(() => {
    if (!isMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMenuOpen]);

  const navLeft = [
    { name: "ホーム", href: "/", icon: FaTrophy },
    { name: "プレイヤー", href: "/players", icon: FaUsers },
    { name: "ランキング", href: "/rankings", icon: FaChartLine },
    { name: "試合結果", href: "/matches", icon: FaHistory },
    { name: "新規登録", href: "/register", icon: FaUserPlus },
    ...(isAdmin
      ? [{ name: "管理", href: "/admin/dashboard", icon: FaCog }]
      : []),
  ];

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
      // サーバ Cookie 同期（即時反映）
      try {
        await fetch("/auth/callback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ event: "SIGNED_OUT", session: null }),
        });
      } catch {}
    } catch {
      // noop
    } finally {
      setIsMenuOpen(false);
      setLoggedIn(false);
      setUserId(null);
      window.location.assign("/");
    }
  }

  /* ログイン状態ドット（ヘッダー右側 & モバイルトグル上） */
  const StatusDot = ({
    size = "h-2.5 w-2.5",
    ring = "ring-0",
    className = "",
    label,
  }: {
    size?: string;
    ring?: string;
    className?: string;
    label?: string;
  }) => {
    const color = loggedIn ? "bg-blue-500" : "bg-gray-500";
    const text = label ?? (loggedIn ? "ログイン中" : "未ログイン");
    return (
      <span
        className={`inline-block ${size} rounded-full ${color} ${ring} shadow ${className}`}
        aria-label={text}
        title={text}
      />
    );
  };

  return (
    <header className="glass-card sticky top-0 z-[100] border-b border-purple-500/20">
      <nav className="container mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          <Link
            href="/"
            className="text-xl font-bold flex items-center gap-2 group"
          >
            <Image
              src="/shuffleboard-puck-red.png"
              alt="Red Puck"
              width={32}
              height={32}
              priority
            />
            <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              Toyoura Shufflers Club
            </span>
          </Link>

          {/* PC ナビ（左） */}
          <ul className="hidden md:flex items-center space-x-1">
            {navLeft.map((item) => (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-purple-500/20 transition-all"
                >
                  <item.icon className="text-sm" />
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>

          {/* PC 右側：状態ドット + ログイン / マイページ・ログアウト */}
          <div className="hidden md:flex items-center gap-3">
            <StatusDot />
            {loggedIn ? (
              <>
                <Link
                  href={userId ? `/players/${userId}` : "/me"}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-purple-500/20 transition-all"
                >
                  <FaUserCircle className="text-base" />
                  マイページ
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-purple-500/20 transition-all"
                >
                  <FaSignOutAlt className="text-base" />
                  ログアウト
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-purple-500/20 transition-all"
              >
                <FaSignInAlt className="text-base" />
                ログイン
              </Link>
            )}
          </div>

          {/* モバイル トグル */}
          <button
            type="button"
            aria-label="メニューを開閉"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((v) => !v)}
            className="md:hidden p-2 rounded-lg hover:bg-purple-500/20 transition-colors relative"
            style={{ zIndex: 2147483647 }}
          >
            {isMenuOpen ? <FaTimes size={24} /> : <FaBars size={24} />}
            {/* トグルボタンの右上にも状態ドットを表示 */}
            <StatusDot
              size="h-2 w-2"
              ring="ring-2 ring-gray-900"
              className="absolute -top-0.5 -right-0.5"
            />
          </button>
        </div>

        {/* モバイルメニュー（body直下ポータル） */}
        {portalRef.current &&
          createPortal(
            <>
              {/* オーバーレイ */}
              <div
                id="mobile-menu-overlay"
                onClick={() => setIsMenuOpen(false)}
                aria-hidden
                className="fixed inset-0 transition-opacity duration-200"
                style={{
                  background: "rgba(0,0,0,.45)",
                  zIndex: 2147483645,
                  opacity: isMenuOpen ? 1 : 0,
                  pointerEvents: isMenuOpen ? "auto" : "none",
                  paddingTop: "env(safe-area-inset-top)",
                }}
              />
              {/* スライド本体 */}
              <div
                id="mobile-menu"
                role="dialog"
                aria-modal="true"
                className="fixed inset-x-0 top-0 transition-transform duration-200 will-change-transform"
                style={{
                  zIndex: 2147483646,
                  background: "rgba(17,24,39,0.96)",
                  WebkitBackdropFilter: "saturate(180%) blur(8px)",
                  backdropFilter: "saturate(180%) blur(8px)",
                  transform: isMenuOpen ? "translateY(0)" : "translateY(-120%)",
                }}
              >
                <div
                  aria-hidden
                  style={{ height: "calc(64px + env(safe-area-inset-top))" }}
                />
                <div className="py-4 border-t border-purple-500/20">
                  <ul className="space-y-2">
                    {/* 状態ドット（モバイルメニュー内ヘッダ） */}
                    <li className="px-4 pb-2 text-sm text-gray-300 flex items-center gap-2">
                      <StatusDot />
                      <span>{loggedIn ? "ログイン中" : "未ログイン"}</span>
                    </li>

                    {navLeft.map((item) => (
                      <li key={item.name}>
                        <Link
                          href={item.href}
                          className="flex items-center gap-3 py-2 px-4 rounded-lg hover:bg-purple-500/20 transition-colors"
                          onClick={() => setIsMenuOpen(false)}
                        >
                          <item.icon />
                          {item.name}
                        </Link>
                      </li>
                    ))}

                    <li className="border-t border-white/10 my-2" />

                    {loggedIn ? (
                      <>
                        <li>
                          <Link
                            href={userId ? `/players/${userId}` : "/me"}
                            className="flex items-center gap-3 py-2 px-4 rounded-lg hover:bg-purple-500/20 transition-colors"
                            onClick={() => setIsMenuOpen(false)}
                          >
                            <FaUserCircle />
                            マイページ
                          </Link>
                        </li>
                        <li>
                          <button
                            onClick={handleLogout}
                            className="w-full text-left flex items-center gap-3 py-2 px-4 rounded-lg hover:bg-purple-500/20 transition-colors"
                          >
                            <FaSignOutAlt />
                            ログアウト
                          </button>
                        </li>
                      </>
                    ) : (
                      <li>
                        <Link
                          href="/login"
                          className="flex items-center gap-3 py-2 px-4 rounded-lg hover:bg-purple-500/20 transition-colors"
                          onClick={() => setIsMenuOpen(false)}
                        >
                          <FaSignInAlt />
                          ログイン
                        </Link>
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </>,
            portalRef.current,
          )}
      </nav>
    </header>
  );
}
