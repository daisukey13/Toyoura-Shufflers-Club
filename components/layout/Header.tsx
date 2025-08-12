// components/layout/Header.tsx

'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
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
  const pathname = usePathname();

  // 元配列を汚さず、管理者メニューを条件追加（pushしない）
  const navigation = useMemo(() => {
    const base = [
      { name: 'ホーム', href: '/', icon: FaTrophy },
      { name: 'プレイヤー', href: '/players', icon: FaUsers },
      { name: 'ランキング', href: '/rankings', icon: FaChartLine },
      { name: '試合結果', href: '/matches', icon: FaHistory },
      { name: '新規登録', href: '/register', icon: FaUserPlus },
    ] as const;
    return isAdmin ? [...base, { name: '管理', href: '/admin/dashboard', icon: FaCog }] : base;
  }, [isAdmin]);

  // ルート遷移時は自動で閉じる（メニュー開いたまま残らない）
  useEffect(() => {
    if (isMenuOpen) setIsMenuOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // メニュー展開中は背景スクロールを抑制（最小）
  useEffect(() => {
    if (!isMenuOpen) return;
    const { body, documentElement } = document;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;

    const scrollBarW = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollBarW > 0) body.style.paddingRight = `${scrollBarW}px`;

    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setIsMenuOpen(false);
    window.addEventListener('keydown', onKey);

    return () => {
      body.style.overflow = prevOverflow || '';
      body.style.paddingRight = prevPaddingRight || '';
      window.removeEventListener('keydown', onKey);
    };
  }, [isMenuOpen]);

  return (
    <header className="glass-card sticky top-0 z-50 border-b border-purple-500/20">
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

          {/* モバイルメニューボタン（右上トグル） */}
          <button
            type="button"
            aria-label={isMenuOpen ? 'メニューを閉じる' : 'メニューを開く'}
            aria-expanded={isMenuOpen}
            aria-controls="mobile-menu"
            onClick={() => setIsMenuOpen((v) => !v)}
            className="md:hidden p-2 rounded-lg hover:bg-purple-500/20 transition-colors relative z-[70]"
          >
            {isMenuOpen ? <FaTimes size={24} /> : <FaBars size={24} />}
          </button>
        </div>

        {/* モバイルメニュー（最小変更：見た目は既存のまま） */}
        {isMenuOpen && (
          <div
            id="mobile-menu"
            className="md:hidden py-4 border-t border-purple-500/20 relative z-[60]"
          >
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
        )}
      </nav>
    </header>
  );
}
