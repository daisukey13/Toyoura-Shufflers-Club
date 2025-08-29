// app/(main)/players/[id]/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  FaCrown,
  FaMedal,
  FaChartLine,
  FaTrophy,
  FaArrowLeft,
  FaUsers,
} from 'react-icons/fa';
import {
  useFetchPlayerDetail,
  useFetchPlayersData,
} from '@/lib/hooks/useFetchSupabaseData';
import { createClient } from '@/lib/supabase/client';

/* ───────────────────────────── Types / helpers ───────────────────────────── */
type Player = {
  id: string;
  handle_name: string;
  avatar_url?: string | null;
  ranking_points?: number | null;
  handicap?: number | null;
  wins?: number | null;
  losses?: number | null;
  is_active?: boolean | null;
  address?: string | null;
};

type TeamMemberRow = { team_id: string | null; role?: string | null };
type Team = { id: string; name: string; avatar_url?: string | null };
type TeamWithRole = Team & { role?: string | null };

function gamesOf(p?: Player | null) {
  if (!p) return 0;
  return (p.wins ?? 0) + (p.losses ?? 0);
}
function winRateOf(p?: Player | null) {
  if (!p) return 0;
  const w = p.wins ?? 0;
  const l = p.losses ?? 0;
  const g = w + l;
  return g ? Math.round((w / g) * 100) : 0;
}

/* ───────────────────────────── Rank badge (Huge) ───────────────────────────── */
function rankTheme(rank?: number | null) {
  if (!rank) return { ring: 'from-purple-500 to-pink-600', glow: 'bg-purple-400' };
  if (rank === 1) return { ring: 'from-yellow-300 to-yellow-500', glow: 'bg-yellow-300' };
  if (rank === 2) return { ring: 'from-gray-200 to-gray-400', glow: 'bg-gray-300' };
  if (rank === 3) return { ring: 'from-orange-300 to-orange-500', glow: 'bg-orange-400' };
  return { ring: 'from-purple-400 to-pink-500', glow: 'bg-purple-400' };
}

