// components/layout/Header.tsx
'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FaBars, FaTimes, FaTrophy, FaUsers, FaChartLine, FaUserPlus, FaHistory, FaCog
} from 'react-icons/fa';

// useAuth が未接続でも安全に
let useAuthSafe = () => ({ isAdmin: false } as { isAdmin: boolean });
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useAuth } = require('@/contexts/AuthContext');
  if (useAuth) useAuthSafe = useAuth;
} catch {}

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false); // 通常運用：初期は閉じる
  const { isAdmin } = useAuthSafe();

  // body 直下のポータルノード
  const portalRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const existing = document.getElementById('mobile-menu-portal') as HTMLDivElement | null;
    const el = existing ?? document.createElement('div');
    el.id = 'mobile-menu-portal';
    if (!existing) document.body.appendChild(el);
    portalRef.current = el;
    return () => {
      // HMR安定のため削除しない（必要なら以下を有効化）
      // try { document.body.removeChild(el); } catch {}
      // portalRef.current = null;
    };
  }, []);

  // 背景スクロール抑制（開いている間のみ）
  useEffect(() => {
    if (!isMenuOpen) return;
    const body = document.body;
    const html = document.documentElement;
    const prevOverflow = body.style.overflow;
    const prevPad = body.style.paddingRight;
    const sbw = window.innerWidth - html.clientWidth; // スクロールバー幅
    body.style.overflow = 'hidden';
    if (sbw > 0) body.style.paddingRight = `${sbw}px`;
    return () => {
      body.style.overflow = prevOverflow || '';
      body.style.paddingRight = prevPad || '';
    };
  }, [isMenuOpen]);

  // Escapeキーで閉じる
  useEffect(() => {
    if (!isMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMenuOpen]);

  const nav = [
    { name: 'ホーム', href: '/', icon: FaTrophy },
    { name: 'プレイヤー', href: '/players', icon: FaUsers },
    { name: 'ランキング', href: '/rankings', icon: FaChartLine },
    { name: '試合結果', href: '/matches', icon: FaHistory },
    { name: '新規登録', href: '/register', icon: FaUserPlus },
    ...(isAdmin ? [{ name: '管理', href: '/admin/dashboard', icon: FaCog }] : []),
  ];

  return (
    <header className="glass-card sticky top-0 z-[100] border-b border-purple-500/20">
      <nav className="container mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          <Link href="/" className="text-xl font-bold flex items-center gap-2 group">
            <img src="/shuffleboard-puck-red.png" alt="Red Puck" className="w-8 h-8" />
            <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              Toyoura Shufflers Club
            </span>
          </Link>

          {/* PC ナビ */}
          <ul className="hidden md:flex space-x-1">
            {nav.map((item) => (
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

          {/* モバイル トグル */}
          <button
            type="button"
            aria-label="メニューを開閉"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen(v => !v)}
            className="md:hidden p-2 rounded-lg hover:bg-purple-500/20 transition-colors relative"
            style={{ zIndex: 2147483647 }}
          >
            {isMenuOpen ? <FaTimes size={24} /> : <FaBars size={24} />}
          </button>
        </div>

        {/* モバイルメニュー（body直下ポータル） */}
        {portalRef.current && createPortal(
          <>
            {/* 背景オーバーレイ */}
            <div
              id="mobile-menu-overlay"
              onClick={() => setIsMenuOpen(false)}
              aria-hidden
              className="fixed inset-0 transition-opacity duration-200"
              style={{
                background: 'rgba(0,0,0,.45)',
                zIndex: 2147483645,
                opacity: isMenuOpen ? 1 : 0,
                pointerEvents: isMenuOpen ? 'auto' : 'none',
                paddingTop: 'env(safe-area-inset-top)'
              }}
            />
            {/* パネル本体 */}
            <div
              id="mobile-menu"
              role="dialog"
              aria-modal="true"
              className="fixed inset-x-0 top-0 transition-transform duration-200 will-change-transform"
              style={{
                zIndex: 2147483646,
                background: 'rgba(17,24,39,0.96)',
                WebkitBackdropFilter: 'saturate(180%) blur(8px)',
                backdropFilter: 'saturate(180%) blur(8px)',
                transform: isMenuOpen ? 'translateY(0)' : 'translateY(-120%)'
              }}
            >
              {/* ヘッダー高さぶんの余白（h-16 = 64px） */}
              <div aria-hidden style={{ height: 'calc(64px + env(safe-area-inset-top))' }} />
              <div className="py-4 border-t border-purple-500/20">
                <ul className="space-y-2">
                  {nav.map((item) => (
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
                </ul>
              </div>
            </div>
          </>,
          portalRef.current
        )}
      </nav>
    </header>
  );
}
