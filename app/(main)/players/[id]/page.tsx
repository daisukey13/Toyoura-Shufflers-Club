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
  FaEdit,
  FaSpinner,
} from 'react-icons/fa';
import * as SBHooks from '@/lib/hooks/useFetchSupabaseData';
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

  // 表示制御
  is_active?: boolean | null;
  is_deleted?: boolean | null;

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

/**
 * ✅ PATCH（最小）：match_details の列名ブレ吸収
 */
function toInt(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function affectsRatingOf(m: any): boolean {
  // affects_rating が false の場合だけ「影響なし」扱い。それ以外（null/undefined含む）は影響あり扱い。
  return m?.affects_rating === false ? false : true;
}

function pointsChangeOf(m: any, isWin: boolean): number {
  const keys = isWin
    ? ['winner_points_change', 'winner_points_delta', 'winner_rp_delta', 'md_w_change', 'm_w_change']
    : ['loser_points_change', 'loser_points_delta', 'loser_rp_delta', 'md_l_change', 'm_l_change'];

  for (const k of keys) {
    const n = toInt(m?.[k]);
    if (n !== null) return n;
  }
  return 0;
}

function handicapChangeOf(m: any, isWin: boolean): number {
  const keys = isWin
    ? ['winner_handicap_change', 'winner_handicap_delta', 'winner_hc_change', 'winner_hc_delta']
    : ['loser_handicap_change', 'loser_handicap_delta', 'loser_hc_change', 'loser_hc_delta'];

  for (const k of keys) {
    const n = toInt(m?.[k]);
    if (n !== null) return n;
  }
  return 0;
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
      <div className={`absolute -inset-4 rounded-full blur-2xl opacity-40 ${t.glow}`} />
      <div className={`relative rounded-full p-1 bg-gradient-to-br ${t.ring}`}>
        <div className="rounded-full bg-[#1f1f2f] p-4 sm:p-5">
          <div className="flex items-center justify-center">
            <span className="font-extrabold tracking-tight text-6xl sm:text-7xl text-yellow-100 drop-shadow">
              {rank ?? '—'}
            </span>
          </div>
        </div>
      </div>

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

/* ───────────────────────────── Rank Trend (Snapshots) ───────────────────────────── */
type RankSnapshotRow = {
  snapshot_date: string; // date (JST基準で入っている想定: 'YYYY-MM-DD')
  rank: number;
  ranking_points?: number | null;
};

type TrendMode = 'daily' | 'weekly' | 'monthly';

function pickIntFrom(obj: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj?.[k];
    const n = toInt(v);
    if (n !== null && n > 0) return n;
  }
  return null;
}

function parseJstDate(dateStr: string) {
  // snapshot_date は 'YYYY-MM-DD' 想定。JSTとして解釈して表示を安定させる。
  return new Date(`${dateStr}T00:00:00+09:00`);
}

function fmtMD(dateStr: string) {
  const d = parseJstDate(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtYM(dateStr: string) {
  const d = parseJstDate(dateStr);
  return `${d.getFullYear()}/${d.getMonth() + 1}`;
}

/**
 * ✅ 重要：閲覧者のタイムゾーンに依存せず、常にJST基準で判定する
 * - JST正午で固定してUTC側で曜日/日付を取るとブレにくい
 */
function isJstMonday(dateStr: string) {
  return new Date(`${dateStr}T12:00:00+09:00`).getUTCDay() === 1; // Monday
}
function isJstFirstOfMonth(dateStr: string) {
  return new Date(`${dateStr}T12:00:00+09:00`).getUTCDate() === 1; // 1st
}

function MiniRankLine({
  points,
  currentRank,
}: {
  points: Array<{ label: string; rank: number }>;
  currentRank: number | null;
}) {
  const w = 320;
  const h = 120;
  const padX = 18;
  const padY = 14;

  const ranks = points.map((p) => p.rank).filter((n) => Number.isFinite(n) && n > 0);
  if (ranks.length === 0) {
    return <div className="text-sm text-gray-400">データがありません。</div>;
  }

  const n = ranks.length;
  const minR = Math.min(...ranks);
  const maxR = Math.max(...ranks);
  const spanR = Math.max(1, maxR - minR);

  const xOf = (i: number) => {
    if (n === 1) return w / 2;
    return padX + (i * (w - padX * 2)) / (n - 1);
  };
  const yOf = (rank: number) => {
    // rankが小さいほど上（yが小さい）
    return padY + ((rank - minR) * (h - padY * 2)) / spanR;
  };

  const coords = ranks.map((r, i) => [xOf(i), yOf(r)] as const);
  const path = coords
    .map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`))
    .join(' ');

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-gray-300">順位推移</div>
        <div className="text-xs text-gray-400">
          現在: <span className="text-yellow-100 font-semibold">{currentRank ?? '—'}位</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${w} 0 ${w} ${h}`} className="w-full h-[120px]">
        <rect x="0" y="0" width={w} height={h} rx="12" className="fill-black/20" />
        <path d={path} className="stroke-purple-300" strokeWidth="2.5" fill="none" />
        {coords.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="4" className="fill-yellow-100/90" />
        ))}
      </svg>

      <div className="mt-2 flex justify-between text-[11px] text-gray-400">
        {points.map((p, i) => (
          <span key={i} className="tabular-nums">
            {p.label || ' '}
          </span>
        ))}
      </div>

      <div className="mt-2 text-[11px] text-gray-500">※ 0:00（JST）集計の順位スナップショットを表示します</div>
    </div>
  );
}

