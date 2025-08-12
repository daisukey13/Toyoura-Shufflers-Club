// components/layout/Header.tsx
'use client';
import { createPortal } from 'react-dom';
import { useEffect } from 'react'; // 既にあれば不要
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
          type="button"
          onClick={() => setIsMenuOpen(v => !v)}
          className="md:hidden p-2 rounded-lg hover:bg-purple-500/20 transition-colors relative z-[10000]"
          aria-label="メニューを開閉"
        >
  {isMenuOpen ? <FaTimes size={24} /> : <FaBars size={24} />}
</button>
        </div>

        {/* モバイルメニュー */}
        {isMenuOpen &&
  createPortal(
    <>
      {/* 背景オーバーレイ（タップで閉じる） */}
      <div
        className="fixed inset-0 z-[9998] bg-black/40"
        onClick={() => setIsMenuOpen(false)}
      />
      {/* メニュー本体（ヘッダー直下の高さに揃えるなら top-16） */}
      <div
        id="mobile-menu"
        className="fixed inset-x-0 top-16 z-[9999] md:hidden py-4 border-t border-purple-500/20 bg-white/95 backdrop-blur"
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
          </>
        )}
      </nav>
    </header>
  );
}
