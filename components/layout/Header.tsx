// components/layout/Header.tsx
'use client';

import Link from 'next/link';
import { useState } from 'react';
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

  const navigation = [
    { name: 'ホーム', href: '/', icon: FaTrophy },
    { name: 'プレイヤー', href: '/players', icon: FaUsers },
    { name: 'ランキング', href: '/rankings', icon: FaChartLine },
    { name: '試合結果', href: '/matches', icon: FaHistory },
    { name: '新規登録', href: '/register', icon: FaUserPlus },
  ];

  if (isAdmin) {
    navigation.push({ name: '管理', href: '/admin/dashboard', icon: FaCog });
  }

  return (
    <header className="glass-card sticky top-0 z-[100] border-b border-purple-500/20">
      <nav className="container mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          {/* ロゴ */}
          <Link
            href="/"
            className="text-xl font-bold flex items-center gap-2 group"
          >
            <img
              src="/shuffleboard-puck-red.png"
              alt="Red Puck"
              className="w-8 h-8"
            />
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

          {/* モバイルメニューボタン */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden p-2 rounded-lg hover:bg-purple-500/20 transition-colors z-[110]"
            aria-label="メニューを開閉"
          >
            {isMenuOpen ? <FaTimes size={24} /> : <FaBars size={24} />}
          </button>
        </div>

        {/* モバイルメニュー */}
        {isMenuOpen && (
          <>
            {/* オーバーレイ背景 */}
            <div
              className="fixed inset-0 bg-black bg-opacity-50 z-[90]"
              onClick={() => setIsMenuOpen(false)}
            />
            {/* メニュー本体 */}
            <div className="fixed top-16 left-0 w-full bg-gray-900 py-4 border-t border-purple-500/20 z-[100] md:hidden">
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
          </>
        )}
      </nav>
    </header>
  );
}
