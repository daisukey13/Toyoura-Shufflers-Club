// app/(main)/teams/[id]/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  FaArrowLeft,
  FaUsers,
  FaMedal,
  FaChartLine,
  FaTrophy,
} from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

/* ============================== Types ============================== */
type TeamBase = {
  id: string;
  name: string;
  avatar_url?: string | null;
};

type TeamRankStats = {
  avg_rp?: number | null;
  wins?: number | null;
  losses?: number | null;
  win_pct?: number | null;
  avg_hc?: number | null;
  team_size?: number | null;
};

type Team = TeamBase & {
  ranking_points?: number | null; // Math.round(avg_rp)
  wins?: number | null;
  losses?: number | null;
  handicap?: number | null; // Math.round(avg_hc)
};

type PlayerLite = {
  id: string;
  handle_name: string;
  avatar_url?: string | null;
};

type MemberRow = {
  team_id: string;
  player_id: string;
  role?: string | null;
  players?: PlayerLite | null;
};

type MatchRow = {
  id: string;
  mode: string | null;
  status?: string | null;
  match_date?: string | null;
  winner_score?: number | null;
  loser_score?: number | null;
};

type MatchPlayerRow = {
  match_id: string;
  player_id: string;
  side_no: number | null;
  players?: PlayerLite | null;
  matches?: MatchRow | null;
};

type MatchItem = {
  id: string;
  match: MatchRow;
  teammates: PlayerLite[]; // このチームから出場した選手
  opponents: PlayerLite[]; // 相手側（他チーム/未所属を含む）
};

