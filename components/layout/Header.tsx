// components/layout/Header.tsx
'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  FaBars,
  FaTimes,
  FaTrophy,
  FaUsers,
  FaChartLine,
  FaUserPlus,
  FaHistory,
  FaCog,
} from 'react-icons/fa';
import { useAuth } from '@/contexts/AuthContext';

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { isAdmin } = useAuth();

  // ナビ
  const navigation = [
    { name: 'ホーム', href: '/', icon: FaTrophy },
    { name: 'プレイヤー', href: '/players', icon: FaUsers },
    { name: 'ランキング', href: '/rankings', icon: FaChartLine },
    { name: '試合結果', href: '/matches', icon: FaHistory },
    { name: '新規登録', href: '/register', icon: FaUserPlus },
    ...(isAdmin ? [{ name: '管理', href: '/admin/dashboard', icon: FaCog }] : []),
  ];

  // 開いている間は背景スクロールを抑制
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

  // ヘッダーの見た目は現状維持
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

          {/* デスクトップメニュー */}
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
            className="md:hidden p-2 rounded-lg hover:bg-purple-500/20 transition-colors relative z-[10000]"
          >
            {isMenuOpen ? <FaTimes size={24} /> : <FaBars size={24} />}
          </button>
        </div>

        {/* ▼ 強制表示のモバイルメニュー（ポータルで body 直下、幅条件に依存しない） */}
        {isMenuOpen && createPortal(
          <>
            {/* オーバーレイ（どの要素よりも上） */}
            <div
              className="fixed inset-0 bg-black/45"
              style={{ zIndex: 99998, paddingTop: 'env(safe-area-inset-top)' }}
              onClick={() => setIsMenuOpen(false)}
            />

            {/* パネル本体：画面上部から。ヘッダー(64px)ぶんの余白を中で確保 */}
            <div
              id="mobile-menu"
              className="fixed inset-x-0 top-0 bg-gray-900/95 backdrop-blur"
              style={{ zIndex: 99999 }}
              role="dialog"
              aria-modal="true"
            >
              {/* ヘッダー高さ + ノッチ分のスペーサー（safe-area対応） */}
              <div
                aria-hidden
                style={{ height: 'calc(4rem + env(safe-area-inset-top))' }}
              />
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
          typeof window !== 'undefined' ? document.body : (null as any)
        )}
      </nav>
    </header>
  );
}
