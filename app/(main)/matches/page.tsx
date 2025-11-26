// app/(main)/matches/page.tsx
'use client';

import {
  useState,
  useMemo,
  memo,
  useCallback,
  lazy,
  Suspense,
  useEffect,
} from 'react';
import {
  FaTrophy,
  FaCalendar,
  FaMapMarkerAlt,
  FaMedal,
  FaHistory,
  FaGamepad,
  FaStar,
  FaUsers,
  FaUser,
} from 'react-icons/fa';
import Link from 'next/link';
import { useFetchMatchesData as useMatchesData } from '@/lib/hooks/useFetchMatchesData';
import { MobileLoadingState } from '@/components/MobileLoadingState';
import { useRouter } from 'next/navigation';


// 仮想スクロール（大画面＆件数多い時のみ使用）
const VirtualList = lazy(() => import('@/components/VirtualList'));

/* ─────────────── REST (チームメンバー取得/プレイヤー補完に使用) ─────────────── */
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

/* ─────────────── 画面幅フラグ（sm < 640px） ─────────────── */
function useIsSmallScreen() {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const onChange = (e: MediaQueryListEvent | MediaQueryList) =>
      setSmall('matches' in e ? e.matches : (e as MediaQueryList).matches);
    setSmall(mq.matches);
    // @ts-ignore (Safari古い版対策)
    mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
    return () => {
      // @ts-ignore
      mq.removeEventListener ? mq.removeEventListener('change', onChange) : mq.removeListener(onChange);
    };
  }, []);
  return small;
}

/** match_details ビュー想定の型（個人戦/団体戦の両方を吸収） */
interface MatchDetails {
  id: string;

  // 時系列
  match_date: string;

  // 区別
  mode?: 'singles' | 'teams' | string | null;

  // 個人戦フィールド
  winner_id?: string | null;
  winner_name?: string | null;
  winner_avatar?: string | null; // 既存コード互換
  winner_avatar_url?: string | null; // ビュー側実装によってはこちらになる場合
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

  // 団体戦フィールド
  winner_team_id?: string | null;
  winner_team_name?: string | null;
  loser_team_id?: string | null;
  loser_team_name?: string | null;

  // 任意メタ
  is_tournament?: boolean | null;
  tournament_name?: string | null;
  venue?: string | null;
  notes?: string | null;

  // （ビュー側が別名で返す可能性に備えて any で拾えるようにする）
  [key: string]: any;
}

type MemberProfile = {
  id: string;
  handle_name: string;
  avatar_url?: string | null;
};

type PlayerLite = {
  id: string;
  handle_name: string;
  avatar_url?: string | null;
  ranking_points?: number | null;
  handicap?: number | null;
};

/* 画像の遅延読み込み（next/image を使わず最軽量） */
const LazyImage = ({
  src,
  alt,
  className,
}: {
  src?: string | null;
  alt: string;
  className: string;
}) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src={src || '/default-avatar.png'}
    alt={alt}
    className={className}
    loading="lazy"
    decoding="async"
    onError={(e) => {
      (e.target as HTMLImageElement).src = '/default-avatar.png';
    }}
  />
);

