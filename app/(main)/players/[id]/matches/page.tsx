// app/(main)/players/[id]/matches/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { FaArrowLeft, FaCalendar, FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

type MatchDetails = {
  id: string;
  match_date: string;
  // singles想定のビュー(match_details)。存在しない項目はundefinedでもOKにしておく
  winner_id?: string | null;
  winner_name?: string | null;
  winner_points_change?: number | null;
  loser_id?: string | null;
  loser_name?: string | null;
  loser_points_change?: number | null;
  loser_score?: number | null;
  // 互換
  winner_avatar?: string | null;
  winner_avatar_url?: string | null;
  loser_avatar?: string | null;
  loser_avatar_url?: string | null;
  notes?: string | null;
};

const PAGE_SIZE = 5;

export default function PlayerAllMatchesPage() {
  const { id: playerId } = useParams<{ id: string }>();
  const router = useRouter();
  const sp = useSearchParams();
  const pageParam = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);

  const [items, setItems] = useState<MatchDetails[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((total || 0) / PAGE_SIZE)),
    [total]
  );

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      if (!playerId) return;
      setLoading(true);
      setError('');

      try {
        const from = (pageParam - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        // singles用ビュー: match_details（winner/loserどちらでもヒット）
        const q = supabase
          .from('match_details')
          .select('*', { count: 'exact' })
          .or(`winner_id.eq.${playerId},loser_id.eq.${playerId}`)
          .order('match_date', { ascending: false })
          .range(from, to);

        const { data, count, error } = await q;
        if (error) throw error;

        if (!cancelled) {
          setItems((data as any) ?? []);
          setTotal(count ?? 0);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || '読み込みに失敗しました');
          setItems([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [playerId, pageParam]);

  const gotoPage = (p: number) => {
    const safe = Math.min(Math.max(1, p), totalPages);
    const params = new URLSearchParams(sp.toString());
    params.set('page', String(safe));
    router.push(`/players/${playerId}/matches?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-6 sm:py-8">
        {/* 戻る */}
        <div className="mb-4">
          <Link
            href={`/players/${playerId}`}
            className="inline-flex items-center gap-2 text-purple-300 hover:text-purple-200"
          >
            <FaArrowLeft /> プロフィールへ戻る
          </Link>
        </div>

        <div className="max-w-3xl mx-auto">
          <div className="mb-6 sm:mb-8 flex items-end justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-yellow-100">全ての試合</h1>
              <p className="text-gray-400 text-sm mt-1">
                1ページ {PAGE_SIZE}件・新しい順 / 合計 {total} 件
              </p>
            </div>

            {/* ページャ（上） */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => gotoPage(pageParam - 1)}
                disabled={pageParam <= 1 || loading}
                className="px-3 py-2 rounded-lg bg-gray-800/60 border border-purple-500/30 disabled:opacity-50"
              >
                <FaChevronLeft />
              </button>
              <span className="text-sm text-gray-300">
                {pageParam} / {totalPages}
              </span>
              <button
                onClick={() => gotoPage(pageParam + 1)}
                disabled={pageParam >= totalPages || loading}
                className="px-3 py-2 rounded-lg bg-gray-800/60 border border-purple-500/30 disabled:opacity-50"
              >
                <FaChevronRight />
              </button>
            </div>
          </div>

          {/* ローディング/エラー */}
          {loading && (
            <div className="space-y-3">
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <div key={i} className="h-20 rounded-xl bg-white/5 animate-pulse" />
              ))}
            </div>
          )}
          {!loading && error && (
            <div className="rounded-xl p-4 border border-red-500/40 bg-red-500/10">
              読み込みエラー：{error}
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="text-gray-400">該当する試合がありません。</div>
          )}

          {/* 一覧 */}
          {!loading && !error && items.length > 0 && (
            <div className="space-y-3">
              {items.map((m) => {
                const isWin = m.winner_id === playerId;
                const oppName = isWin ? m.loser_name : m.winner_name;
                const oppId = isWin ? m.loser_id : m.winner_id;

                return (
                  <div
                    key={m.id}
                    className={`rounded-xl p-3 sm:p-4 border transition-colors ${
                      isWin
                        ? 'bg-green-500/10 border-green-500/30'
                        : 'bg-red-500/10 border-red-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-gray-400 flex items-center gap-1">
                          <FaCalendar />
                          {new Date(m.match_date).toLocaleString('ja-JP', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                        <div className="font-semibold text-yellow-100 truncate">
                          {isWin ? '勝利' : '敗北'}：{oppName}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg sm:text-xl font-extrabold text-white">
                          15 - {m.loser_score ?? 0}
                        </div>
                        <div
                          className={`text-xs sm:text-sm ${
                            isWin ? 'text-green-300' : 'text-red-300'
                          }`}
                        >
                          {isWin ? '+' : ''}
                          {isWin ? m.winner_points_change ?? 0 : m.loser_points_change ?? 0}pt
                        </div>
                      </div>
                    </div>

                    {/* 相手プロフィール */}
                    {oppId && (
                      <div className="mt-1 text-right">
                        <Link
                          href={`/players/${oppId}`}
                          className="text-purple-300 hover:text-purple-200 text-xs sm:text-sm"
                        >
                          相手プロフィール →
                        </Link>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ページャ（下） */}
          {!loading && totalPages > 1 && (
            <div className="mt-6 sm:mt-8 flex items-center justify-center gap-2">
              <button
                onClick={() => gotoPage(pageParam - 1)}
                disabled={pageParam <= 1}
                className="px-4 py-2 rounded-lg bg-gray-800/60 border border-purple-500/30 disabled:opacity-50"
              >
                <FaChevronLeft /> 前へ
              </button>
              <span className="text-sm text-gray-300">
                {pageParam} / {totalPages}
              </span>
              <button
                onClick={() => gotoPage(pageParam + 1)}
                disabled={pageParam >= totalPages}
                className="px-4 py-2 rounded-lg bg-gray-800/60 border border-purple-500/30 disabled:opacity-50"
              >
                次へ <FaChevronRight />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
