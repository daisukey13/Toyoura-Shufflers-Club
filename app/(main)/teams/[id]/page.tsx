// app/(main)/teams/[id]/page.tsx
'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  FaUsers,
  FaChevronLeft,
  FaTrophy,
  FaMedal,
  FaCalendarAlt,
  FaUser,
  FaArrowRight,
} from 'react-icons/fa';

/* ========= REST ヘルパ ========= */
const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function restGet<T = any>(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as T;
}

/* ========= 型 ========= */
type Team = {
  id: string;
  name: string;
  description?: string | null;
  created_by?: string | null;
  created_at?: string | null;
};

type TeamRank = {
  id: string;
  name: string;
  team_size?: number | null;
  avg_rp?: number | null;
  avg_hc?: number | null;
  played?: number | null;
  wins?: number | null;
  losses?: number | null;
  win_pct?: number | null; // 0..1
  last_match_at?: string | null;
};

type TeamMemberRow = {
  player_id: string;
  role?: string | null;
  joined_at?: string | null;
};

type Player = {
  id: string;
  handle_name: string;
  avatar_url?: string | null;
  ranking_points?: number | null;
  handicap?: number | null;
};

type MatchTeamsRow = { match_id: string; team_id: string; team_no: number };
type MatchRow = {
  id: string;
  mode: 'singles' | 'teams' | string;
  status?: string | null;
  match_date?: string | null;
  winner_team_no?: number | null; // 団体戦: 勝者の team_no
  winner_score?: number | null;
  loser_score?: number | null;
};

/* ========= 小物 ========= */
const LazyImg = (props: { src?: string | null; alt: string; className?: string }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src={props.src || '/default-avatar.png'}
    alt={props.alt}
    className={props.className}
    loading="lazy"
    decoding="async"
    onError={(e) => ((e.target as HTMLImageElement).src = '/default-avatar.png')}
  />
);

