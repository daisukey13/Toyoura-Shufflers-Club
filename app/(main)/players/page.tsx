// app/(main)/players/page.tsx
"use client";

import { useState, useMemo, memo, useCallback } from "react";
import Link from "next/link";
import {
  FaUsers,
  FaSearch,
  FaFilter,
  FaChartLine,
  FaCrown,
} from "react-icons/fa";
import { useFetchPlayersData } from "@/lib/hooks/useFetchSupabaseData";
import { MobileLoadingState } from "@/components/MobileLoadingState";

/* ───────────────────────────── LazyImage ───────────────────────────── */
const LazyImage = memo(function LazyImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onError={(e) => {
        (e.target as HTMLImageElement).src = "/default-avatar.png";
      }}
    />
  );
});

/* ───────────────────────────── Types ───────────────────────────── */
interface Player {
  id: string;
  handle_name: string;
  avatar_url?: string | null;
  address?: string | null;
  ranking_points?: number | null;
  handicap?: number | null;
  wins?: number | null;
  losses?: number | null;
  is_admin?: boolean | null;
}

/* ───────────────────────────── Helpers ───────────────────────────── */
function safeLower(s?: string | null) {
  return (s ?? "").toLowerCase();
}

/** 勝率は wins / (wins + losses) を採用（ゼロ試合は 0%） */
function winRateOf(p: Player) {
  const w = p.wins ?? 0;
  const l = p.losses ?? 0;
  const g = w + l;
  return g ? Math.round((w / g) * 100) : 0;
}
function gamesOf(p: Player) {
  return (p.wins ?? 0) + (p.losses ?? 0);
}
function ringForRank(rank: number) {
  if (rank === 1) return "from-yellow-400 to-yellow-600";
  if (rank === 2) return "from-gray-300 to-gray-500";
  if (rank === 3) return "from-orange-400 to-orange-600";
  return "from-purple-500/40 to-pink-600/40";
}
function emojiForRank(rank: number) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return null;
}

/* ───────────────────────── RankBadge ───────────────────────── */
const RankBadge = memo(function RankBadge({
  rank,
  prominent,
}: {
  rank: number;
  prominent?: boolean;
}) {
  const isTop3 = rank <= 3;
  const base =
    "flex items-center justify-center rounded-full font-bold shadow-md";
  const size = prominent
    ? "w-10 h-10 text-base sm:w-12 sm:h-12 sm:text-lg"
    : "w-8 h-8 text-sm sm:w-9 sm:h-9 sm:text-sm";
  const theme = isTop3
    ? `bg-gradient-to-br ${ringForRank(rank)} text-gray-900`
    : "bg-purple-900/30 text-purple-300 border border-purple-500/40";
  return (
    <div className="relative">
      {isTop3 && (
        <div className="absolute -inset-1 rounded-full blur-sm opacity-40 bg-gradient-to-br from-purple-400 to-pink-500" />
      )}
      <div className={`${base} ${size} ${theme} relative`}>{rank}</div>
    </div>
  );
});

