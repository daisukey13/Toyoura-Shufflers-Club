// app/(main)/rankings/page.tsx
"use client";

import React, {
  useState,
  useMemo,
  useCallback,
  lazy,
  Suspense,
  memo,
  useDeferredValue,
  useTransition,
  useEffect,
} from "react";
import {
  FaTrophy,
  FaMedal,
  FaChartLine,
  FaFire,
  FaUsers,
  FaPercent,
} from "react-icons/fa";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useFetchPlayersData as usePlayersData } from "@/lib/hooks/useFetchSupabaseData";
import { useTeamRankings, TeamRankItem } from "@/lib/hooks/useTeamRankings";
import { MobileLoadingState } from "@/components/MobileLoadingState";
import { calcWinRate } from "@/lib/stats";

/* ─────────────────────────── Fallback (for Suspense wrapper) ─────────────────────────── */
function Fallback() {
  return (
    <div className="container mx-auto px-4 py-10 text-center text-gray-300">
      画面を読み込み中…
    </div>
  );
}

/* ─────────────────────────── Virtual list ─────────────────────────── */
const VirtualList = lazy(() => import("@/components/VirtualList"));

/* ─────────────────────────── Lazy image ─────────────────────────── */
const LazyImage = ({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className: string;
}) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src={src}
    alt={alt}
    className={className}
    loading="lazy"
    decoding="async"
    onError={(e) => {
      (e.currentTarget as HTMLImageElement).src = "/default-avatar.png";
    }}
  />
);

/* ─────────────────────────── Rank Badge ─────────────────────────── */
const RankBadge = memo(function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="relative">
        <div className="absolute -inset-1 bg-yellow-400 rounded-full blur-sm animate-pulse"></div>
        <div className="relative bg-gradient-to-br from-yellow-400 to-yellow-600 text-gray-900 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-base sm:text-lg">
          1
        </div>
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="relative">
        <div className="absolute -inset-1 bg-gray-300 rounded-full blur-sm"></div>
        <div className="relative bg-gradient-to-br from-gray-300 to-gray-500 text-gray-900 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-base sm:text-lg">
          2
        </div>
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="relative">
        <div className="absolute -inset-1 bg-orange-500 rounded-full blur-sm"></div>
        <div className="relative bg-gradient-to-br from-orange-400 to-orange-600 text-gray-900 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-base sm:text-lg">
          3
        </div>
      </div>
    );
  }
  return (
    <div className="bg-purple-900/30 text-purple-300 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-sm sm:text-base">
      #{rank}
    </div>
  );
});

/* ─────────────────────────── Types ─────────────────────────── */
type Player = {
  id: string;
  handle_name: string;
  avatar_url?: string | null;
  ranking_points?: number | null;
  handicap?: number | null;
  matches_played?: number | null;
  wins?: number | null;
  losses?: number | null;
};