/* ========= ページ ========= */
export default function TeamProfilePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const teamId = params?.id;

  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<Team | null>(null);
  const [teamRank, setTeamRank] = useState<TeamRank | null>(null);
  const [members, setMembers] = useState<Array<TeamMemberRow & { player?: Player }>>([]);
  const [recentMatches, setRecentMatches] = useState<
    Array<
      MatchRow & {
        my_team_no: number;
        result: 'W' | 'L';
        opponent_team_id?: string | null;
        opponent_team_name?: string | null;
      }
    >
  >([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    setError(null);

    try {
      /* 1) チーム本体 */
      const t = await restGet<Team[]>(`/rest/v1/teams?id=eq.${teamId}&select=*`);
      setTeam(t?.[0] ?? null);

      /* 2) チーム集計（team_rankings VIEW） */
      const tr = await restGet<TeamRank[]>(`/rest/v1/team_rankings?id=eq.${teamId}&select=*`);
      setTeamRank(tr?.[0] ?? null);

      /* 3) メンバー → players 取得 */
      const tm = await restGet<TeamMemberRow[]>(
        `/rest/v1/team_members?team_id=eq.${teamId}&select=player_id,role,joined_at&order=joined_at.asc`
      );
      if (tm.length) {
        const ids = tm.map((x) => x.player_id);
        const inList = ids.map((id) => `"${id}"`).join(',');
        const ps = await restGet<Player[]>(
          `/rest/v1/players?id=in.(${inList})&select=id,handle_name,avatar_url,ranking_points,handicap`
        );
        const pmap = new Map(ps.map((p) => [p.id, p]));
        setMembers(tm.map((m) => ({ ...m, player: pmap.get(m.player_id) })));
      } else {
        setMembers([]);
      }

      /* 4) 直近の団体戦
            - match_teams から該当 match_id と自チームの team_no を取得
            - matches をまとめて取得
            - 対戦相手の team_id/name を取得するため、同じ match_id の別 team_no も取得
       */
      const myMt = await restGet<MatchTeamsRow[]>(
        `/rest/v1/match_teams?team_id=eq.${teamId}&select=match_id,team_id,team_no&order=match_id.desc&limit=50`
      );
      const matchIds = myMt.map((r) => r.match_id);
      if (matchIds.length === 0) {
        setRecentMatches([]);
      } else {
        const inM = matchIds.map((id) => `"${id}"`).join(',');
        const matches = await restGet<MatchRow[]>(
          `/rest/v1/matches?id=in.(${inM})&select=id,mode,status,match_date,winner_team_no,winner_score,loser_score&order=match_date.desc&limit=50`
        );
        const byId = new Map(myMt.map((r) => [r.match_id, r.team_no]));

        // 対戦相手の team_id を取るために、同じ match の両チーム行を取得
        const bothSides = await restGet<MatchTeamsRow[]>(
          `/rest/v1/match_teams?match_id=in.(${inM})&select=match_id,team_id,team_no`
        );
        const opponentMap = new Map<string, { opponent_team_id?: string | null; opponent_team_no?: number | null }>();
        for (const r of bothSides) {
          const myNo = byId.get(r.match_id);
          if (!myNo) continue;
          if (r.team_no !== myNo) {
            opponentMap.set(r.match_id, { opponent_team_id: r.team_id, opponent_team_no: r.team_no });
          }
        }
        // 相手チーム名を取得
        const opponentIds = Array.from(new Set(Array.from(opponentMap.values()).map((v) => v.opponent_team_id).filter(Boolean))) as string[];
        let opponentNameMap = new Map<string, string>();
        if (opponentIds.length) {
          const inOpp = opponentIds.map((id) => `"${id}"`).join(',');
          const oppTeams = await restGet<Team[]>(`/rest/v1/teams?id=in.(${inOpp})&select=id,name`);
          opponentNameMap = new Map(oppTeams.map((o) => [o.id, o.name]));
        }

        const rows = (matches ?? [])
          .filter((m) => m.mode === 'teams')
          .map((m) => {
            const my_team_no = byId.get(m.id) ?? 0;
            const win = (m.winner_team_no ?? 0) === my_team_no;
            const opp = opponentMap.get(m.id);
            const opponent_team_id = opp?.opponent_team_id ?? null;
            const opponent_team_name = opponent_team_id ? opponentNameMap.get(opponent_team_id) ?? null : null;
            return {
              ...m,
              my_team_no,
              result: win ? 'W' : 'L',
              opponent_team_id,
              opponent_team_name,
            };
          });

        setRecentMatches(
  rows.map(r => ({
    ...r,
    result: (r.winner_team_no === r.my_team_no ? 'W' : 'L') as 'W' | 'L',
  }))
);
    } catch (e: any) {
      setError(e?.message || '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    (async () => {
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId, load]);

  const wins = useMemo(() => recentMatches.filter((m) => m.result === 'W').length, [recentMatches]);
  const losses = useMemo(() => recentMatches.filter((m) => m.result === 'L').length, [recentMatches]);

  /* ========= レンダリング ========= */
  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8">
        {/* 戻る */}
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 text-purple-300 hover:text-purple-200"
          >
            <FaChevronLeft /> 戻る
          </button>
        </div>

        {/* ローディング / エラー / 無 */}
        {loading ? (
          <div className="grid gap-6">
            <div className="h-28 bg-white/10 rounded-xl animate-pulse" />
            <div className="h-48 bg-white/10 rounded-xl animate-pulse" />
            <div className="h-48 bg-white/10 rounded-xl animate-pulse" />
          </div>
        ) : error ? (
          <div className="p-4 rounded-xl border border-red-500/40 bg-red-500/10">{error}</div>
        ) : !team ? (
          <div className="p-6 rounded-xl border border-purple-500/30 bg-gray-900/50">チームが見つかりませんでした。</div>
        ) : (
          <>
            {/* ヘッダー */}
            <div className="p-6 rounded-2xl border border-purple-500/30 bg-gray-900/60 mb-6">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-purple-600/30 flex items-center justify-center">
                  <FaUsers className="text-2xl text-purple-200" />
                </div>
                <div className="flex-1">
                  <h1 className="text-2xl md:text-3xl font-bold text-yellow-100">{team.name}</h1>
                  <p className="text-gray-400 text-sm mt-1">{team.description || '—'}</p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <StatBox label="メンバー" value={teamRank?.team_size ?? members.length} />
                  <StatBox label="平均RP" value={Math.round(teamRank?.avg_rp ?? 0)} />
                  <StatBox
                    label="平均HC"
                    value={Math.round(teamRank?.avg_hc ?? 0)}
                  />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatBox icon="trophy" label="戦績(直近50)" value={`${wins} 勝 / ${losses} 敗`} />
                <StatBox
                  icon="medal"
                  label="勝率"
                  value={
                    teamRank?.win_pct != null
                      ? `${(teamRank.win_pct * 100).toFixed(1)}%`
                      : wins + losses > 0
                      ? `${((wins / (wins + losses)) * 100).toFixed(1)}%`
                      : '—'
                  }
                />
                <StatBox
                  icon="calendar"
                  label="最終試合"
                  value={
                    teamRank?.last_match_at
                      ? new Date(teamRank.last_match_at).toLocaleString()
                      : '—'
                  }
                />
                <StatBox label="試合数" value={teamRank?.played ?? recentMatches.length} />
              </div>
            </div>

            {/* メンバー */}
            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-3 text-purple-200">メンバー</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {members.length ? (
                  members.map((m) => (
                    <Link
                      key={m.player_id}
                      href={`/players/${m.player_id}`}
                      className="flex items-center gap-3 p-3 rounded-xl border border-purple-500/30 bg-gray-900/50 hover:border-purple-400/60 transition"
                    >
                      <LazyImg
                        src={m.player?.avatar_url}
                        alt={m.player?.handle_name || ''}
                        className="w-12 h-12 rounded-full border-2 border-purple-500 object-cover"
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-yellow-100 truncate">
                          {m.player?.handle_name ?? '(不明)'}
                        </p>
                        <p className="text-xs text-gray-400">
                          RP {m.player?.ranking_points ?? '-'} / HC {m.player?.handicap ?? '-'}
                          {m.role ? ` ・ ${m.role}` : ''}
                        </p>
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="col-span-full p-4 rounded-xl border border-purple-500/30 bg-gray-900/50 text-gray-300">
                    メンバー未設定
                  </div>
                )}
              </div>
            </section>

            {/* 直近の団体戦 */}
            <section>
              <h2 className="text-xl font-semibold mb-3 text-purple-200">直近の団体戦</h2>
              <div className="grid gap-3">
                {recentMatches.length ? (
                  recentMatches.slice(0, 20).map((m) => (
                    <div
                      key={m.id}
                      className={`flex items-center justify-between p-3 rounded-xl border bg-gray-900/50 ${
                        m.result === 'W' ? 'border-green-500/30' : 'border-red-500/30'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-purple-600/30 flex items-center justify-center">
                          <FaTrophy className={m.result === 'W' ? 'text-yellow-300' : 'text-gray-400'} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-yellow-100 truncate">
                            {m.result === 'W' ? '勝利' : '敗北'}（Team#{m.my_team_no})
                            <span className="mx-2 text-gray-500">
                              <FaArrowRight className="inline -mt-1" />
                            </span>
                            <Link
                              href={m.opponent_team_id ? `/teams/${m.opponent_team_id}` : '#'}
                              className="underline decoration-purple-400/60 hover:text-purple-200"
                            >
                              {m.opponent_team_name ?? '対戦相手不明'}
                            </Link>
                          </p>
                          <p className="text-xs text-gray-400">
                            {m.match_date ? new Date(m.match_date).toLocaleString() : '-'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-lg font-bold">
                          {m.winner_score ?? 15} - {m.loser_score ?? 0}
                        </p>
                        <p className="text-xs text-gray-400">モード: {m.mode}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-4 rounded-xl border border-purple-500/30 bg-gray-900/50 text-gray-300">
                    チーム戦の試合がまだありません
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/* ========= 部品 ========= */
function StatBox(props: { label: string; value: string | number; icon?: 'trophy' | 'medal' | 'calendar' }) {
  return (
    <div className="glass-card rounded-lg p-3 border border-purple-500/30 flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-purple-600/20 border border-purple-500/40 flex items-center justify-center">
        {props.icon === 'trophy' ? (
          <FaTrophy className="text-yellow-300" />
        ) : props.icon === 'medal' ? (
          <FaMedal className="text-purple-200" />
        ) : props.icon === 'calendar' ? (
          <FaCalendarAlt className="text-purple-200" />
        ) : (
          <FaUser className="text-purple-200" />
        )}
      </div>
      <div>
        <div className="text-xs text-gray-400">{props.label}</div>
        <div className="text-base font-semibold text-yellow-100">{props.value}</div>
      </div>
    </div>
  );
}
