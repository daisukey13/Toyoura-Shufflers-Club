'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FaBullhorn, FaSearch, FaCalendarAlt } from 'react-icons/fa';
import { useNotices } from '@/lib/hooks/useNotices';

export default function NoticesListPage() {
  const [kw, setKw] = useState('');
  const { notices, loading, error, refetch } = useNotices({
    enabled: true,
    includeUnpublished: false,
    limit: 100,
    search: kw,
  });

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="text-center mb-8">
          <div className="inline-block p-4 mb-4 rounded-full bg-gradient-to-br from-yellow-400/20 to-orange-600/20">
            <FaBullhorn className="text-4xl text-yellow-300" />
          </div>
          <h1 className="text-3xl font-bold text-yellow-100">お知らせ</h1>
          <p className="text-gray-400 mt-1">クラブからの最新インフォメーション</p>
        </div>

        {/* 検索 */}
        <div className="max-w-2xl mx-auto mb-6">
          <div className="relative">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder="タイトル・本文で検索…"
              className="w-full pl-10 pr-4 py-3 bg-gray-900/60 border border-purple-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-purple-400"
            />
          </div>
        </div>

        {/* 状態 */}
        {loading && (
          <div className="max-w-3xl mx-auto glass-card rounded-xl p-8 text-center">
            読み込み中…
          </div>
        )}
        {error && (
          <div className="max-w-3xl mx-auto glass-card rounded-xl p-6 border border-red-500/30 bg-red-500/10">
            <p className="text-red-300">お知らせの取得に失敗しました。</p>
            <button onClick={refetch} className="mt-3 underline text-purple-300">
              再読み込み
            </button>
          </div>
        )}

        {/* 一覧 */}
        {!loading && !error && (
          <>
            {notices.length === 0 ? (
              <div className="max-w-3xl mx-auto glass-card rounded-xl p-8 text-center text-gray-400">
                お知らせはまだありません
              </div>
            ) : (
              <div className="max-w-3xl mx-auto space-y-4">
                {notices.map((n) => (
                  <Link
                    key={n.id}
                    href={`/notices/${n.id}`}
                    className="block glass-card rounded-xl p-5 border border-purple-500/30 hover:border-purple-400/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="text-lg sm:text-xl font-bold text-yellow-100 break-words">
                          {n.title || '無題'}
                        </h3>
                        <p
                          className="mt-2 text-sm text-gray-300 overflow-hidden text-ellipsis"
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            whiteSpace: 'normal',
                          }}
                          title={n.content}
                        >
                          {n.content}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-400 shrink-0">
                        <FaCalendarAlt />
                        <span>
                          {new Date(n.date).toLocaleDateString('ja-JP', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
