// components/layout/Header.tsx

'use client';

import Link from 'next/link';
import { useState } from 'react';
import { FaBars, FaTimes, FaTrophy, FaUsers, FaChartLine, FaUserPlus, FaHistory, FaCog } from 'react-icons/fa';
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

  // 管理者の場合は管理メニューを追加
  if (isAdmin) {
    navigation.push({ name: '管理', href: '/admin/dashboard', icon: FaCog });
  }

  return (
    <header className="glass-card sticky top-0 z-50 border-b border-purple-500/20">
      <nav className="container mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          {/* ロゴ */}
          <Link href="/" className="text-xl font-bold flex items-center gap-2 group">
            <img  src="/shuffleboard-puck-red.png" alt="Red Puck"  className="w-8 h-8"/>
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
            className="md:hidden p-2 rounded-lg hover:bg-purple-500/20 transition-colors"
          >
            {isMenuOpen ? <FaTimes size={24} /> : <FaBars size={24} />}
          </button>
        </div>

        {/* モバイルメニュー */}
        {isMenuOpen && (
          <div className="md:hidden py-4 border-t border-purple-500/20">
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