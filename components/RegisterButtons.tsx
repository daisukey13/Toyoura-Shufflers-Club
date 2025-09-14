'use client';

import Link from 'next/link';
import { FaGamepad, FaUsers } from 'react-icons/fa';

export default function RegisterButtons() {
  return (
    <div className="flex flex-wrap gap-3">
      {/* 個人戦 */}
      <Link
        href="/matches/register/singles"
        prefetch={false}
        className="px-5 py-3 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium inline-flex items-center gap-2 hover:opacity-90"
      >
        <FaGamepad />
        個人試合を登録
      </Link>

      {/* チーム戦（ページ側で所属チェックする想定。ここでは常に表示） */}
      <Link
        href="/matches/register/teams"
        prefetch={false}
        className="px-5 py-3 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white font-medium inline-flex items-center gap-2 hover:opacity-90"
      >
        <FaUsers />
        チーム試合を登録
      </Link>
    </div>
  );
}
