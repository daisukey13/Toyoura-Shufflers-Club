// app/(main)/tournaments/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FaTrophy, FaListUl } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

type TournamentRow = {
  id: string;
  name: string | null;
  tournament_date: string | null;
  mode: string | null;
};

export default function TournamentsIndexPage() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<TournamentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const { data, error } = await (supabase.from('tournaments') as any)
          .select('id,name,tournament_date,mode')
          .order('tournament_date', { ascending: false })
          .limit(50);

        if (error) throw error;
        if (!cancelled) setRows((data ?? []) as TournamentRow[]);
      } catch (e: any) {
        console.error('[tournaments] fetch error:', e);
        if (!cancelled) setErr('大会一覧の取得に失敗しました。');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-gradient-to-r from-yellow-600 to-orange-600 rounded-full">
            <FaTrophy className="text-2xl" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-yellow-200 to-orange-200 bg-clip-text text-transparent">
            大会一覧
          </h1>
        </div>

        <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <FaListUl className="text-emerald-300" />
              公開大会
            </h2>
          </div>
          <p className="text-xs text-gray-400 mb-4">
            各大会の「リーグ結果（公開）」からリーグ戦ブロックの結果ページを開けます。
          </p>

          {loading ? (
            <div className="text-sm text-gray-400">読み込み中...</div>
          ) : err ? (
            <div className="text-sm text-red-400">{err}</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-gray-400">まだ大会が登録されていません。</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-800 text-gray-100 text-xs">
                    <th className="border border-gray-700 px-2 py-2 text-left">大会名</th>
                    <th className="border border-gray-700 px-2 py-2 text-left">開催日</th>
                    <th className="border border-gray-700 px-2 py-2 text-left">形式</th>
                    <th className="border border-gray-700 px-2 py-2 text-left">リーグ結果（公開）</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const dateLabel = t.tournament_date
                      ? new Date(t.tournament_date).toLocaleDateString('ja-JP', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : '-';

                    const modeLabel =
                      t.mode === 'player' || t.mode === 'singles'
                        ? '個人戦'
                        : t.mode === 'teams'
                        ? 'チーム戦'
                        : t.mode || '-';

                    return (
                      <tr key={t.id} className="hover:bg-gray-800/60">
                        <td className="border border-gray-700 px-2 py-2">
                          {t.name || '(名称未設定)'}
                        </td>
                        <td className="border border-gray-700 px-2 py-2">{dateLabel}</td>
                        <td className="border border-gray-700 px-2 py-2">{modeLabel}</td>
                        <td className="border border-gray-700 px-2 py-2">
                          <Link
                            href={`/tournaments/${t.id}/league/results`}
                            className="text-xs text-green-300 underline hover:text-green-200"
                          >
                            開く
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