function HugeRankBadge({ rank }: { rank?: number | null }) {
  const t = rankTheme(rank);
  return (
    <div className="relative inline-block">
      {/* soft glow */}
      <div className={`absolute -inset-4 rounded-full blur-2xl opacity-40 ${t.glow}`} />
      {/* ring */}
      <div className={`relative rounded-full p-1 bg-gradient-to-br ${t.ring}`}>
        <div className="rounded-full bg-[#1f1f2f] p-4 sm:p-5">
          <div className="flex items-center justify-center">
            {/* ランク数字（勝利数より2倍以上大きい） */}
            <span className="font-extrabold tracking-tight text-6xl sm:text-7xl text-yellow-100 drop-shadow">
              {rank ?? '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Crown for Top3 */}
      {rank && rank <= 3 && (
        <div className="absolute -top-4 -right-4 sm:-top-5 sm:-right-5">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-yellow-400/20 border border-yellow-400/40 flex items-center justify-center">
            <FaCrown className="text-yellow-300 text-xl sm:text-2xl" />
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Page ───────────────────────────── */
export default function PlayerProfilePage() {
  const params = useParams<{ id: string }>();
  const playerId = params?.id;

  // 個別プレイヤー詳細（試合履歴など）
  const { player, matches, loading, error } = useFetchPlayerDetail(playerId, {
    requireAuth: false,
  });

  // 全プレイヤーから順位算出（RP降順）
  const { players: allPlayers } = useFetchPlayersData({ requireAuth: false });
  const { rank, totalActive } = useMemo(() => {
    const arr = [...allPlayers].sort(
      (a: any, b: any) => (b.ranking_points ?? 0) - (a.ranking_points ?? 0)
    );
    const idx = arr.findIndex((p: any) => p.id === playerId);
    return { rank: idx >= 0 ? idx + 1 : null, totalActive: arr.length };
  }, [allPlayers, playerId]);

  const wr = winRateOf(player);
  const games = gamesOf(player);

  /* ───────── 所属チームを取得（team_members → teams） ───────── */
  const [teams, setTeams] = useState<TeamWithRole[]>([]);
  const [teamsLoading, setTeamsLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      if (!playerId) return;
      setTeamsLoading(true);
      try {
        // 1) team_members から所属チームID+役割を取得（I/O境界を any で緩める）
        const { data: memberRows, error: mErr } = await (supabase.from('team_members') as any)
          .select('team_id, role')
          .eq('player_id', playerId);
        if (mErr) throw mErr;

        const members = (memberRows ?? []) as TeamMemberRow[];

        // null を除外しつつ ID 配列に
        const ids: string[] = members
          .map((r) => r.team_id)
          .filter((v): v is string => typeof v === 'string' && v.length > 0);

        if (ids.length === 0) {
          if (!cancelled) {
            setTeams([]);
            setTeamsLoading(false);
          }
          return;
        }

        // 2) teams 情報をまとめて取得
        const { data: teamRows, error: tErr } = await (supabase.from('teams') as any)
          .select('id, name, avatar_url')
          .in('id', ids);
        if (tErr) throw tErr;

        const teamsRaw = (teamRows ?? []) as Team[];

        // 3) role を結合
        const roleMap = new Map<string, string | null>();
        members.forEach((r) => {
          if (r.team_id) roleMap.set(r.team_id, r.role ?? null);
        });

        const merged: TeamWithRole[] = teamsRaw.map((t) => ({
          ...t,
          role: roleMap.get(t.id) ?? null,
        }));

        if (!cancelled) {
          setTeams(merged);
          setTeamsLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[player profile] fetch teams error:', e);
          setTeams([]);
          setTeamsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [playerId]);

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-6 sm:py-8">
        {/* 戻る */}
        <div className="mb-4">
          <Link
            href="/players"
            className="inline-flex items-center gap-2 text-purple-300 hover:text-purple-200"
          >
            <FaArrowLeft /> 一覧へ戻る
          </Link>
        </div>

        {/* ローディング / エラー */}
        {loading && (
          <div className="max-w-4xl mx-auto glass-card rounded-2xl p-6 sm:p-8">
            <div className="h-7 w-60 bg-white/10 rounded mb-6" />
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="h-40 bg-white/10 rounded" />
              <div className="h-40 bg-white/10 rounded" />
            </div>
          </div>
        )}
        {error && !loading && (
          <div className="max-w-4xl mx-auto glass-card rounded-2xl p-6 border border-red-500/40 bg-red-500/10">
            読み込みに失敗しました: {error}
          </div>
        )}

        {!loading && !error && player && (
          <div className="max-w-5xl mx-auto space-y-6 sm:space-y-8">
            {/* ── ヒーロー：巨大ランク＋基本情報 ── */}
            <div className="glass-card rounded-2xl p-6 sm:p-8 border border-purple-500/30">
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 sm:gap-8">
                {/* Huge Rank */}
                <div className="shrink-0">
                  <HugeRankBadge rank={rank} />
                  <div className="text-center mt-2 text-xs sm:text-sm text-gray-400">
                    {rank ? `全${totalActive}人中` : '順位集計外'}
                  </div>
                </div>

                {/* 名前＋RP/HC（特大表示） */}
                <div className="flex-1 w-full">
                  <div className="flex items-center gap-4 sm:gap-5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={player.avatar_url || '/default-avatar.png'}
                      alt={player.handle_name}
                      className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-purple-500/40 object-cover"
                    />
                    <div className="min-w-0">
                      <h1 className="text-2xl sm:text-3xl font-extrabold text-yellow-100 truncate">
                        {player.handle_name}
                      </h1>
                    </div>
                  </div>

                  {/* RP / HC を特大で */}
                  <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4">
                    <div className="text-center rounded-xl bg-gray-900/60 border border-purple-500/30 p-4 sm:p-5">
                      <div className="flex items-center justify-center gap-2 text-purple-200 mb-1">
                        <FaMedal className="text-lg sm:text-xl" />
                        <span className="text-xs sm:text-sm">ランキングポイント</span>
                      </div>
                      <div className="text-4xl sm:text-5xl font-black text-yellow-100 tracking-tight">
                        {player.ranking_points ?? 0}
                      </div>
                    </div>
                    <div className="text-center rounded-xl bg-gray-900/60 border border-purple-500/30 p-4 sm:p-5">
                      <div className="flex items-center justify-center gap-2 text-blue-200 mb-1">
                        <FaChartLine className="text-lg sm:text-xl" />
                        <span className="text-xs sm:text-sm">ハンディキャップ</span>
                      </div>
                      <div className="text-4xl sm:text-5xl font-black text-blue-100 tracking-tight">
                        {player.handicap ?? 0}
                      </div>
                    </div>
                  </div>

                  {/* 勝利/敗北/勝率（Rank数値より小さい= text-2xl） */}
                  <div className="mt-5 grid grid-cols-3 gap-3 sm:gap-4">
                    <div className="text-center rounded-xl bg-gray-900/60 border border-purple-500/20 p-3 sm:p-4">
                      <div className="text-2xl font-extrabold text-green-400">
                        {player.wins ?? 0}
                      </div>
                      <div className="text-xs sm:text-sm text-gray-400">勝利</div>
                    </div>
                    <div className="text-center rounded-xl bg-gray-900/60 border border-purple-500/20 p-3 sm:p-4">
                      <div className="text-2xl font-extrabold text-red-400">
                        {player.losses ?? 0}
                      </div>
                      <div className="text-xs sm:text-sm text-gray-400">敗北</div>
                    </div>
                    <div className="text-center rounded-xl bg-gray-900/60 border border-purple-500/20 p-3 sm:p-4">
                      <div className="text-2xl font-extrabold text-blue-400">
                        {wr}%
                      </div>
                      <div className="text-xs sm:text-sm text-gray-400">勝率</div>
                    </div>
                  </div>

                  {/* 勝率バー */}
                  <div className="mt-3 sm:mt-4">
                    <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          wr >= 60
                            ? 'bg-green-500'
                            : wr >= 40
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                        }`}
                        style={{ width: `${wr}%` }}
                      />
                    </div>
                    <div className="mt-1 text-right text-xs text-gray-500">
                      {games} 試合
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── 所属チーム ─────────────────────────────────── */}
            <div className="glass-card rounded-2xl p-6 sm:p-7 border border-purple-500/30">
              <h2 className="text-lg sm:text-xl font-bold text-yellow-100 mb-4 sm:mb-5 flex items-center gap-2">
                <FaUsers className="text-purple-300" />
                所属チーム
              </h2>

              {teamsLoading ? (
                <div className="text-gray-400">読み込み中...</div>
              ) : teams.length === 0 ? (
                <div className="text-gray-400">所属チームはありません。</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                  {teams.map((t) => (
                    <Link
                      key={t.id}
                      href={`/teams/${t.id}`}
                      className="flex items-center gap-3 p-3 rounded-xl border border-purple-500/30 bg-gray-900/50 hover:border-purple-400/60 transition-colors"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={t.avatar_url || '/default-avatar.png'}
                        alt={t.name}
                        className="w-10 h-10 rounded-full border-2 border-purple-500/40 object-cover"
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-yellow-100 truncate">{t.name}</div>
                        {t.role && (
                          <div className="text-xs text-purple-300 truncate">役割: {t.role}</div>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* ── 直近の試合（簡易） ──────────────────────────── */}
            <div className="glass-card rounded-2xl p-6 sm:p-7 border border-purple-500/30">
              <h2 className="text-lg sm:text-xl font-bold text-yellow-100 mb-4 sm:mb-5">
                直近の試合
              </h2>

              {(!matches || matches.length === 0) && (
                <div className="text-gray-400">まだ試合がありません。</div>
              )}

              {matches && matches.length > 0 && (
                <div className="space-y-3">
                  {matches.slice(0, 8).map((m: any) => {
                    const isWin = m.winner_id === playerId;
                    const oppName =
                      m.winner_id === playerId ? m.loser_name : m.winner_name;
                    const oppId =
                      m.winner_id === playerId ? m.loser_id : m.winner_id;

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
                            <div className="text-xs text-gray-400">
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
                              {isWin
                                ? m.winner_points_change ?? 0
                                : m.loser_points_change ?? 0}
                              pt
                            </div>
                          </div>
                        </div>

                        {/* 相手プロフィールリンク */}
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

              <div className="mt-4 text-right">
                <Link
                  href="/matches"
                  className="inline-flex items-center gap-2 text-purple-300 hover:text-purple-200"
                >
                  <FaTrophy /> 試合結果一覧へ
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
