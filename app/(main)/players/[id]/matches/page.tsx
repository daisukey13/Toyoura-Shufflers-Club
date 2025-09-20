'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { FaArrowLeft, FaHistory, FaUsers, FaUser } from 'react-icons/fa';

type MatchRow = {
  id: string;
  match_date: string;
  mode?: 'singles' | 'teams' | string | null;
  // 個人戦
  winner_id?: string | null;
  winner_name?: string | null;
  loser_id?: string | null;
  loser_name?: string | null;
  loser_score?: number | null;
  winner_points_change?: number | null;
  loser_points_change?: number | null;
  // 団体戦
  winner_team_id?: string | null;
  winner_team_name?: string | null;
  loser_team_id?: string | null;
  loser_team_name?: string | null;

  is_tournament?: boolean | null;
  tournament_name?: string | null;
  venue?: string | null;
  notes?: string | null;
};

const PAGE_SIZE = 5;

export default function PlayerAllMatchesPage() {
  const { id: playerId } = useParams<{ id: string }>();
  const router = useRouter();
  const sp = useSearchParams();
  const page = Math.max(1, Number(sp.get('p') || 1));

  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<MatchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // 所属チームIDを推定（存在するテーブルだけ使う）
  async function resolveTeamIds(pid: string): Promise<string[]> {
    const candidates = [
      { table: 'team_members', player: 'player_id', team: 'team_id' },
      { table: 'players_teams', player: 'player_id', team: 'team_id' },
      { table: 'team_players', player: 'player_id', team: 'team_id' },
      { table: 'memberships',  player: 'player_id', team: 'team_id' },
    ] as const;

    for (const c of candidates) {
      const q = supabase.from(c.table as any).select(`${c.team}`).eq(c.player, pid);
      const { data, error } = await q;
      if (!error && Array.isArray(data) && data.length) {
        return Array.from(
          new Set<string>(data.map((r: any) => r?.[c.team]).filter(Boolean))
        );
      }
    }
    return [];
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const teamIds = await resolveTeamIds(playerId);

        // or() で個人戦( winner/loser ) と 団体戦( 自チームが勝者/敗者 ) をまとめて取得
        const conds = [
          `winner_id.eq.${playerId}`,
          `loser_id.eq.${playerId}`,
        ];
        if (teamIds.length) {
          const quoted = teamIds.map((id) => `"${id}"`).join(',');
          conds.push(`winner_team_id.in.(${quoted})`);
          conds.push(`loser_team_id.in.(${quoted})`);
        }

        const from = (page - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        const { data, count, error } = await supabase
          .from('match_details')
          .select('*', { count: 'exact' })
          .or(conds.join(','))
          .order('match_date', { ascending: false })
          .range(from, to);

        if (error) throw error;

        if (!cancelled) {
          setRows((data ?? []) as MatchRow[]);
          setTotal(count ?? 0);
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[player matches] fetch error:', e);
          setRows([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const gotoPage = (p: number) => {
    const n = Math.min(totalPages, Math.max(1, p));
    const params = new URLSearchParams(sp.toString());
    if (n === 1) params.delete('p'); else params.set('p', String(n));
    router.replace(`?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-6 sm:py-8">
        <div className="mb-4">
          <Link href={`/players/${playerId}`} className="inline-flex items-center gap-2 text-purple-300 hover:text-purple-200">
            <FaArrowLeft /> プロフィールへ戻る
          </Link>
        </div>

        <div className="text-center mb-6 sm:mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-purple-600/20 border border-purple-500/40">
            <FaHistory />
            <span className="font-semibold">全ての試合</span>
          </div>
          <div className="mt-2 text-gray-400 text-sm">
            合計 {total} 件（{PAGE_SIZE}件/ページ）
          </div>
        </div>

        {/* 本体 */}
        {loading ? (
          <div className="glass-card rounded-xl p-6 text-center text-gray-400">読み込み中…</div>
        ) : rows.length === 0 ? (
          <div className="glass-card rounded-xl p-6 text-center text-gray-400">試合がありません。</div>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            {rows.map((m) => {
              const isTeams = (m.mode === 'teams') || !!m.winner_team_name || !!m.loser_team_name;
              const loserScore = m.loser_score ?? 0;
              const date = new Date(m.match_date).toLocaleString('ja-JP', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });

              return (
                <div key={m.id} className="glass-card rounded-xl p-4 border border-purple-500/30">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400 mb-2">
                    <span>{date}</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${isTeams ? 'bg-yellow-500/15 text-yellow-300 border-yellow-400/30' : 'bg-purple-500/15 text-purple-200 border-purple-400/30'}`}>
                      {isTeams ? <FaUsers /> : <FaUser />}
                      {isTeams ? 'teams' : 'singles'}
                    </span>
                    {m.tournament_name && <span className="px-2 py-0.5 rounded-full border bg-amber-500/10 border-amber-400/30 text-amber-300">{m.tournament_name}</span>}
                  </div>

                  {!isTeams ? (
                    <div className="grid sm:grid-cols-3 items-center gap-3">
                      <Link href={`/players/${m.winner_id ?? ''}`} className="block rounded-lg p-3 bg-green-500/10 border border-green-500/30 hover:border-green-400/50">
                        <div className="font-semibold text-yellow-100 truncate">{m.winner_name}</div>
                        <div className="text-xs text-green-400">勝利</div>
                      </Link>

                      <div className="text-center">
                        <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full ${ (15 - loserScore) >= 10 ? 'bg-gradient-to-r from-red-500/80 to-red-600/80' : 'bg-gradient-to-r from-blue-500/80 to-blue-600/80'}`}>
                          <span className="text-white font-bold">VS</span>
                        </div>
                        <div className="text-xs text-gray-400 mt-1">15 - {loserScore}</div>
                      </div>

                      <Link href={`/players/${m.loser_id ?? ''}`} className="block rounded-lg p-3 bg-red-500/10 border border-red-500/30 hover:border-red-400/50">
                        <div className="font-semibold text-yellow-100 truncate">{m.loser_name}</div>
                        <div className="text-xs text-red-400">敗北</div>
                      </Link>
                    </div>
                  ) : (
                    <div className="grid sm:grid-cols-3 items-center gap-3">
                      <Link href={`/teams/${m.winner_team_id ?? ''}`} className="block rounded-lg p-3 bg-green-500/10 border border-green-500/30 hover:border-green-400/50">
                        <div className="font-semibold text-yellow-100 truncate">{m.winner_team_name}</div>
                        <div className="text-xs text-green-400">勝利</div>
                      </Link>

                      <div className="text-center">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-r from-blue-500/80 to-blue-600/80">
                          <span className="text-white font-bold">VS</span>
                        </div>
                        <div className="text-xs text-gray-400 mt-1">15 - {loserScore}</div>
                      </div>

                      <Link href={`/teams/${m.loser_team_id ?? ''}`} className="block rounded-lg p-3 bg-red-500/10 border border-red-500/30 hover:border-red-400/50">
                        <div className="font-semibold text-yellow-100 truncate">{m.loser_team_name}</div>
                        <div className="text-xs text-red-400">敗北</div>
                      </Link>
                    </div>
                  )}

                  {m.notes && <div className="mt-2 text-xs text-gray-300">{m.notes}</div>}
                </div>
              );
            })}
          </div>
        )}

        {/* ページャ */}
        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() => gotoPage(page - 1)}
            disabled={page <= 1}
            className="px-4 py-2 rounded-lg border border-purple-500/30 disabled:opacity-50"
          >
            前へ
          </button>
          <div className="text-sm text-gray-300">
            {page} / {totalPages}
          </div>
          <button
            onClick={() => gotoPage(page + 1)}
            disabled={page >= totalPages}
            className="px-4 py-2 rounded-lg border border-purple-500/30 disabled:opacity-50"
          >
            次へ
          </button>
        </div>
      </div>
    </div>
  );
}