/* ─────────────── 値のフォールバック（ビューの列名揺れ対策） ─────────────── */
function pickNumber(m: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = m?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}
function pickString(m: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = m?.[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
}

/* ─────────────── 共通UI ─────────────── */

const ModeChip = ({ mode }: { mode?: MatchDetails['mode'] }) => {
  const isTeams = mode === 'teams';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] ${
        isTeams
          ? 'bg-yellow-500/15 text-yellow-300 border border-yellow-400/30'
          : 'bg-purple-500/15 text-purple-200 border border-purple-400/30'
      }`}
      title={isTeams ? '団体戦' : '個人戦'}
    >
      {isTeams ? <FaUsers /> : <FaUser />}
      {isTeams ? 'teams' : 'singles'}
    </span>
  );
};

const ScoreDiffPill = ({
  diff,
  highlight,
}: {
  diff: number;
  highlight?: 'upset';
}) => {
  const color =
    diff >= 10
      ? 'from-red-500 to-red-600'
      : diff >= 5
      ? 'from-orange-500 to-orange-600'
      : 'from-blue-500 to-blue-600';
  return (
    <div
      className={`inline-flex items-center justify-center w-12 h-12 sm:w-16 sm:h-16 rounded-full shadow-lg ${
        highlight === 'upset'
          ? 'bg-gradient-to-r from-yellow-500/80 to-orange-500/80'
          : `bg-gradient-to-r ${color}`
      }`}
      title={`点差: ${diff}`}
    >
      <span className="text-white font-bold text-sm sm:text-lg">VS</span>
    </div>
  );
};

const MetaLine = ({ m }: { m: MatchDetails }) => {
  const d = useMemo(() => {
    const date = new Date(m.match_date);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    if (sameDay)
      return `今日 ${date.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
    return date.toLocaleString();
  }, [m.match_date]);

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3 sm:mb-4 text-xs sm:text-sm">
      {m.is_tournament && m.tournament_name && (
        <span className="px-2 sm:px-3 py-1 rounded-full bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 text-yellow-400 flex items-center gap-1">
          <FaMedal className="text-xs" />
          <span className="truncate max-w-[150px] sm:max-w-none">
            {m.tournament_name}
          </span>
        </span>
      )}
      <ModeChip mode={m.mode} />
      <span className="text-gray-400 flex items-center gap-1">
        <FaCalendar className="text-xs" />
        {d}
      </span>
      {m.venue && (
        <span className="text-gray-400 flex items-center gap-1">
          <FaMapMarkerAlt className="text-xs" />
          <span className="truncate max-w-[100px] sm:max-w-none">
            {m.venue}
          </span>
        </span>
      )}
    </div>
  );
};

/* ─────────────── 個人戦カード ─────────────── */