/* ============================== Helpers ============================== */
function safeDateString(iso?: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  try {
    return d.toLocaleString('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d.toLocaleString();
  }
}
function gamesOf(t?: Team | null) {
  if (!t) return 0;
  return (t.wins ?? 0) + (t.losses ?? 0);
}
function winRateOf(t?: Team | null) {
  if (!t) return 0;
  const w = t.wins ?? 0;
  const l = t.losses ?? 0;
  const g = w + l;
  return g ? Math.round((w / g) * 100) : 0;
}

/* ============================== Page ============================== */
export default function TeamProfilePage() {
  const params = useParams<{ id: string }>();
  const teamId = params?.id;

  const supabase = createClient();

  const [team, setTeam] = useState<Team | null>(null);
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [teamError, setTeamError] = useState<string>('');

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(true);

  /* -------- チーム基本情報 + ランキング指標（安全取得） -------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!teamId) return;
      setLoadingTeam(true);
      setTeamError('');
      try {
        // 1) teams から存在確実な列のみ
        const { data: baseRow, error: baseErr } = await (supabase.from('teams') as any)
          .select('id, name, avatar_url')
          .eq('id', teamId)
          .maybeSingle();
        if (baseErr) throw baseErr;
        if (!baseRow) throw new Error('チームが見つかりませんでした。');

        const base: TeamBase = baseRow as TeamBase;

        // 2) team_rankings ビュー（あれば）
        let stats: TeamRankStats | null = null;
        try {
          const { data: r, error: rErr } = await (supabase.from('team_rankings') as any)
            .select('avg_rp, wins, losses, win_pct, avg_hc, team_size')
            .eq('id', teamId)
            .maybeSingle();
          if (!rErr && r) stats = r as TeamRankStats;
        } catch {
          stats = null; // ビューが無い環境でも落ちない
        }

        const combined: Team = {
          ...base,
          ranking_points: stats?.avg_rp != null ? Math.round(stats.avg_rp) : null,
          wins: stats?.wins ?? null,
          losses: stats?.losses ?? null,
          handicap: stats?.avg_hc != null ? Math.round(stats.avg_hc) : null,
        };

        if (!cancelled) setTeam(combined);
      } catch (e: any) {
        if (!cancelled) {
          setTeam(null);
          setTeamError(e?.message || 'チーム情報の取得に失敗しました。');
        }
      } finally {
        if (!cancelled) setLoadingTeam(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, teamId]);

  /* -------- メンバー一覧 -------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!teamId) return;
      setLoadingMembers(true);
      try {
        const { data, error } = await (supabase.from('team_members') as any)
          .select('team_id, player_id, role, players:player_id(id, handle_name, avatar_url)')
          .eq('team_id', teamId);
        if (error) throw error;

        const rows = (data ?? []) as MemberRow[];
        if (!cancelled) setMembers(rows);
      } catch {
        if (!cancelled) setMembers([]);
      } finally {
        if (!cancelled) setLoadingMembers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, teamId]);

  const memberIds = useMemo(
    () => members.map((m) => m.player_id).filter((v) => typeof v === 'string' && v.length > 0),
    [members]
  );

  /* -------- 直近の試合履歴（チーム出場試合） --------
     1) チームメンバーが参加した match_players を取得（matches join 付）
     2) その match_id すべてについて、対戦相手側も含めた match_players を再取得
     3) teammates/opponents に振り分け
  ----------------------------------------------------------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!teamId) return;
      setLoadingMatches(true);
      try {
        if (memberIds.length === 0) {
          if (!cancelled) setMatches([]);
          return;
        }

        // 1) チームメンバーが出た試合
        const { data: mp1, error: e1 } = await (supabase.from('match_players') as any)
          .select('match_id, player_id, side_no, players:player_id(id, handle_name, avatar_url), matches:matches(id, mode, status, match_date, winner_score, loser_score)')
          .in('player_id', memberIds)
          .order('match_date', { foreignTable: 'matches', ascending: false })
          .limit(50);
        if (e1) throw e1;

        const mpRows1 = (mp1 ?? []) as MatchPlayerRow[];
        const matchIds = Array.from(new Set(mpRows1.map((r) => r.match_id))).filter(Boolean) as string[];
        if (matchIds.length === 0) {
          if (!cancelled) setMatches([]);
          return;
        }

        // 2) 同試合の全参加者（相手側も含める）
        const { data: mp2, error: e2 } = await (supabase.from('match_players') as any)
          .select('match_id, player_id, side_no, players:player_id(id, handle_name, avatar_url)')
          .in('match_id', matchIds);
        if (e2) throw e2;
        const mpRows2 = (mp2 ?? []) as MatchPlayerRow[];

        // 3) マッチID単位でまとめる
        const byMatchAll = new Map<string, MatchPlayerRow[]>();
        mpRows2.forEach((r) => {
          const arr = byMatchAll.get(r.match_id) || [];
          arr.push(r);
          byMatchAll.set(r.match_id, arr);
        });

        // mpRows1 から matches 情報を拾い、teammates / opponents を分離
        const items: MatchItem[] = matchIds.map((mid) => {
          const rowsAll = byMatchAll.get(mid) ?? [];

          // この試合でチームメンバーが立っていたサイド番号（1/2など）
          const teamSideSet = new Set<number>();
          rowsAll.forEach((r) => {
            if (memberIds.includes(r.player_id) && typeof r.side_no === 'number') {
              teamSideSet.add(r.side_no);
            }
          });

          const teammates: PlayerLite[] = [];
          const opponents: PlayerLite[] = [];
          rowsAll.forEach((r) => {
            const pl = r.players ?? undefined;
            if (!pl) return;
            const isTeamMember = memberIds.includes(r.player_id);
            if (isTeamMember) {
              teammates.push(pl);
            } else {
              // 相手側：サイドが異なる（または判定不能なら相手扱い）
              const isOtherSide =
                typeof r.side_no === 'number' ? !teamSideSet.has(r.side_no) : true;
              if (isOtherSide) opponents.push(pl);
            }
          });

          // matches 情報（mpRows1 由来、または rowsAll から補完）
          const m1 = mpRows1.find((r) => r.match_id === mid && r.matches?.id)?.matches ?? null;

          const match: MatchRow = m1 ?? {
            id: mid,
            mode: null,
            status: null,
            match_date: null,
            winner_score: null,
            loser_score: null,
          };

          return { id: mid, match, teammates, opponents };
        });

        if (!cancelled) setMatches(items);
      } catch (e) {
        if (!cancelled) {
          console.warn('[team profile] fetch matches failed:', e);
          setMatches([]);
        }
      } finally {
        if (!cancelled) setLoadingMatches(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, teamId, memberIds.join('|')]); // memberIds に依存

  const wr = winRateOf(team);
  const games = gamesOf(team);

  /* ============================== UI ============================== */
  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-6 sm:py-8">
        {/* 戻る */}
        <div className="mb-4">
          <Link
            href="/teams"
            className="inline-flex items-center gap-2 text-purple-300 hover:text-purple-200"
          >
            <FaArrowLeft /> チーム一覧へ戻る
          </Link>
        </div>

        {/* ローディング / エラー */}
        {loadingTeam && (
          <div className="max-w-4xl mx-auto glass-card rounded-2xl p-6 sm:p-8">
            <div className="h-7 w-60 bg-white/10 rounded mb-6" />
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="h-40 bg-white/10 rounded" />
              <div className="h-40 bg-white/10 rounded" />
            </div>
          </div>
        )}
        {teamError && !loadingTeam && (
          <div className="max-w-4xl mx-auto glass-card rounded-2xl p-6 border border-red-500/40 bg-red-500/10">
            読み込みに失敗しました: {teamError}
          </div>
        )}

        {!loadingTeam && !teamError && team && (
          <div className="max-w-5xl mx-auto space-y-6 sm:space-y-8">
            {/* ── ヒーロー：基本情報 ── */}
            <div className="glass-card rounded-2xl p-6 sm:p-8 border border-purple-500/30">
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 sm:gap-8">
                {/* アイコン */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={team.avatar_url || '/default-avatar.png'}
                  alt={team.name}
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-2 border-purple-500/40 object-cover"
                />

                <div className="flex-1 w-full">
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-yellow-100">
                    {team.name}
                  </h1>

                  {/* 概要（RP / HC / 勝敗 / 勝率） */}
                  <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                    <div className="text-center rounded-xl bg-gray-900/60 border border-purple-500/30 p-4 sm:p-5">
                      <div className="flex items-center justify-center gap-2 text-purple-200 mb-1">
                        <FaMedal className="text-lg sm:text-xl" />
                        <span className="text-xs sm:text-sm">ランキングポイント</span>
                      </div>
                      <div className="text-3xl sm:text-4xl font-black text-yellow-100 tracking-tight">
                        {team.ranking_points ?? 0}
                      </div>
                    </div>

                    <div className="text-center rounded-xl bg-gray-900/60 border border-purple-500/30 p-4 sm:p-5">
                      <div className="flex items-center justify-center gap-2 text-blue-200 mb-1">
                        <FaChartLine className="text-lg sm:text-xl" />
                        <span className="text-xs sm:text-sm">ハンディキャップ</span>
                      </div>
                      <div className="text-3xl sm:text-4xl font-black text-blue-100 tracking-tight">
                        {team.handicap ?? 0}
                      </div>
                    </div>

                    <div className="text-center rounded-xl bg-gray-900/60 border border-purple-500/20 p-3 sm:p-4">
                      <div className="text-2xl font-extrabold text-green-400">
                        {team.wins ?? 0}
                      </div>
                      <div className="text-xs sm:text-sm text-gray-400">勝利</div>
                    </div>
                    <div className="text-center rounded-xl bg-gray-900/60 border border-purple-500/20 p-3 sm:p-4">
                      <div className="text-2xl font-extrabold text-red-400">
                        {team.losses ?? 0}
                      </div>
                      <div className="text-xs sm:text-sm text-gray-400">敗北</div>
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

            {/* ── 参加メンバー ── */}
            <div className="glass-card rounded-2xl p-6 sm:p-7 border border-purple-500/30">
              <h2 className="text-lg sm:text-xl font-bold text-yellow-100 mb-4 sm:mb-5 flex items-center gap-2">
                <FaUsers className="text-purple-300" />
                参加メンバー
              </h2>

              {loadingMembers ? (
                <div className="text-gray-400">読み込み中...</div>
              ) : members.length === 0 ? (
                <div className="text-gray-400">メンバーが登録されていません。</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                  {members.map((m) => {
                    const p = m.players;
                    return (
                      <Link
                        key={m.player_id}
                        href={`/players/${m.player_id}`}
                        className="flex items-center gap-3 p-3 rounded-xl border border-purple-500/30 bg-gray-900/50 hover:border-purple-400/60 transition-colors"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p?.avatar_url || '/default-avatar.png'}
                          alt={p?.handle_name || 'player'}
                          className="w-10 h-10 rounded-full border-2 border-purple-500/40 object-cover"
                        />
                        <div className="min-w-0">
                          <div className="font-semibold text-yellow-100 truncate">
                            {p?.handle_name ?? '不明なプレイヤー'}
                          </div>
                          {m.role && (
                            <div className="text-xs text-purple-300 truncate">役割: {m.role}</div>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── 直近の試合 ── */}
            <div className="glass-card rounded-2xl p-6 sm:p-7 border border-purple-500/30">
              <h2 className="text-lg sm:text-xl font-bold text-yellow-100 mb-4 sm:mb-5">
                直近の試合
              </h2>

              {loadingMatches ? (
                <div className="text-gray-400">読み込み中...</div>
              ) : matches.length === 0 ? (
                <div className="text-gray-400">まだ試合がありません。</div>
              ) : (
                <div className="space-y-3">
                  {matches.slice(0, 12).map((item) => {
                    const m = item.match;
                    const when = safeDateString(m.match_date);
                    return (
                      <div
                        key={item.id}
                        className="rounded-xl p-3 sm:p-4 border border-purple-500/30 bg-gray-900/50"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs text-gray-400">{when}</div>
                            <div className="font-semibold text-yellow-100 truncate">
                              {m.mode ?? '試合'} / {m.status ?? ''}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg sm:text-xl font-extrabold text-white">
                              {m.winner_score ?? '-'} - {m.loser_score ?? '-'}
                            </div>
                          </div>
                        </div>

                        {/* 出場メンバー / 相手 */}
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <div className="text-xs text-gray-400 mb-1">この試合の自チーム</div>
                            <div className="flex flex-wrap gap-2">
                              {item.teammates.length === 0 && (
                                <div className="text-gray-500 text-sm">—</div>
                              )}
                              {item.teammates.map((p) => (
                                <Link
                                  key={p.id}
                                  href={`/players/${p.id}`}
                                  className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-gray-800/70 border border-purple-500/20 hover:border-purple-400/40"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={p.avatar_url || '/default-avatar.png'}
                                    alt={p.handle_name}
                                    className="w-6 h-6 rounded-full object-cover"
                                  />
                                  <span className="text-sm">{p.handle_name}</span>
                                </Link>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-gray-400 mb-1">相手側</div>
                            <div className="flex flex-wrap gap-2">
                              {item.opponents.length === 0 && (
                                <div className="text-gray-500 text-sm">—</div>
                              )}
                              {item.opponents.map((p) => (
                                <Link
                                  key={p.id}
                                  href={`/players/${p.id}`}
                                  className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-gray-800/70 border border-purple-500/20 hover:border-purple-400/40"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={p.avatar_url || '/default-avatar.png'}
                                    alt={p.handle_name}
                                    className="w-6 h-6 rounded-full object-cover"
                                  />
                                  <span className="text-sm">{p.handle_name}</span>
                                </Link>
                              ))}
                            </div>
                          </div>
                        </div>
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