/* ───────────────────────── PlayerCard ───────────────────────── */
const PlayerCard = memo(function PlayerCard({
  player,
  rank,
  sortBy,
}: {
  player: Player;
  rank: number;
  sortBy: "ranking" | "handicap" | "wins" | "matches" | string;
}) {
  const isTop3 = rank <= 3;
  const ring = ringForRank(rank);
  const badgeEmoji = sortBy === "ranking" ? emojiForRank(rank) : null;
  const wr = winRateOf(player);
  const games = gamesOf(player);

  return (
    <Link
      href={`/players/${player.id}`}
      prefetch={false}
      aria-label={`${player.handle_name} のプロフィール`}
    >
      <div
        className={`relative glass-card rounded-xl p-4 sm:p-5 lg:p-6 transition-all cursor-pointer
          ${isTop3 ? "border-2" : "border"} border-gradient bg-gradient-to-r from-purple-700/10 to-pink-700/10
          hover:scale-[1.02]`}
      >
        {/* 順位バッジ（右上） */}
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <RankBadge rank={rank} prominent />
          {badgeEmoji && (
            <span className="text-xl sm:text-2xl">{badgeEmoji}</span>
          )}
        </div>

        {/* 管理者バッジ（左上） */}
        {player.is_admin && (
          <div className="absolute top-2 left-2">
            <div className="flex items-center gap-1 px-2 py-1 bg-yellow-500/20 border border-yellow-500/30 rounded-full">
              <FaCrown className="text-yellow-400 text-xs" />
              <span className="text-yellow-400 text-xs font-medium hidden sm:inline">
                管理者
              </span>
            </div>
          </div>
        )}

        {/* ヘッダ行 */}
        <div className="flex items-center gap-3 sm:gap-4 mb-3 sm:mb-4">
          <div className="relative">
            {isTop3 && (
              <div
                className={`absolute -inset-1 rounded-full blur-sm bg-gradient-to-br ${ring}`}
              />
            )}
            <LazyImage
              src={player.avatar_url || "/default-avatar.png"}
              alt={player.handle_name}
              className={`relative w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 rounded-full object-cover
              ${isTop3 ? "border-2 border-transparent" : "border-2 border-purple-500/30"}`}
            />
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="text-base sm:text-lg font-bold text-yellow-100 truncate">
              {player.handle_name}
            </h3>
            <p className="text-xs sm:text-sm text-gray-400 truncate">
              {player.address || "—"}
            </p>
          </div>
        </div>

        {/* 主要スタッツ */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-3 sm:mb-4">
          <div className="text-center">
            <div
              className={`text-xl sm:text-2xl font-extrabold ${
                isTop3 ? "text-yellow-100" : "text-purple-300"
              }`}
            >
              {player.ranking_points ?? 0}
            </div>
            <div className="text-xs text-gray-400">ポイント</div>
          </div>
          <div className="text-center">
            <div className="text-xl sm:text-2xl font-extrabold text-purple-300">
              {player.handicap ?? 0}
            </div>
            <div className="text-xs text-gray-400">ハンディ</div>
          </div>
        </div>

        {/* 戦績行（試合数は wins+losses を採用） */}
        <div className="flex justify-between items-center text-xs sm:text-sm">
          <div className="text-gray-400">
            試合数:{" "}
            <span className="text-yellow-100 font-semibold">{games}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-green-400">{player.wins ?? 0}勝</span>
            <span className="text-gray-500">/</span>
            <span className="text-red-400">{player.losses ?? 0}敗</span>
          </div>
        </div>

        {/* 勝率（バー表示） */}
        <div className="mt-2 sm:mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs sm:text-sm text-gray-400">勝率</span>
            <span
              className={`text-xs sm:text-sm font-bold ${
                wr >= 60
                  ? "text-green-400"
                  : wr >= 40
                    ? "text-yellow-400"
                    : "text-red-400"
              }`}
            >
              {wr}%
            </span>
          </div>
          <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                wr >= 60
                  ? "bg-green-500"
                  : wr >= 40
                    ? "bg-yellow-500"
                    : "bg-red-500"
              }`}
              style={{ width: `${wr}%` }}
            />
          </div>
        </div>
      </div>
    </Link>
  );
});

/* ───────────────────────── PageHeader ───────────────────────── */
const PageHeader = memo(function PageHeader({
  playerCount,
}: {
  playerCount: number;
}) {
  return (
    <div className="mb-6 sm:mb-8 text-center pt-16 lg:pt-0">
      <div className="inline-block p-3 sm:p-4 mb-3 sm:mb-4 rounded-full bg-gradient-to-br from-purple-400/20 to-pink-600/20">
        <FaUsers className="text-3xl sm:text-4xl lg:text-5xl text-purple-400" />
      </div>
      <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-2 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
        プレーヤー一覧
      </h1>
      <p className="text-gray-300 text-sm sm:text-base">
        総勢 {playerCount} 名のシャッフラーズ
      </p>
    </div>
  );
});

/* ───────────────────────── Page ───────────────────────── */
export default function PlayersPage() {
  const { players, loading, error, retrying, refetch } = useFetchPlayersData();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterAddress, setFilterAddress] = useState("all");
  const [sortBy, setSortBy] = useState<
    "ranking" | "handicap" | "wins" | "matches"
  >("ranking");

  const addressOptions = useMemo(
    () => [
      "豊浦町",
      "洞爺湖町",
      "壮瞥町",
      "伊達市",
      "室蘭市",
      "登別市",
      "倶知安町",
      "ニセコ町",
      "札幌市",
      "その他道内",
      "内地",
      "外国（Visitor)",
    ],
    [],
  );

  // フィルタ & ソート
  const filteredAndSortedPlayers = useMemo(() => {
    const list = (players as Player[]).filter((p) => {
      const matchesSearch = safeLower(p.handle_name).includes(
        safeLower(searchTerm),
      );
      const matchesAddress =
        filterAddress === "all" || (p.address ?? "") === filterAddress;
      return matchesSearch && matchesAddress;
    });

    return list.sort((a, b) => {
      switch (sortBy) {
        case "ranking":
          return (b.ranking_points ?? 0) - (a.ranking_points ?? 0);
        case "handicap":
          return (a.handicap ?? 0) - (b.handicap ?? 0);
        case "wins":
          return (b.wins ?? 0) - (a.wins ?? 0);
        case "matches": {
          const ga = gamesOf(a);
          const gb = gamesOf(b);
          return gb - ga; // 試合数は wins+losses を採用
        }
        default:
          return 0;
      }
    });
  }, [players, searchTerm, filterAddress, sortBy]);

  // ハンドラ
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchTerm(e.target.value);
    },
    [],
  );
  const handleAddressFilterChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setFilterAddress(e.target.value);
    },
    [],
  );
  const handleSortChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSortBy(e.target.value as typeof sortBy);
    },
    [],
  );

  return (
    <div className="min-h-screen bg-[#2a2a3e] pb-20 lg:pb-0">
      <div className="container mx-auto px-4 py-4 sm:py-8">
        {/* ヘッダー */}
        <PageHeader playerCount={players.length} />

        {/* ローディング/エラー状態 */}
        <MobileLoadingState
          loading={loading}
          error={error}
          retrying={retrying}
          onRetry={refetch}
          emptyMessage="登録されているプレーヤーがいません"
          dataLength={players.length}
        />

        {/* コンテンツ */}
        {!loading && !error && players.length > 0 && (
          <>
            {/* 検索・フィルタ */}
            <div className="mb-6 sm:mb-8 space-y-3 sm:space-y-4">
              {/* 検索 */}
              <div className="relative">
                <FaSearch
                  className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm sm:text-base pointer-events-none"
                  aria-hidden
                />
                <input
                  type="text"
                  placeholder="プレーヤー名で検索..."
                  value={searchTerm}
                  onChange={handleSearchChange}
                  aria-label="プレーヤー名で検索"
                  className="w-full pl-10 sm:pl-12 pr-3 sm:pr-4 py-2.5 sm:py-3 bg-gray-900/60 border border-purple-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-purple-400 text-sm sm:text-base"
                />
              </div>

              {/* フィルタ & ソート */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-300 mb-1.5 sm:mb-2">
                    <FaFilter className="inline mr-1 sm:mr-2 text-xs sm:text-sm" />
                    地域でフィルター
                  </label>
                  <select
                    value={filterAddress}
                    onChange={handleAddressFilterChange}
                    aria-label="地域でフィルター"
                    className="w-full px-3 sm:px-4 py-2 sm:py-2.5 bg-gray-900/60 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:border-purple-400 text-sm sm:text-base"
                  >
                    <option value="all">すべての地域</option>
                    {addressOptions.map((address) => (
                      <option key={address} value={address}>
                        {address}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-300 mb-1.5 sm:mb-2">
                    <FaChartLine className="inline mr-1 sm:mr-2 text-xs sm:text-sm" />
                    並び順
                  </label>
                  <select
                    value={sortBy}
                    onChange={handleSortChange}
                    aria-label="並び順"
                    className="w-full px-3 sm:px-4 py-2 sm:py-2.5 bg-gray-900/60 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:border-purple-400 text-sm sm:text-base"
                  >
                    <option value="ranking">ランキングポイント順</option>
                    <option value="handicap">ハンディキャップ順</option>
                    <option value="wins">勝利数順</option>
                    <option value="matches">試合数順</option>
                  </select>
                </div>
              </div>
            </div>

            {/* リスト */}
            {filteredAndSortedPlayers.length === 0 ? (
              <div className="text-center py-8 sm:py-12">
                <p className="text-gray-400 text-sm sm:text-base">
                  該当するプレーヤーが見つかりませんでした
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
                {filteredAndSortedPlayers.map((player, i) => (
                  <PlayerCard
                    key={player.id}
                    player={player}
                    rank={i + 1}
                    sortBy={sortBy}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