const SinglesCard = memo(function SinglesCard({
  m,
  playersById,
}: {
  m: MatchDetails;
  playersById: Record<string, PlayerLite>;
}) {
  const loserScore = m.loser_score ?? 0;
  const scoreDiff = 15 - loserScore;

  const wid = m.winner_id ?? '';
  const lid = m.loser_id ?? '';

  // ✅ ビューが返さなくなっても players から補完
  const wProfile = wid ? playersById[wid] : undefined;
  const lProfile = lid ? playersById[lid] : undefined;

  const wName =
    m.winner_name ??
    pickString(m, ['winner_handle_name', 'winner_player_name']) ??
    wProfile?.handle_name ??
    '';
  const lName =
    m.loser_name ??
    pickString(m, ['loser_handle_name', 'loser_player_name']) ??
    lProfile?.handle_name ??
    '';

  const wAvatar =
    m.winner_avatar ??
    m.winner_avatar_url ??
    pickString(m, ['winner_avatar_url', 'winner_avatar']) ??
    wProfile?.avatar_url ??
    null;

  const lAvatar =
    m.loser_avatar ??
    m.loser_avatar_url ??
    pickString(m, ['loser_avatar_url', 'loser_avatar']) ??
    lProfile?.avatar_url ??
    null;

  const wRP =
    m.winner_current_points ??
    pickNumber(m, ['winner_ranking_points', 'winner_points', 'winner_rp']) ??
    wProfile?.ranking_points ??
    0;

  const wHC =
    m.winner_current_handicap ??
    pickNumber(m, ['winner_handicap', 'winner_hc']) ??
    wProfile?.handicap ??
    0;

  const lRP =
    m.loser_current_points ??
    pickNumber(m, ['loser_ranking_points', 'loser_points', 'loser_rp']) ??
    lProfile?.ranking_points ??
    0;

  const lHC =
    m.loser_current_handicap ??
    pickNumber(m, ['loser_handicap', 'loser_hc']) ??
    lProfile?.handicap ??
    0;

  const wDelta =
    m.winner_points_change ??
    pickNumber(m, ['winner_points_delta', 'winner_change']) ??
    0;

  const lDelta =
    m.loser_points_change ??
    pickNumber(m, ['loser_points_delta', 'loser_change']) ??
    0;

  const isUpset = useMemo(() => {
    // 今は表示値（補完後）で判定
    return wRP < lRP - 100 || wHC > lHC + 5;
  }, [wRP, lRP, wHC, lHC]);

  return (
    <div
      className={`bg-gray-900/60 backdrop-blur-md rounded-xl p-4 sm:p-6 border transition-all relative ${
        isUpset
          ? 'border-yellow-500/50 shadow-lg shadow-yellow-500/10'
          : 'border-purple-500/30 hover:border-purple-400/50'
      }`}
    >
      {isUpset && (
        <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
          <span className="px-2 sm:px-3 py-1 rounded-full bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 text-yellow-400 text-xs font-medium flex items-center gap-1">
            <FaStar className="text-xs" />
            <span className="hidden sm:inline">番狂わせ</span>
          </span>
        </div>
      )}

      <MetaLine m={m} />

      <div className="grid grid-cols-1 gap-3 sm:gap-4">
        <div className="sm:grid sm:grid-cols-3 sm:items-center gap-3 sm:gap-4">
          {/* 勝者 */}
          <Link href={`/players/${wid}`} prefetch={false} className="group">
            <div
              className={`flex items-center gap-3 p-3 sm:p-4 rounded-lg border transition-all ${
                isUpset
                  ? 'bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border-yellow-500/30 group-hover:border-yellow-400/50'
                  : 'bg-gradient-to-r from-green-500/10 to-emerald-500/10 border-green-500/30 group-hover:border-green-400/50'
              }`}
            >
              <LazyImage
                src={wAvatar}
                alt={wName || ''}
                className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 ${
                  isUpset ? 'border-yellow-500/50' : 'border-green-500/50'
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white group-hover:text-purple-400 transition-colors truncate">
                  {wName}
                </p>
                <p
                  className={`text-xs sm:text-sm ${
                    isUpset ? 'text-yellow-400' : 'text-green-400'
                  }`}
                >
                  勝利
                </p>
                <div className="flex gap-3 text-xs text-gray-400">
                  <span>RP: {wRP}</span>
                  <span>HC: {wHC}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xl sm:text-2xl font-bold text-white">15</p>
                <p
                  className={`text-xs sm:text-sm font-medium ${
                    wDelta > 0 ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {wDelta > 0 ? '+' : ''}
                  {wDelta}pt
                </p>
              </div>
            </div>
          </Link>

          {/* VS */}
          <div className="text-center my-2 sm:my-0">
            <ScoreDiffPill
              diff={scoreDiff}
              highlight={isUpset ? 'upset' : undefined}
            />
            <p className="text-xs sm:text-sm text-gray-400 mt-1 sm:mt-2">
              点差: {scoreDiff}
            </p>
          </div>

          {/* 敗者 */}
          <Link href={`/players/${lid}`} prefetch={false} className="group">
            <div className="flex items-center gap-3 p-3 sm:p-4 rounded-lg bg-gradient-to-r from-red-500/10 to-pink-500/10 border border-red-500/30 group-hover:border-red-400/50 transition-all">
              <LazyImage
                src={lAvatar}
                alt={lName || ''}
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 border-red-500/50"
              />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white group-hover:text-purple-400 transition-colors truncate">
                  {lName}
                </p>
                <p className="text-xs sm:text-sm text-red-400">敗北</p>
                <div className="flex gap-3 text-xs text-gray-400">
                  <span>RP: {lRP}</span>
                  <span>HC: {lHC}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xl sm:text-2xl font-bold text-white">
                  {loserScore}
                </p>
                <p className="text-xs sm:text-sm text-red-400 font-medium">
                  {lDelta}pt
                </p>
              </div>
            </div>
          </Link>
        </div>
      </div>

      {m.notes && (
        <div className="mt-3 sm:mt-4 p-2.5 sm:p-3 bg-gray-800/50 rounded-lg border-l-4 border-purple-500/50">
          <p className="text-xs sm:text-sm text-gray-300">{m.notes}</p>
        </div>
      )}
    </div>
  );
});

/* ─────────────── 団体戦カード（チームのメンバー表示付き） ─────────────── */

function TeamMembersRow({ members }: { members: MemberProfile[] }) {
  const router = useRouter();

  if (!members?.length) return null;
  const shown = members.slice(0, 4);
  const rest = members.length - shown.length;

  return (
    <div className="mt-1">
      {/* アバター重ね表示 */}
      <div className="flex -space-x-3">
        {shown.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.handle_name}
            onClick={(e) => {
              e.preventDefault(); // 親の Link クリックを止める
              e.stopPropagation();
              router.push(`/players/${p.id}`);
            }}
            className="block"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.avatar_url || '/default-avatar.png'}
              alt={p.handle_name}
              className="w-7 h-7 rounded-full border-2 border-gray-900 object-cover"
              loading="lazy"
              decoding="async"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/default-avatar.png';
              }}
            />
          </button>
        ))}
        {rest > 0 && (
          <div className="w-7 h-7 rounded-full border-2 border-gray-900 bg-gray-700 text-white text-[10px] flex items-center justify-center">
            +{rest}
          </div>
        )}
      </div>

      {/* 名前リスト（小さく・折り返し） */}
      <div className="text-[11px] text-gray-300 mt-1 line-clamp-1">
        {members.map((m) => m.handle_name).join(' / ')}
      </div>
    </div>
  );
}


const TeamsCard = memo(function TeamsCard({
  m,
  membersByTeam,
}: {
  m: MatchDetails;
  membersByTeam: Record<string, MemberProfile[]>;
}) {
  const loserScore = m.loser_score ?? 0;
  const scoreDiff = 15 - loserScore;

  const winnerMembers = m.winner_team_id
    ? membersByTeam[m.winner_team_id] ?? []
    : [];
  const loserMembers = m.loser_team_id
    ? membersByTeam[m.loser_team_id] ?? []
    : [];

  return (
    <div className="bg-gray-900/60 backdrop-blur-md rounded-xl p-4 sm:p-6 border border-purple-500/30 hover:border-purple-400/50 transition-all">
      <MetaLine m={m} />

      <div className="grid grid-cols-1 gap-3 sm:gap-4">
        <div className="sm:grid sm:grid-cols-3 sm:items-center gap-3 sm:gap-4">
          {/* 勝利チーム */}
          <Link
            href={`/teams/${m.winner_team_id ?? ''}`}
            prefetch={false}
            className="group"
          >
            <div className="flex-1 flex items-center gap-3 p-3 sm:p-4 rounded-lg bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 group-hover:border-green-400/50 transition-all">
              <span className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-yellow-500/20 border-2 border-yellow-400/40 flex items-center justify-center">
                <FaUsers className="text-yellow-300" />
              </span>
              <div className="min-w-0">
                <p className="font-bold text-white group-hover:text-purple-400 transition-colors truncate">
                  {m.winner_team_name ?? '—'}
                </p>
                <p className="text-xs sm:text-sm text-green-400">勝利</p>
                <TeamMembersRow members={winnerMembers} />
              </div>
              <div className="ml-auto text-right">
                <p className="text-xl sm:text-2xl font-bold text-white">15</p>
              </div>
            </div>
          </Link>

          {/* VS */}
          <div className="text-center my-2 sm:my-0">
            <ScoreDiffPill diff={scoreDiff} />
            <p className="text-xs sm:text-sm text-gray-400 mt-1 sm:mt-2">
              点差: {scoreDiff}
            </p>
          </div>

          {/* 敗北チーム */}
          <Link
            href={`/teams/${m.loser_team_id ?? ''}`}
            prefetch={false}
            className="group"
          >
            <div className="flex-1 flex items-center gap-3 p-3 sm:p-4 rounded-lg bg-gradient-to-r from-red-500/10 to-pink-500/10 border border-red-500/30 group-hover:border-red-400/50 transition-all">
              <span className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gray-600/30 border-2 border-purple-400/30 flex items-center justify-center">
                <FaUsers className="text-purple-200" />
              </span>
              <div className="min-w-0">
                <p className="font-bold text-white group-hover:text-purple-400 transition-colors truncate">
                  {m.loser_team_name ?? '—'}
                </p>
                <p className="text-xs sm:text-sm text-red-400">敗北</p>
                <TeamMembersRow members={loserMembers} />
              </div>
              <div className="ml-auto text-right">
                <p className="text-xl sm:text-2xl font-bold text-white">
                  {loserScore}
                </p>
              </div>
            </div>
          </Link>
        </div>
      </div>

      {m.notes && (
        <div className="mt-3 sm:mt-4 p-2.5 sm:p-3 bg-gray-800/50 rounded-lg border-l-4 border-purple-500/50">
          <p className="text-xs sm:text-sm text-gray-300">{m.notes}</p>
        </div>
      )}
    </div>
  );
});

/* ─────────────── ページ本体 ─────────────── */

export default function MatchesPage() {
  const { matches, loading, error, retrying, refetch } = useMatchesData();

  const isSmall = useIsSmallScreen();

  // フィルタ
  const [filter, setFilter] = useState<'all' | 'normal' | 'tournament'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month'>(
    'all'
  );

  // 検索・絞り込み（個人戦/団体戦どちらでも成立するよう拡張）
  const filteredSortedMatches = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const now = new Date();

    const filtered = (matches as MatchDetails[]).filter((m) => {
      const searchHit =
        !term ||
        (m.winner_name ?? '').toLowerCase().includes(term) ||
        (m.loser_name ?? '').toLowerCase().includes(term) ||
        (m.winner_team_name ?? '').toLowerCase().includes(term) ||
        (m.loser_team_name ?? '').toLowerCase().includes(term) ||
        (m.venue ?? '').toLowerCase().includes(term) ||
        (m.tournament_name ?? '').toLowerCase().includes(term);

      const typeHit =
        filter === 'all'
          ? true
          : filter === 'tournament'
            ? !!m.is_tournament
            : !m.is_tournament;

      const d = new Date(m.match_date);
      let dateHit = true;
      if (dateFilter === 'today') {
        dateHit = d.toDateString() === now.toDateString();
      } else if (dateFilter === 'week') {
        dateHit = d >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (dateFilter === 'month') {
        dateHit = d >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      return searchHit && typeHit && dateHit;
    });

    filtered.sort((a, b) => +new Date(b.match_date) - +new Date(a.match_date));
    return filtered;
  }, [matches, searchTerm, filter, dateFilter]);

  /* ── 追加：表示対象のプレイヤー(RP/HC/Avatar/Name)を players から補完 ── */
  const [playersById, setPlayersById] = useState<Record<string, PlayerLite>>({});

  const visiblePlayerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of filteredSortedMatches) {
      // 個人戦だけ対象
      const isTeams = m.mode === 'teams' || !!m.winner_team_name || !!m.loser_team_name;
      if (isTeams) continue;
      if (m.winner_id) ids.add(m.winner_id);
      if (m.loser_id) ids.add(m.loser_id);
    }
    return Array.from(ids);
  }, [filteredSortedMatches]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (visiblePlayerIds.length === 0) {
        if (!cancelled) setPlayersById({});
        return;
      }
      try {
        const inPlayers = visiblePlayerIds.map((id) => `"${id}"`).join(',');
        const rows = await restGet<PlayerLite[]>(
          `/rest/v1/players?id=in.(${inPlayers})&select=id,handle_name,avatar_url,ranking_points,handicap`
        );
        const dict: Record<string, PlayerLite> = {};
        for (const r of rows ?? []) {
          if (!r?.id) continue;
          dict[String(r.id)] = {
            id: String(r.id),
            handle_name: r.handle_name,
            avatar_url: r.avatar_url ?? null,
            ranking_points: typeof r.ranking_points === 'number' ? r.ranking_points : null,
            handicap: typeof r.handicap === 'number' ? r.handicap : null,
          };
        }
        if (!cancelled) setPlayersById(dict);
      } catch {
        // 補完に失敗しても一覧自体は表示（0表示のままでも落とさない）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visiblePlayerIds]);

  /* ── チームメンバー取得（既存のまま） ── */
  const [membersByTeam, setMembersByTeam] = useState<Record<string, MemberProfile[]>>({});

  const visibleTeamIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of filteredSortedMatches) {
      if (m.winner_team_id) ids.add(m.winner_team_id);
      if (m.loser_team_id) ids.add(m.loser_team_id);
    }
    return Array.from(ids);
  }, [filteredSortedMatches]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (visibleTeamIds.length === 0) {
        if (!cancelled) setMembersByTeam({});
        return;
      }
      try {
        const inTeams = visibleTeamIds.map((id) => `"${id}"`).join(',');
        const tm = await restGet<{ team_id: string; player_id: string }[]>(
          `/rest/v1/team_members?team_id=in.(${inTeams})&select=team_id,player_id`
        );

        const pids = Array.from(new Set(tm.map((r) => r.player_id)));
        if (pids.length === 0) {
          if (!cancelled) setMembersByTeam({});
          return;
        }

        const inPlayers = pids.map((id) => `"${id}"`).join(',');
        const players = await restGet<MemberProfile[]>(
          `/rest/v1/players?id=in.(${inPlayers})&select=id,handle_name,avatar_url`
        );
        const pmap = new Map(players.map((p) => [p.id, p]));

        const grouped: Record<string, MemberProfile[]> = {};
        for (const r of tm) {
          const p = pmap.get(r.player_id);
          if (!p) continue;
          (grouped[r.team_id] ||= []).push(p);
        }

        for (const k of Object.keys(grouped)) {
          grouped[k] = grouped[k].sort((a, b) =>
            a.handle_name.localeCompare(b.handle_name, 'ja')
          );
        }

        if (!cancelled) setMembersByTeam(grouped);
      } catch {
        // 失敗時は黙って空のまま
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visibleTeamIds]);

  // 統計
  const stats = useMemo(() => {
    const arr = matches as MatchDetails[];
    const totalMatches = arr.length;
    const todayMatches =
      arr.filter(
        (m) => new Date(m.match_date).toDateString() === new Date().toDateString()
      ).length;
    const tournamentMatches = arr.filter((m) => !!m.is_tournament).length;
    const avgScoreDiff =
      arr.length > 0
        ? arr.reduce((s, m) => s + (15 - (m.loser_score ?? 0)), 0) / arr.length
        : 0;
    return { totalMatches, todayMatches, tournamentMatches, avgScoreDiff };
  }, [matches]);

  // 仮想化は PC 以上のみ。モバイルでは通常レンダリング（クリップ防止）
  const useVirtual = !isSmall && filteredSortedMatches.length > 20;
  const virtualItemHeight = useMemo(() => 240, []);

  // 仮想スクロール描画
  const renderItem = useCallback(
    (index: number) => {
      const m = filteredSortedMatches[index];
      if (!m) return null;
      const isTeams = m.mode === 'teams' || !!m.winner_team_name || !!m.loser_team_name;
      return isTeams ? (
        <TeamsCard key={m.id} m={m} membersByTeam={membersByTeam} />
      ) : (
        <SinglesCard key={m.id} m={m} playersById={playersById} />
      );
    },
    [filteredSortedMatches, membersByTeam, playersById]
  );

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-6 sm:py-8">
        {/* ヘッダー */}
        <div className="text-center mb-8 sm:mb-12">
          <div className="flex items-center justify-center gap-3 mb-3 sm:mb-4">
            <div className="p-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full">
              <FaHistory className="text-2xl sm:text-3xl text-white" />
            </div>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
            試合結果
          </h1>
          <p className="text-gray-400 text-sm sm:text-base">
            個人戦・団体戦を時系列で一覧
          </p>
        </div>

        {/* ローディング/エラー */}
        <MobileLoadingState
          loading={loading}
          error={error}
          retrying={retrying}
          onRetry={refetch}
          emptyMessage="試合結果がありません"
          dataLength={(matches as MatchDetails[]).length}
        />

        {/* コンテンツ */}
        {!loading && !error && (matches as MatchDetails[]).length > 0 && (
          <>
            {/* 統計カード */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8">
              <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-4 sm:p-6 text-center transform hover:scale-105 transition-all">
                <FaGamepad className="text-2xl sm:text-3xl text-purple-400 mx-auto mb-2 sm:mb-3" />
                <div className="text-2xl sm:text-3xl font-bold text-white">
                  {stats.totalMatches}
                </div>
                <div className="text-xs sm:text-sm text-gray-400">総試合数</div>
              </div>
              <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-4 sm:p-6 text-center transform hover:scale-105 transition-all">
                <FaCalendar className="text-2xl sm:text-3xl text-blue-400 mx-auto mb-2 sm:mb-3" />
                <div className="text-2xl sm:text-3xl font-bold text-white">
                  {stats.todayMatches}
                </div>
                <div className="text-xs sm:text-sm text-gray-400">本日の試合</div>
              </div>
              <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-4 sm:p-6 text-center transform hover:scale-105 transition-all">
                <FaMedal className="text-2xl sm:text-3xl text-yellow-400 mx-auto mb-2 sm:mb-3" />
                <div className="text-2xl sm:text-3xl font-bold text-white">
                  {stats.tournamentMatches}
                </div>
                <div className="text-xs sm:text-sm text-gray-400">大会試合</div>
              </div>
              <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-4 sm:p-6 text-center transform hover:scale-105 transition-all">
                <FaTrophy className="text-2xl sm:text-3xl text-green-400 mx-auto mb-2 sm:mb-3" />
                <div className="text-2xl sm:text-3xl font-bold text-white">
                  {stats.avgScoreDiff.toFixed(1)}
                </div>
                <div className="text-xs sm:text-sm text-gray-400">平均点差</div>
              </div>
            </div>

            {/* 新規登録ボタン */}
            <div className="flex justify-center mb-6 sm:mb-8">
              <Link
                href="/matches/register"
                className="px-6 sm:px-8 py-2.5 sm:py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 transition-all transform hover:scale-105 shadow-lg font-medium flex items-center gap-2 text-sm sm:text-base"
              >
                <FaTrophy />
                試合結果を登録
              </Link>
            </div>

            {/* 検索・フィルター */}
            <div className="mb-6 sm:mb-8 space-y-3 sm:space-y-4">
              <input
                type="text"
                placeholder="プレイヤー名／チーム名／会場／大会名で検索..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2.5 sm:py-3 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400 transition-all text-sm sm:text-base"
              />

              <div className="flex flex-wrap gap-2 sm:gap-3">
                {/* 試合タイプフィルター */}
                <div className="flex gap-2">
                  {(['all', 'normal', 'tournament'] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setFilter(k)}
                      className={`px-3 sm:px-4 py-2 rounded-lg font-medium transition-all text-sm sm:text-base ${
                        filter === k
                          ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg'
                          : 'bg-gray-800/50 text-gray-400 hover:text-white border border-purple-500/30'
                      }`}
                    >
                      {k === 'all' ? 'すべて' : k === 'normal' ? '通常試合' : '大会'}
                    </button>
                  ))}
                </div>

                {/* 期間フィルター */}
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value as any)}
                  className="px-3 sm:px-4 py-2 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400 text-sm sm:text-base"
                >
                  <option value="all" className="bg-gray-800">
                    全期間
                  </option>
                  <option value="today" className="bg-gray-800">
                    今日
                  </option>
                  <option value="week" className="bg-gray-800">
                    過去7日間
                  </option>
                  <option value="month" className="bg-gray-800">
                    過去30日間
                  </option>
                </select>
              </div>
            </div>

            {/* 試合一覧（個人戦/団体戦混在） */}
            {filteredSortedMatches.length === 0 ? (
              <div className="text-center py-12 sm:py-16">
                <FaGamepad className="text-5xl sm:text-6xl text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400 text-sm sm:text-base">
                  条件に合う試合が見つかりません
                </p>
              </div>
            ) : !useVirtual ? (
              <div className="space-y-3 sm:space-y-4">
                {filteredSortedMatches.map((m) => {
                  const isTeams =
                    m.mode === 'teams' ||
                    !!m.winner_team_name ||
                    !!m.loser_team_name;
                  return isTeams ? (
                    <TeamsCard
                      key={m.id}
                      m={m}
                      membersByTeam={membersByTeam}
                    />
                  ) : (
                    <SinglesCard key={m.id} m={m} playersById={playersById} />
                  );
                })}
              </div>
            ) : (
              <Suspense fallback={<div className="text-center py-4">読み込み中...</div>}>
                <VirtualList
                  items={filteredSortedMatches}
                  height={720}
                  itemHeight={virtualItemHeight}
                  renderItem={renderItem}
                  className="space-y-3 sm:space-y-4"
                />
              </Suspense>
            )}
          </>
        )}
      </div>
    </div>
  );
}
