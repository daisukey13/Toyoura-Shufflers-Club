'use client';

import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { FaAngleLeft } from 'react-icons/fa';
import MatchesPage from '@/app/(main)/matches/page'; // 参照しない。下に必要部品を再掲しています
// ↑ 依存を避けるため、/matches の部品をこのファイルに再実装しています。

/* ───── ここから最小必要型・UI（/matches と同等のものを簡略再掲） ───── */
type MD = {
  id: string;
  match_date: string;
  mode?: 'singles' | 'teams' | string | null;
  // singles
  winner_id?: string | null;
  winner_name?: string | null;
  winner_avatar?: string | null;
  winner_avatar_url?: string | null;
  winner_current_points?: number | null;
  winner_current_handicap?: number | null;
  winner_points_change?: number | null;
  loser_id?: string | null;
  loser_name?: string | null;
  loser_avatar?: string | null;
  loser_avatar_url?: string | null;
  loser_score: number | null;
  loser_current_points?: number | null;
  loser_current_handicap?: number | null;
  loser_points_change?: number | null;
  // teams
  winner_team_id?: string | null;
  winner_team_name?: string | null;
  loser_team_id?: string | null;
  loser_team_name?: string | null;
  // meta
  is_tournament?: boolean | null;
  tournament_name?: string | null;
  venue?: string | null;
  notes?: string | null;
};

const PER_PAGE = 5;

function Card({ m }: { m: MD }) {
  const isTeams = m.mode === 'teams' || !!m.winner_team_name || !!m.loser_team_name;
  const loserScore = m.loser_score ?? 0;
  const scoreDiff = 15 - loserScore;
  const when = new Date(m.match_date).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="bg-gray-900/60 rounded-xl p-4 sm:p-5 border border-purple-500/30">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400 mb-3">
        <span>{when}</span>
        <span className={`px-2 py-0.5 rounded-full border ${isTeams ? 'bg-yellow-500/15 text-yellow-300 border-yellow-400/30' : 'bg-purple-500/15 text-purple-200 border-purple-400/30'}`}>
          {isTeams ? 'teams' : 'singles'}
        </span>
        {m.is_tournament && m.tournament_name && (
          <span className="px-2 py-0.5 rounded-full border bg-amber-900/20 border-amber-500/40 text-amber-300">
            {m.tournament_name}
          </span>
        )}
      </div>

      {/* 本文 */}
      <div className="grid sm:grid-cols-3 items-center gap-3">
        {/* winner */}
        <div className="flex items-start gap-3 p-2.5 rounded-lg bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-yellow-100 truncate">
              {isTeams ? (m.winner_team_name ?? '—') : (m.winner_name ?? '—')}
            </div>
            <div className="text-xs text-green-400">勝利</div>
          </div>
          <div className="text-right text-yellow-100 font-bold text-xl">15</div>
        </div>

        <div className="text-center">
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full shadow-lg ${
            scoreDiff >= 10 ? 'bg-gradient-to-r from-red-500/80 to-red-600/80'
            : scoreDiff >= 5 ? 'bg-gradient-to-r from-orange-500/80 to-orange-600/80'
            : 'bg-gradient-to-r from-blue-500/80 to-blue-600/80'
          }`}>
            <span className="text-white font-bold">VS</span>
          </div>
        </div>

        {/* loser */}
        <div className="flex items-start gap-3 p-2.5 rounded-lg bg-gradient-to-r from-red-500/10 to-pink-500/10 border border-red-500/30">
          <div className="flex-1 min-w-0 text-right">
            <div className="font-semibold text-yellow-100 truncate">
              {isTeams ? (m.loser_team_name ?? '—') : (m.loser_name ?? '—')}
            </div>
            <div className="text-xs text-red-400">敗北</div>
          </div>
          <div className="text-right text-yellow-100 font-bold text-xl">{loserScore}</div>
        </div>
      </div>

      {m.notes && <div className="mt-3 p-2 bg-gray-800/40 rounded border-l-4 border-purple-500/50 text-xs text-gray-300">{m.notes}</div>}
    </div>
  );
}

export default function PlayerAllMatchesPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const supabase = createClient();

  const playerId = params?.id as string;

  const [rows, setRows] = useState<MD[]>([]);
  const [loading, setLoading] = useState(true);

  // 初期ページ（?page=2 等を許可）
  const initialPage = Math.max(1, Number(search.get('page') || '1'));
  const [page, setPage] = useState(initialPage);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        // プレイヤーが所属するチームID
        const { data: tms } = await supabase.from('team_members').select('team_id').eq('player_id', playerId);
        const teamIds = Array.from(new Set((tms ?? []).map((r: any) => r.team_id))).filter(Boolean);

        // singles: winner/loser に本人がいる
        const singles = await supabase
          .from('match_details')
          .select('*')
          .or(`winner_id.eq.${playerId},loser_id.eq.${playerId}`);

        // teams: 該当チームが winner/loser
        let teamMatches: { data: any[] | null } = { data: [] };
        if (teamIds.length) {
          teamMatches = await supabase
            .from('match_details')
            .select('*')
            .or(`winner_team_id.in.(${teamIds.join(',')}),loser_team_id.in.(${teamIds.join(',')})`);
        }

        const merged: MD[] = [
          ...(singles.data ?? []).map((r: any) => ({ ...r, mode: 'singles' as const })),
          ...(teamMatches.data ?? []).map((r: any) => ({ ...r, mode: 'teams' as const })),
        ]
          .sort((a, b) => +new Date(b.match_date) - +new Date(a.match_date));

        setRows(merged);
      } finally {
        setLoading(false);
      }
    })();
  }, [playerId, supabase]);

  // ページャ
  const totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const visible = useMemo(() => rows.slice((page - 1) * PER_PAGE, page * PER_PAGE), [rows, page]);

  // URL の ?page= を同期
  useEffect(() => {
    const sp = new URLSearchParams(search.toString());
    sp.set('page', String(page));
    router.replace(`?${sp.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-6 sm:py-8">
        <div className="mb-6 flex items-center gap-3">
          <Link href={`/players/${playerId}`} className="px-3 py-2 rounded-lg border border-purple-500/30 hover:bg-purple-500/10">
            <FaAngleLeft />
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            全ての試合
          </h1>
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-12">読み込み中…</div>
        ) : rows.length === 0 ? (
          <div className="text-center text-gray-400 py-12">試合がありません</div>
        ) : (
          <>
            <div className="space-y-3 sm:space-y-4">
              {visible.map((m) => (
                <Card key={m.id} m={m} />
              ))}
            </div>

            {/* ページャ */}
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="px-3 py-2 rounded-lg border border-purple-500/30 text-gray-300 disabled:opacity-50 hover:bg-purple-500/10"
              >
                前へ
              </button>
              <span className="text-sm text-gray-300">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="px-3 py-2 rounded-lg border border-purple-500/30 text-gray-300 disabled:opacity-50 hover:bg-purple-500/10"
              >
                次へ
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