/* ───────────────────────────── Page ───────────────────────────── */
export default function PlayerProfilePage() {
  const params = useParams<{ id: string }>();
  const playerId = params?.id;

  // 個別プレイヤー詳細（試合履歴など）
  const { player, matches, loading, error } = SBHooks.useFetchPlayerDetail(playerId, { requireAuth: false });

  // ★閲覧者（本人/管理者）判定：非表示プレイヤーのガード＆編集導線に使用
  const [viewerChecked, setViewerChecked] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [viewerIsAdmin, setViewerIsAdmin] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data.user?.id ?? null;
        if (cancelled) return;

        setViewerId(uid);

        if (!uid) {
          setViewerIsAdmin(false);
          return;
        }

        const { data: priv, error: privErr } = await supabase
          .from('players_private')
          .select('is_admin')
          .eq('player_id', uid)
          .maybeSingle();

        if (cancelled) return;
        setViewerIsAdmin(!privErr && !!(priv as any)?.is_admin);
      } catch {
        if (!cancelled) {
          setViewerId(null);
          setViewerIsAdmin(false);
        }
      } finally {
        if (!cancelled) setViewerChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const isHidden = useMemo(() => {
    const p = player as any as Player | null;
    if (!p) return false;
    return p?.is_deleted === true || p?.is_active === false;
  }, [player]);

  const canViewHidden = useMemo(() => {
    return viewerIsAdmin || (!!viewerId && viewerId === playerId);
  }, [viewerIsAdmin, viewerId, playerId]);

  // 全プレイヤーから順位算出（RP降順）※useFetchPlayersData は inactive/deleted を既定で除外
  const { players: allPlayers } = SBHooks.useFetchPlayersData({ requireAuth: false });
  const { rank, totalActive } = useMemo(() => {
    const src = Array.isArray(allPlayers) ? allPlayers : [];
    const arr = [...src].sort((a: any, b: any) => (b.ranking_points ?? 0) - (a.ranking_points ?? 0));
    const idx = arr.findIndex((p: any) => p.id === playerId);
    return { rank: idx >= 0 ? idx + 1 : null, totalActive: arr.length };
  }, [allPlayers, playerId]);

  const wr = winRateOf(player as any);
  const games = gamesOf(player as any);

  /* ───────── 所属チームを取得（フォールバック版） ───────── */
  const [teams, setTeams] = useState<TeamWithRole[]>([]);
  const [teamsLoading, setTeamsLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      if (!playerId) return;

      // ★非表示で閲覧権限がない場合は、所属取得もしない（無駄な問い合わせを減らす）
      if (viewerChecked && isHidden && !canViewHidden) {
        if (!cancelled) {
          setTeams([]);
          setTeamsLoading(false);
        }
        return;
      }

      setTeamsLoading(true);
      try {
        const membershipCandidates = [
          { table: 'team_members', playerCol: 'player_id', teamCol: 'team_id', roleCol: 'role' },
          { table: 'players_teams', playerCol: 'player_id', teamCol: 'team_id', roleCol: null },
          { table: 'team_players', playerCol: 'player_id', teamCol: 'team_id', roleCol: null },
          { table: 'memberships', playerCol: 'player_id', teamCol: 'team_id', roleCol: 'role' },
        ] as const;

        let memberRows: TeamMemberRow[] = [];
        let lastErr: any = null;

        for (const c of membershipCandidates) {
          const sel = c.roleCol ? `${c.teamCol}, ${c.roleCol}` : `${c.teamCol}`;
          const { data, error } = await (supabase as any).from(c.table).select(sel).eq(c.playerCol, playerId);

          if (!error && data) {
            memberRows = (data as any[]).map((r) => ({
              team_id: r[c.teamCol] ?? null,
              role: c.roleCol ? r[c.roleCol] ?? null : null,
            }));
            break;
          } else {
            lastErr = error;
          }
        }

        const ids: string[] = (memberRows ?? [])
          .map((r) => r.team_id)
          .filter((v): v is string => typeof v === 'string' && v.length > 0);

        if (ids.length === 0) {
          if (!cancelled) {
            if (lastErr) console.warn('[player profile] membership lookup fallback last error:', lastErr);
            setTeams([]);
            setTeamsLoading(false);
          }
          return;
        }

        const { data: teamRows, error: tErr } = await (supabase.from('teams') as any)
          .select('id, name, avatar_url')
          .in('id', ids);
        if (tErr) throw tErr;

        const teamsRaw = (teamRows ?? []) as Team[];

        const roleMap = new Map<string, string | null>();
        (memberRows ?? []).forEach((r) => {
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
  }, [playerId, viewerChecked, isHidden, canViewHidden]);

  /* ───────── 順位スナップショット設定（ranking_config） + 取得 ───────── */
  const [trendMode, setTrendMode] = useState<TrendMode>('daily');
  const [trendCfg, setTrendCfg] = useState<{ days: number; weeks: number; months: number }>({
    days: 5,
    weeks: 5,
    months: 5,
  });

  // ✅ 取得後に「デフォルトモード」を1回だけ適用（ユーザー操作を上書きしない）
  const [trendModeInit, setTrendModeInit] = useState(false);

  const [snapLoading, setSnapLoading] = useState(false);
  const [snapMsg, setSnapMsg] = useState<string>('');
  const [snapRows, setSnapRows] = useState<RankSnapshotRow[]>([]);

  // 1) ranking_config 取得（✅ id='global' を優先 → 無ければ先頭1行）
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      try {
        let cfg: any = null;

        const q1 = await (supabase.from('ranking_config') as any).select('*').eq('id', 'global').maybeSingle();
        if (!q1.error && q1.data) {
          cfg = q1.data;
        } else {
          const q2 = await (supabase.from('ranking_config') as any).select('*').limit(1).maybeSingle();
          if (!q2.error && q2.data) cfg = q2.data;
        }

        if (cancelled) return;
        if (!cfg) return;

        const days =
          pickIntFrom(cfg, [
            'trend_daily_days',
            'profile_trend_days',
            'player_profile_trend_days',
            'rank_trend_days',
            'rank_snapshot_days',
            'trend_days',
            'display_days',
          ]) ?? 5;

        const weeks =
          pickIntFrom(cfg, [
            'trend_weekly_weeks',
            'profile_trend_weeks',
            'player_profile_trend_weeks',
            'rank_trend_weeks',
            'trend_weeks',
          ]) ?? 5;

        const months =
          pickIntFrom(cfg, [
            'trend_monthly_months',
            'profile_trend_months',
            'player_profile_trend_months',
            'rank_trend_months',
            'trend_months',
          ]) ?? 5;

        setTrendCfg({ days, weeks, months });

        const mode = String(
          cfg?.trend_default_mode ??
            cfg?.profile_trend_mode ??
            cfg?.player_profile_trend_mode ??
            cfg?.rank_trend_mode ??
            ''
        ).toLowerCase();

        // ✅ 初回だけ適用
        if (!trendModeInit && (mode === 'weekly' || mode === 'monthly' || mode === 'daily')) {
          setTrendMode(mode as TrendMode);
          setTrendModeInit(true);
        } else if (!trendModeInit) {
          setTrendModeInit(true);
        }
      } catch (e) {
        // 失敗時は既定値のまま（UIは動く）
        if (!trendModeInit) setTrendModeInit(true);
        console.warn('[player profile] ranking_config load failed:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) rank_snapshots 取得（プレーヤーごと）
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      if (!playerId) return;

      // 非表示＆閲覧権限なしの場合は取得しない
      if (viewerChecked && isHidden && !canViewHidden) return;

      setSnapLoading(true);
      setSnapMsg('');
      try {
        const { data, error } = await (supabase.from('rank_snapshots') as any)
          .select('snapshot_date, rank, ranking_points')
          .eq('player_id', playerId)
          .order('snapshot_date', { ascending: false })
          .limit(400);

        if (cancelled) return;
        if (error) throw error;

        setSnapRows((data ?? []) as RankSnapshotRow[]);
      } catch (e: any) {
        if (!cancelled) {
          setSnapRows([]);
          setSnapMsg(e?.message ?? '順位履歴の取得に失敗しました');
        }
      } finally {
        if (!cancelled) setSnapLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [playerId, viewerChecked, isHidden, canViewHidden]);

  const trendTitle = useMemo(() => {
    if (trendMode === 'daily') return `直近${trendCfg.days}日間の順位変化`;
    if (trendMode === 'weekly') return `直近 毎週月曜ごと${trendCfg.weeks}週間分の変化`;
    return `直近 毎月1日ごと${trendCfg.months}ヶ月分の変化`;
  }, [trendMode, trendCfg.days, trendCfg.weeks, trendCfg.months]);

  const trendPoints = useMemo(() => {
    const rows = Array.isArray(snapRows) ? snapRows : [];
    if (rows.length === 0) return [] as Array<{ label: string; rank: number }>;

    if (trendMode === 'daily') {
      const take = Math.max(1, trendCfg.days);
      const picked = rows.slice(0, take).reverse();
      return picked.map((r) => ({ label: fmtMD(r.snapshot_date), rank: r.rank }));
    }

    if (trendMode === 'weekly') {
      const take = Math.max(1, trendCfg.weeks);
      const mondays = rows.filter((r) => isJstMonday(r.snapshot_date));
      const picked = mondays.slice(0, take).reverse();
      return picked.map((r) => ({ label: fmtMD(r.snapshot_date), rank: r.rank }));
    }

    // monthly
    {
      const take = Math.max(1, trendCfg.months);
      const firstDays = rows.filter((r) => isJstFirstOfMonth(r.snapshot_date));
      const picked = firstDays.slice(0, take).reverse();
      return picked.map((r) => ({ label: fmtYM(r.snapshot_date), rank: r.rank }));
    }
  }, [snapRows, trendMode, trendCfg.days, trendCfg.weeks, trendCfg.months]);

  const currentSnapRank = useMemo(() => {
    const rows = Array.isArray(snapRows) ? snapRows : [];
    return rows.length ? rows[0].rank : null;
  }, [snapRows]);

  const emptyTrendMsg = useMemo(() => {
    if (trendMode === 'daily') {
      return 'まだ順位履歴がありません。毎日0時（JST）の集計が溜まると表示されます。';
    }
    if (trendMode === 'weekly') {
      return '週表示は「月曜0時（JST）時点」の記録が必要です。次の月曜集計以降に表示されます。';
    }
    return '月表示は「毎月1日0時（JST）時点」の記録が必要です。次の月初集計以降に表示されます。';
  }, [trendMode]);

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-6 sm:py-8">
        {/* アクション（戻る / 編集） */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <Link href="/players" className="inline-flex items-center gap-2 text-purple-300 hover:text-purple-200">
            <FaArrowLeft /> 一覧へ戻る
          </Link>

          {/* ★管理者 or 本人のみ編集導線 */}
          {viewerChecked && (viewerIsAdmin || (!!viewerId && viewerId === playerId)) && (
            <Link
              href={`/players/${playerId}/edit`}
              prefetch={false}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg
                         bg-gray-900/60 border border-purple-500/30 text-purple-200
                         hover:border-purple-400/60 hover:text-purple-100 transition-colors"
              aria-label="プレーヤー情報を編集"
            >
              <FaEdit /> 編集
            </Link>
          )}
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

        {/* ★非表示プレーヤー：権限確認中は情報を出さない（チラ見え防止） */}
        {!loading && !error && player && (player as any).is_deleted === true && !viewerChecked && (
          <div className="max-w-4xl mx-auto glass-card rounded-2xl p-6 sm:p-8 border border-purple-500/30">
            <div className="text-gray-300">権限を確認中…</div>
          </div>
        )}

        {/* 表示OKなら通常表示 */}
        {!loading && !error && player && (
          <div className="max-w-5xl mx-auto space-y-6 sm:space-y-8">
            {/* ── ヒーロー：巨大ランク＋基本情報 ── */}
            <div className="glass-card rounded-2xl p-6 sm:p-8 border border-purple-500/30">
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 sm:gap-8">
                <div className="shrink-0">
                  <HugeRankBadge rank={rank} />
                  <div className="text-center mt-2 text-xs sm:text-sm text-gray-400">
                    {rank ? `全${totalActive}人中` : '順位集計外'}
                  </div>
                </div>

                <div className="flex-1 w-full">
                  <div className="flex items-center gap-4 sm:gap-5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={(player as any).avatar_url || '/default-avatar.png'}
                      alt={(player as any).handle_name}
                      className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-purple-500/40 object-cover"
                    />
                    <div className="min-w-0">
                      <h1 className="text-2xl sm:text-3xl font-extrabold text-yellow-100 truncate">
                        {(player as any).handle_name}
                      </h1>
                    </div>
                  </div>

                  {/* RP / HC */}
                  <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4">
                    <div className="text-center rounded-xl bg-gray-900/60 border border-purple-500/30 p-4 sm:p-5">
                      <div className="flex items-center justify-center gap-2 text-purple-200 mb-1">
                        <FaMedal className="text-lg sm:text-xl" />
                        <span className="text-xs sm:text-sm">ランキングポイント</span>
                      </div>
                      <div className="text-4xl sm:text-5xl font-black text-yellow-100 tracking-tight">
                        {(player as any).ranking_points ?? 0}
                      </div>
                    </div>
                    <div className="text-center rounded-xl bg-gray-900/60 border border-purple-500/30 p-4 sm:p-5">
                      <div className="flex items-center justify-center gap-2 text-blue-200 mb-1">
                        <FaChartLine className="text-lg sm:text-xl" />
                        <span className="text-xs sm:text-sm">ハンディキャップ</span>
                      </div>
                      <div className="text-4xl sm:text-5xl font-black text-blue-100 tracking-tight">
                        {(player as any).handicap ?? 0}
                      </div>
                    </div>
                  </div>

                  {/* 勝利/敗北/勝率 */}
                  <div className="mt-5 grid grid-cols-3 gap-3 sm:gap-4">
                    <div className="text-center rounded-xl bg-gray-900/60 border border-purple-500/20 p-3 sm:p-4">
                      <div className="text-2xl font-extrabold text-green-400">{(player as any).wins ?? 0}</div>
                      <div className="text-xs sm:text-sm text-gray-400">勝利</div>
                    </div>
                    <div className="text-center rounded-xl bg-gray-900/60 border border-purple-500/20 p-3 sm:p-4">
                      <div className="text-2xl font-extrabold text-red-400">{(player as any).losses ?? 0}</div>
                      <div className="text-xs sm:text-sm text-gray-400">敗北</div>
                    </div>
                    <div className="text-center rounded-xl bg-gray-900/60 border border-purple-500/20 p-3 sm:p-4">
                      <div className="text-2xl font-extrabold text-blue-400">{wr}%</div>
                      <div className="text-xs sm:text-sm text-gray-400">勝率</div>
                    </div>
                  </div>

                  {/* 勝率バー */}
                  <div className="mt-3 sm:mt-4">
                    <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          wr >= 60 ? 'bg-green-500' : wr >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${wr}%` }}
                      />
                    </div>
                    <div className="mt-1 text-right text-xs text-gray-500">{games} 試合</div>
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
                        {t.role && <div className="text-xs text-purple-300 truncate">役割: {t.role}</div>}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* ── ✅ 順位推移グラフ ───────────────── */}
            <div className="glass-card rounded-2xl p-6 sm:p-7 border border-purple-500/30">
              <div className="flex items-start justify-between gap-3 mb-4 sm:mb-5">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-yellow-100 flex items-center gap-2">
                    <FaChartLine className="text-purple-300" />
                    {trendTitle}
                  </h2>
                  <div className="text-xs text-gray-400 mt-1">※ 0:00（JST）更新の順位を表示します</div>
                </div>

                <div className="shrink-0">
                  <label className="block text-[11px] text-gray-400 mb-1">表示間隔</label>
                  <select
                    value={trendMode}
                    onChange={(e) => setTrendMode(e.target.value as TrendMode)}
                    className="px-3 py-2 rounded-lg bg-gray-900/60 border border-purple-500/30 text-gray-100 text-sm
                               focus:outline-none focus:border-purple-400"
                  >
                    <option value="daily">直近{trendCfg.days}日</option>
                    <option value="weekly">毎週月曜（直近{trendCfg.weeks}週）</option>
                    <option value="monthly">毎月1日（直近{trendCfg.months}ヶ月）</option>
                  </select>
                </div>
              </div>

              {snapLoading ? (
                <div className="text-gray-400 py-8 text-center">
                  <FaSpinner className="inline mr-2 animate-spin" />
                  読み込み中…
                </div>
              ) : snapMsg ? (
                <div className="text-sm text-gray-300">{snapMsg}</div>
              ) : trendPoints.length === 0 ? (
                <div className="text-sm text-gray-400">{emptyTrendMsg}</div>
              ) : (
                <div className="rounded-xl border border-purple-500/20 bg-purple-900/10 p-3">
                  <MiniRankLine points={trendPoints} currentRank={currentSnapRank ?? rank ?? null} />
                </div>
              )}
            </div>

            {/* ── 直近の試合（簡易） ──────────────────────────── */}
            <div className="glass-card rounded-2xl p-6 sm:p-7 border border-purple-500/30">
              <h2 className="text-lg sm:text-xl font-bold text-yellow-100 mb-4 sm:mb-5">直近の試合</h2>

              {(!matches || matches.length === 0) && <div className="text-gray-400">まだ試合がありません。</div>}

              {Array.isArray(matches) && matches.length > 0 && (
                <div className="space-y-3">
                  {matches.slice(0, 8).map((m: any) => {
                    const isWin = m.winner_id === playerId;
                    const oppName = m.winner_id === playerId ? m.loser_name : m.winner_name;
                    const oppId = m.winner_id === playerId ? m.loser_id : m.winner_id;

                    const showDelta = affectsRatingOf(m);
                    const delta = pointsChangeOf(m, isWin);
                    const hcDelta = handicapChangeOf(m, isWin);

                    // ✅ 最小追加：大会判定＆表示（UI構成は維持）
                    const isTournament = m?.is_tournament === true;
                    const tName = (m?.tournament_name ?? '').toString().trim();
                    const isFinal =
                      m?.is_final === true ||
                      m?.is_finals === true ||
                      m?.result_type === 'final' ||
                      m?.kind === 'final';

                    // ✅ ここが今回の要件：常に「自分のスコア」を左にする
                    const selfIsWinner = m.winner_id === playerId;

                    const winnerScore =
                      toInt(m?.winner_score) ?? toInt(m?.score_winner) ?? toInt(m?.w_score) ?? 15;

                    const loserScore =
                      toInt(m?.loser_score) ?? toInt(m?.score_loser) ?? toInt(m?.l_score) ?? 0;

                    const selfScore = selfIsWinner ? winnerScore : loserScore;
                    const oppScore = selfIsWinner ? loserScore : winnerScore;

                    return (
                      <div
                        key={m.id}
                        className={`rounded-xl p-3 sm:p-4 border transition-colors ${
                          isWin ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs text-gray-400">
                              {m.match_date
                                ? new Date(m.match_date).toLocaleString('ja-JP', {
                                    month: 'numeric',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : '—'}
                            </div>

                            {isTournament && (
                              <div className="mt-1 flex items-center gap-2 text-xs text-yellow-200/90">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/15 border border-yellow-500/25">
                                  🏆 大会
                                </span>
                                {tName && <span className="font-semibold text-yellow-100 truncate">{tName}</span>}
                                {isFinal && (
                                  <span className="px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/25 text-purple-200">
                                    Finals
                                  </span>
                                )}
                              </div>
                            )}

                            <div className="font-semibold text-yellow-100 truncate">
                              {isWin ? '勝利' : '敗北'}：{oppName}
                            </div>
                          </div>

                          {/* ✅ 自分が必ず左に来るスコア表示 */}
                          <div className="text-right">
                            <div className="text-lg sm:text-xl font-extrabold text-white">
                              {selfScore} - {oppScore}
                            </div>

                            {showDelta ? (
                              <>
                                <div className={`text-xs sm:text-sm ${isWin ? 'text-green-300' : 'text-red-300'}`}>
                                  {delta > 0 ? '+' : ''}
                                  {delta}
                                  pt
                                </div>
                                <div className="text-xs sm:text-sm text-gray-300">
                                  HC {hcDelta > 0 ? '+' : ''}
                                  {hcDelta}
                                </div>
                              </>
                            ) : (
                              <div className="text-xs text-gray-400 mt-1">※ ランキング反映なし</div>
                            )}
                          </div>
                        </div>

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
                <Link href="/matches" className="inline-flex items-center gap-2 text-purple-300 hover:text-purple-200">
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
