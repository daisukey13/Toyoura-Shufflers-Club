'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FaBars, FaTimes, FaTrophy, FaUsers, FaChartLine, FaUserPlus, FaHistory, FaCog,
} from 'react-icons/fa';
import { useAuth } from '@/contexts/AuthContext';

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { isAdmin } = useAuth();

  // メニューを body 直下に描画するためのポータルノード
  const portalRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = document.createElement('div');
    el.id = 'mobile-menu-portal';
    document.body.appendChild(el);
    portalRef.current = el;
    return () => {
      try { document.body.removeChild(el); } catch {}
      portalRef.current = null;
    };
  }, []);

  // 背景スクロール抑制
  useEffect(() => {
    if (!isMenuOpen) return;
    const { body, documentElement } = document;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;
    const sbw = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (sbw > 0) body.style.paddingRight = `${sbw}px`;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setIsMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      body.style.overflow = prevOverflow || '';
      body.style.paddingRight = prevPaddingRight || '';
      window.removeEventListener('keydown', onKey);
    };
  }, [isMenuOpen]);

  const navigation = [
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
          {/* ロゴ */}
          <Link href="/" className="text-xl font-bold flex items-center gap-2 group">
            <img src="/shuffleboard-puck-red.png" alt="Red Puck" className="w-8 h-8" />
            <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              Toyoura Shufflers Club
            </span>
          </Link>

          {/* デスクトップ */}
          <ul className="hidden md:flex space-x-1">
            {navigation.map((item) => (
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

          {/* モバイルトグル（最前面） */}
          <button
            type="button"
            aria-label={isMenuOpen ? 'メニューを閉じる' : 'メニューを開く'}
            aria-expanded={isMenuOpen}
            aria-controls="mobile-menu"
            onClick={() => setIsMenuOpen(v => !v)}
            className="md:hidden p-2 rounded-lg hover:bg-purple-500/20 transition-colors relative"
            style={{ zIndex: 2147483647 }}
          >
            {isMenuOpen ? <FaTimes size={24} /> : <FaBars size={24} />}
          </button>
        </div>

        {/* モバイルメニュー（body直下・超高z-index・inline styleで強制表示） */}
        {isMenuOpen && portalRef.current && createPortal(
          <>
            {/* オーバーレイ */}
            <div
              id="mobile-menu-overlay"
              onClick={() => setIsMenuOpen(false)}
              style={{
                position: 'fixed',
                left: 0, top: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.45)',
                zIndex: 2147483645,
                paddingTop: 'env(safe-area-inset-top)',
              }}
            />
            {/* パネル本体（ヘッダー高さ=64px + ノッチ分を内部paddingで吸収） */}
            <div
              id="mobile-menu"
              role="dialog"
              aria-modal="true"
              style={{
                position: 'fixed',
                left: 0, right: 0, top: 0,
                zIndex: 2147483646,
                background: 'rgba(17,24,39,0.96)', // bg-gray-900/95
                WebkitBackdropFilter: 'saturate(180%) blur(8px)',
                backdropFilter: 'saturate(180%) blur(8px)',
              }}
            >
              <div aria-hidden style={{ height: 'calc(64px + env(safe-area-inset-top))' }} />
              <div className="py-4 border-t border-purple-500/20">
                <ul className="space-y-2">
                  {navigation.map((item) => (
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