/* ─────────────────────────── utils ─────────────────────────── */
function eq(a: any, b: any) {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

/* ─────────────────────────── Player Card ─────────────────────────── */
const PlayerCard = memo(
  function PlayerCard({ player, rank }: { player: Player; rank: number }) {
    const isTop3 = rank <= 3;

    const games = (player.wins ?? 0) + (player.losses ?? 0);
    const winRate = useMemo(
      () => calcWinRate(player.wins, player.losses),
      [player.wins, player.losses],
    );

    const frame = useMemo(() => {
      if (rank === 1) return "from-yellow-400/50 to-yellow-600/50";
      if (rank === 2) return "from-gray-300/50 to-gray-500/50";
      if (rank === 3) return "from-orange-400/50 to-orange-600/50";
      return "from-purple-600/20 to-pink-600/20";
    }, [rank]);

    return (
      <Link
        href={`/players/${player.id}`}
        prefetch={false}
        aria-label={`${player.handle_name} のプロフィール`}
      >
        <div
          className={`glass-card rounded-xl p-4 sm:p-6 hover:scale-[1.02] transition-all cursor-pointer ${
            isTop3 ? "border-2" : "border"
          } border-gradient bg-gradient-to-r ${frame} min-h-[180px]`}
        >
          <div className="flex items-center gap-3 sm:gap-4">
            <RankBadge rank={rank} />

            <div className="relative">
              {isTop3 && (
                <div
                  className={`absolute -inset-1 rounded-full blur-sm ${
                    rank === 1
                      ? "bg-yellow-400"
                      : rank === 2
                        ? "bg-gray-300"
                        : "bg-orange-500"
                  }`}
                />
              )}
              <LazyImage
                src={player.avatar_url || "/default-avatar.png"}
                alt={player.handle_name}
                className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 border-purple-500 object-cover"
              />
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="text-lg sm:text-xl font-bold text-yellow-100 mb-1 truncate">
                {player.handle_name}
              </h3>
              <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm text-gray-400">
                <span className="px-2 py-1 rounded-full bg-purple-900/30 text-purple-300 whitespace-nowrap">
                  ハンディ: {player.handicap ?? 0}
                </span>
              </div>
            </div>

            <div className="text-right flex-shrink-0">
              <div
                className={`text-2xl sm:text-3xl font-bold ${isTop3 ? "text-yellow-100" : "text-purple-300"}`}
              >
                {player.ranking_points ?? 0}
              </div>
              <div className="text-xs sm:text-sm text-gray-400">ポイント</div>
            </div>
          </div>

          <div className="mt-3 sm:mt-4 grid grid-cols-3 gap-2 sm:gap-4 text-center">
            <div className="bg-purple-900/30 rounded-lg py-1.5 sm:py-2">
              <div className="text-green-400 font-bold text-sm sm:text-base">
                {player.wins ?? 0}
              </div>
              <div className="text-xs text-gray-500">勝利</div>
            </div>
            <div className="bg-purple-900/30 rounded-lg py-1.5 sm:py-2">
              <div className="text-red-400 font-bold text-sm sm:text-base">
                {player.losses ?? 0}
              </div>
              <div className="text-xs text-gray-500">敗北</div>
            </div>
            <div className="bg-purple-900/30 rounded-lg py-1.5 sm:py-2">
              <div className="text-blue-400 font-bold text-sm sm:text-base">
                {games > 0 ? `${winRate.toFixed(1)}%` : "—"}
              </div>
              <div className="text-xs text-gray-500">勝率</div>
            </div>
          </div>
        </div>
      </Link>
    );
  },
  (prev, next) => {
    const a = prev.player;
    const b = next.player;
    return (
      prev.rank === next.rank &&
      a.id === b.id &&
      a.handle_name === b.handle_name &&
      a.avatar_url === b.avatar_url &&
      eq(a.ranking_points ?? 0, b.ranking_points ?? 0) &&
      eq(a.handicap ?? 0, b.handicap ?? 0) &&
      eq(a.wins ?? 0, b.wins ?? 0) &&
      eq(a.losses ?? 0, b.losses ?? 0) &&
      eq(a.matches_played ?? 0, b.matches_played ?? 0)
    );
  },
);

/* ─────────────────────────── Team Card ─────────────────────────── */
const TeamCard = memo(function TeamCard({
  team,
  rank,
}: {
  team: TeamRankItem;
  rank: number;
}) {
  const isTop3 = rank <= 3;
  const frame =
    rank === 1
      ? "from-yellow-400/50 to-yellow-600/50"
      : rank === 2
        ? "from-gray-300/50 to-gray-500/50"
        : rank === 3
          ? "from-orange-400/50 to-orange-600/50"
          : "from-purple-600/20 to-pink-600/20";

  return (
    <Link
      href={`/teams/${team.id}`}
      prefetch={false}
      aria-label={`${team.name} のプロフィール`}
    >
      <div
        className={`glass-card rounded-xl p-4 sm:p-6 hover:scale-[1.02] transition-all cursor-pointer ${
          isTop3 ? "border-2" : "border"
        } border-gradient bg-gradient-to-r ${frame} min-h-[140px]`}
      >
        <div className="flex items-center gap-3 sm:gap-4">
          <RankBadge rank={rank} />
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-purple-600/20 border-2 border-purple-500 flex items-center justify-center">
            <FaUsers className="text-purple-200 text-xl sm:text-2xl" />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-lg sm:text-xl font-bold text-yellow-100 mb-1 truncate">
              {team.name}
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-gray-400">
              <span className="px-2 py-1 rounded-full bg-purple-900/30 text-purple-300">
                メンバー: {team.team_size ?? 0}
              </span>
              <span className="px-2 py-1 rounded-full bg-purple-900/30 text-purple-300">
                平均HC: {team.avg_hc ?? 0}
              </span>
            </div>
          </div>

          <div className="text-right flex-shrink-0">
            <div
              className={`text-2xl sm:text-3xl font-bold ${isTop3 ? "text-yellow-100" : "text-purple-300"}`}
            >
              {Math.round(team.avg_rp ?? 0)}
            </div>
            <div className="text-xs sm:text-sm text-gray-400">平均RP</div>
          </div>
        </div>

        <div className="mt-3 sm:mt-4 grid grid-cols-4 gap-2 sm:gap-4 text-center">
          <div className="bg-purple-900/30 rounded-lg py-1.5 sm:py-2">
            <div className="text-yellow-300 font-bold text-sm sm:text-base">
              {team.played ?? 0}
            </div>
            <div className="text-xs text-gray-500">試合</div>
          </div>
          <div className="bg-purple-900/30 rounded-lg py-1.5 sm:py-2">
            <div className="text-green-400 font-bold text-sm sm:text-base">
              {team.wins ?? 0}
            </div>
            <div className="text-xs text-gray-500">勝</div>
          </div>
          <div className="bg-purple-900/30 rounded-lg py-1.5 sm:py-2">
            <div className="text-red-400 font-bold text-sm sm:text-base">
              {team.losses ?? 0}
            </div>
            <div className="text-xs text-gray-500">敗</div>
          </div>
          <div className="bg-purple-900/30 rounded-lg py-1.5 sm:py-2">
            <div className="text-blue-400 font-bold text-sm sm:text-base">
              {team.win_pct != null
                ? `${(team.win_pct * 100).toFixed(1)}%`
                : "—"}
            </div>
            <div className="text-xs text-gray-500">勝率</div>
          </div>
        </div>
      </div>
    </Link>
  );
});

/* ─────────────────────────── Stats Cards ─────────────────────────── */
const StatsCardsPlayers = memo(function StatsCardsPlayers({
  stats,
}: {
  stats: { activeCount: number; highestPoints: number; averagePoints: number };
}) {
  return (
    <div className="mb-6 sm:mb-8 overflow-x-auto">
      <div className="flex gap-4 min-w-max sm:min-w-0 sm:grid sm:grid-cols-3">
        <div className="glass-card rounded-xl p-4 sm:p-6 text-center border border-pink-500/20 min-w-[140px]">
          <FaChartLine className="text-3xl sm:text-4xl text-pink-400 mx-auto mb-2 sm:mb-3" />
          <div className="text-2xl sm:text-3xl font-bold text-yellow-100 mb-1">
            {stats.activeCount}
          </div>
          <div className="text-gray-400 text-xs sm:text-base">
            アクティブプレーヤー
          </div>
        </div>

        <div className="glass-card rounded-xl p-4 sm:p-6 text-center border border-yellow-500/20 min-w-[140px]">
          <FaFire className="text-3xl sm:text-4xl text-yellow-400 mx-auto mb-2 sm:mb-3" />
          <div className="text-2xl sm:text-3xl font-bold text-yellow-100 mb-1">
            {stats.highestPoints}
          </div>
          <div className="text-gray-400 text-xs sm:text-base">最高ポイント</div>
        </div>

        <div className="glass-card rounded-xl p-4 sm:p-6 text-center border border-purple-500/20 min-w-[140px]">
          <FaMedal className="text-3xl sm:text-4xl text-purple-400 mx-auto mb-2 sm:mb-3" />
          <div className="text-2xl sm:text-3xl font-bold text-yellow-100 mb-1">
            {stats.averagePoints}
          </div>
          <div className="text-gray-400 text-xs sm:text-base">平均ポイント</div>
        </div>
      </div>
    </div>
  );
});

const StatsCardsTeams = memo(function StatsCardsTeams({
  stats,
}: {
  stats: { teamCount: number; topAvgRp: number; avgOfAvgRp: number };
}) {
  return (
    <div className="mb-6 sm:mb-8 overflow-x-auto">
      <div className="flex gap-4 min-w-max sm:min-w-0 sm:grid sm:grid-cols-3">
        <div className="glass-card rounded-xl p-4 sm:p-6 text-center border border-pink-500/20 min-w-[140px]">
          <FaUsers className="text-3xl sm:text-4xl text-pink-400 mx-auto mb-2 sm:mb-3" />
          <div className="text-2xl sm:text-3xl font-bold text-yellow-100 mb-1">
            {stats.teamCount}
          </div>
          <div className="text-gray-400 text-xs sm:text-base">登録チーム</div>
        </div>

        <div className="glass-card rounded-xl p-4 sm:p-6 text-center border border-yellow-500/20 min-w-[140px]">
          <FaTrophy className="text-3xl sm:text-4xl text-yellow-400 mx-auto mb-2 sm:mb-3" />
          <div className="text-2xl sm:text-3xl font-bold text-yellow-100 mb-1">
            {stats.topAvgRp}
          </div>
          <div className="text-gray-400 text-xs sm:text-base">最高平均RP</div>
        </div>

        <div className="glass-card rounded-xl p-4 sm:p-6 text-center border border-purple-500/20 min-w-[140px]">
          <FaPercent className="text-3xl sm:text-4xl text-purple-400 mx-auto mb-2 sm:mb-3" />
          <div className="text-2xl sm:text-3xl font-bold text-yellow-100 mb-1">
            {stats.avgOfAvgRp}
          </div>
          <div className="text-gray-400 text-xs sm:text-base">平均RPの平均</div>
        </div>
      </div>
    </div>
  );
});

/* ─────────────────────────── Inner Page (wrapped by Suspense) ─────────────────────────── */
type TabKey = "players" | "teams";

function RankingsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  // 初期タブ: ?tab=teams でチームから開始可
  const initialTab = (search.get("tab") as TabKey) || "players";
  const [tab, setTab] = useState<TabKey>(initialTab);

  // タブ切替時に URL を同期（履歴を汚さない）※空クエリで '?' が残らないように修正
  useEffect(() => {
    const sp = new URLSearchParams(search.toString());
    if (tab === "players") sp.delete("tab");
    else sp.set("tab", tab);
    const qs = sp.toString();
    const next = qs ? `${pathname}?${qs}` : `${pathname}`;
    router.replace(next, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /* ── Players ── */
  const {
    players,
    loading: pLoading,
    error: pError,
    retrying: pRetrying,
    refetch: pRefetch,
  } = usePlayersData();

  const [sortByPlayers, setSortByPlayers] = useState<"points" | "handicap">(
    "points",
  );
  const [isPendingPlayers, startTransitionPlayers] = useTransition();
  const deferredPlayers = useDeferredValue(players);

  const sortedPlayers = useMemo(() => {
    const arr = [...deferredPlayers];
    if (sortByPlayers === "points") {
      arr.sort((a, b) => (b.ranking_points ?? 0) - (a.ranking_points ?? 0));
    } else {
      arr.sort((a, b) => (a.handicap ?? 0) - (b.handicap ?? 0));
    }
    return arr as Player[];
  }, [deferredPlayers, sortByPlayers]);

  const playerStats = useMemo(() => {
    const totalPoints = deferredPlayers.reduce(
      (sum, p) => sum + (p.ranking_points ?? 0),
      0,
    );
    return {
      activeCount: deferredPlayers.length,
      highestPoints: (sortedPlayers[0]?.ranking_points ?? 0) as number,
      averagePoints:
        deferredPlayers.length > 0
          ? Math.round(totalPoints / deferredPlayers.length)
          : 0,
    };
  }, [deferredPlayers, sortedPlayers]);

  const handleSortPlayers = useCallback((k: "points" | "handicap") => {
    startTransitionPlayers(() => setSortByPlayers(k));
  }, []);

  const renderPlayerItem = useCallback(
    (index: number) => {
      const p = sortedPlayers[index];
      if (!p) return null;
      return <PlayerCard key={p.id} player={p} rank={index + 1} />;
    },
    [sortedPlayers],
  );

  /* ── Teams ── */
  const {
    teams,
    loading: tLoading,
    error: tError,
    retrying: tRetrying,
    refetch: tRefetch,
  } = useTeamRankings({
    enabled: tab === "teams",
    order: "avg_rp",
    direction: "desc",
  });

  const [sortByTeams, setSortByTeams] = useState<"avg_rp" | "win_pct">(
    "avg_rp",
  );
  const [isPendingTeams, startTransitionTeams] = useTransition();

  const sortedTeams = useMemo(() => {
    const arr = [...teams];
    if (sortByTeams === "avg_rp") {
      arr.sort((a, b) => (b.avg_rp ?? 0) - (a.avg_rp ?? 0));
    } else {
      arr.sort((a, b) => (b.win_pct ?? 0) - (a.win_pct ?? 0));
    }
    return arr;
  }, [teams, sortByTeams]);

  const teamStats = useMemo(() => {
    const n = teams.length || 0;
    const top = Math.round(sortedTeams[0]?.avg_rp ?? 0);
    const mean =
      n > 0
        ? Math.round(teams.reduce((s, r) => s + (r.avg_rp ?? 0), 0) / n)
        : 0;
    return { teamCount: n, topAvgRp: top, avgOfAvgRp: mean };
  }, [teams, sortedTeams]);

  const handleSortTeams = useCallback((k: "avg_rp" | "win_pct") => {
    startTransitionTeams(() => setSortByTeams(k));
  }, []);

  const renderTeamItem = useCallback(
    (index: number) => {
      const t = sortedTeams[index];
      if (!t) return null;
      return <TeamCard key={t.id} team={t} rank={index + 1} />;
    },
    [sortedTeams],
  );

  /* ─────────────────────────── UI ─────────────────────────── */
  return (
    <div className="container mx-auto px-4 py-6 sm:py-8">
      {/* ヘッダー */}
      <div className="text-center mb-6 sm:mb-8">
        <div className="inline-block p-3 sm:p-4 mb-3 sm:mb-4 rounded-full bg-gradient-to-br from-yellow-400/20 to-orange-600/20">
          <FaTrophy className="text-4xl sm:text-5xl text-yellow-400" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold mb-2 sm:mb-3 text-yellow-100">
          🏆 ランキング
        </h1>
        <p className="text-gray-400 text-sm sm:text-base">
          個人・チームのランキングをタブで切替
        </p>
      </div>

      {/* タブ（個人 / チーム） */}
      <div className="mb-6 sm:mb-8 flex justify-center">
        <div className="inline-flex rounded-lg overflow-hidden shadow-lg">
          <button
            onClick={() => setTab("players")}
            className={`px-4 sm:px-6 py-2.5 sm:py-3 font-medium transition-all text-sm sm:text-base ${
              tab === "players"
                ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white"
                : "bg-purple-900/30 text-gray-300 hover:text-white"
            }`}
            aria-pressed={tab === "players"}
          >
            個人
          </button>
          <button
            onClick={() => setTab("teams")}
            className={`px-4 sm:px-6 py-2.5 sm:py-3 font-medium transition-all text-sm sm:text-base ${
              tab === "teams"
                ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white"
                : "bg-purple-900/30 text-gray-300 hover:text-white"
            }`}
            aria-pressed={tab === "teams"}
          >
            チーム
          </button>
        </div>
      </div>

      {/* ── 個人タブ ── */}
      {tab === "players" && (
        <>
          <MobileLoadingState
            loading={pLoading}
            error={pError}
            retrying={pRetrying}
            onRetry={pRefetch}
            emptyMessage="アクティブなプレーヤーがいません"
            dataLength={players.length}
          />

          {!pLoading && !pError && players.length > 0 && (
            <>
              <StatsCardsPlayers stats={playerStats} />

              {/* ソート切替 */}
              <div className="mb-6 sm:mb-8 flex justify-center">
                <div className="inline-flex rounded-lg overflow-hidden shadow-lg">
                  <button
                    onClick={() => handleSortPlayers("points")}
                    className={`px-4 sm:px-6 py-2.5 sm:py-3 font-medium transition-all text-sm sm:text-base ${
                      sortByPlayers === "points"
                        ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white"
                        : "bg-purple-900/30 text-gray-400 hover:text-white"
                    }`}
                    aria-pressed={sortByPlayers === "points"}
                  >
                    ポイント順{" "}
                    {isPendingPlayers && sortByPlayers === "points" ? "…" : ""}
                  </button>
                  <button
                    onClick={() => handleSortPlayers("handicap")}
                    className={`px-4 sm:px-6 py-2.5 sm:py-3 font-medium transition-all text-sm sm:text-base ${
                      sortByPlayers === "handicap"
                        ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white"
                        : "bg-purple-900/30 text-gray-400 hover:text-white"
                    }`}
                    aria-pressed={sortByPlayers === "handicap"}
                  >
                    ハンディキャップ順{" "}
                    {isPendingPlayers && sortByPlayers === "handicap"
                      ? "…"
                      : ""}
                  </button>
                </div>
              </div>

              {/* リスト */}
              {sortedPlayers.length <= 20 ? (
                <div className="space-y-3 sm:space-y-4">
                  {sortedPlayers.map((p, i) => (
                    <PlayerCard key={p.id} player={p} rank={i + 1} />
                  ))}
                </div>
              ) : (
                <Suspense
                  fallback={
                    <div className="text-center py-6">リストを読み込み中…</div>
                  }
                >
                  <VirtualList
                    items={sortedPlayers}
                    height={600}
                    itemHeight={180}
                    renderItem={renderPlayerItem}
                    className="space-y-3 sm:space-y-4"
                  />
                </Suspense>
              )}
            </>
          )}
        </>
      )}

      {/* ── チームタブ ── */}
      {tab === "teams" && (
        <>
          <MobileLoadingState
            loading={tLoading}
            error={tError}
            retrying={tRetrying}
            onRetry={tRefetch}
            emptyMessage="登録チームがありません"
            dataLength={teams.length}
          />

          {!tLoading && !tError && teams.length > 0 && (
            <>
              <StatsCardsTeams stats={teamStats} />

              {/* ソート切替（平均RP / 勝率） */}
              <div className="mb-6 sm:mb-8 flex justify-center">
                <div className="inline-flex rounded-lg overflow-hidden shadow-lg">
                  <button
                    onClick={() => handleSortTeams("avg_rp")}
                    className={`px-4 sm:px-6 py-2.5 sm:py-3 font-medium transition-all text-sm sm:text-base ${
                      sortByTeams === "avg_rp"
                        ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white"
                        : "bg-purple-900/30 text-gray-400 hover:text-white"
                    }`}
                    aria-pressed={sortByTeams === "avg_rp"}
                  >
                    平均RP順{" "}
                    {isPendingTeams && sortByTeams === "avg_rp" ? "…" : ""}
                  </button>
                  <button
                    onClick={() => handleSortTeams("win_pct")}
                    className={`px-4 sm:px-6 py-2.5 sm:py-3 font-medium transition-all text-sm sm:text-base ${
                      sortByTeams === "win_pct"
                        ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white"
                        : "bg-purple-900/30 text-gray-400 hover:text-white"
                    }`}
                    aria-pressed={sortByTeams === "win_pct"}
                  >
                    勝率順{" "}
                    {isPendingTeams && sortByTeams === "win_pct" ? "…" : ""}
                  </button>
                </div>
              </div>

              {/* リスト */}
              {sortedTeams.length <= 20 ? (
                <div className="space-y-3 sm:space-y-4">
                  {sortedTeams.map((t, i) => (
                    <TeamCard key={t.id} team={t} rank={i + 1} />
                  ))}
                </div>
              ) : (
                <Suspense
                  fallback={
                    <div className="text-center py-6">リストを読み込み中…</div>
                  }
                >
                  <VirtualList
                    items={sortedTeams}
                    height={600}
                    itemHeight={160}
                    renderItem={renderTeamItem}
                    className="space-y-3 sm:space-y-4"
                  />
                </Suspense>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── Default export: wrap in Suspense ───────────────────────────
   useSearchParams()/usePathname() があるため、ページ全体を Suspense で包み
   Vercel の「useSearchParams を Suspense で包んでください」エラーを回避します。 */
export default function RankingsPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <RankingsInner />
    </Suspense>
  );
}
