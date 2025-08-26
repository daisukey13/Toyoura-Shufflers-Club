// app/(main)/rankings/page.tsx
'use client';

import React, {
  useState,
  useMemo,
  useCallback,
  lazy,
  Suspense,
  memo,
  useDeferredValue,
  useTransition,
} from 'react';
import { FaTrophy, FaMedal, FaChartLine, FaFire } from 'react-icons/fa';
import Link from 'next/link';
import { useFetchPlayersData as usePlayersData } from '@/lib/hooks/useFetchSupabaseData';
import { MobileLoadingState } from '@/components/MobileLoadingState';
import { calcWinRate } from '@/lib/stats'; // ★ 追加

// 仮想スクロール（大量データ時だけ使う）
const VirtualList = lazy(() => import('@/components/VirtualList'));

// 画像の遅延読み込み（next/image を使わず最軽量）
const LazyImage = ({ src, alt, className }: { src: string; alt: string; className: string }) => (
  <img
    src={src}
    alt={alt}
    className={className}
    loading="lazy"
    decoding="async"
    onError={(e) => {
      (e.target as HTMLImageElement).src = '/default-avatar.png';
    }}
  />
);

// ───────────────── Rank Badge ─────────────────
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

// ───────────────── Player Card ─────────────────
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

function eq(a: any, b: any) {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

const PlayerCard = memo(
  function PlayerCard({ player, rank }: { player: Player; rank: number }) {
    const isTop3 = rank <= 3;

    const games = (player.wins ?? 0) + (player.losses ?? 0);
    const winRate = useMemo(
      () => calcWinRate(player.wins, player.losses),
      [player.wins, player.losses]
    );

    const getFrameColor = useCallback((r: number) => {
      if (r === 1) return 'from-yellow-400/50 to-yellow-600/50';
      if (r === 2) return 'from-gray-300/50 to-gray-500/50';
      if (r === 3) return 'from-orange-400/50 to-orange-600/50';
      return 'from-purple-600/20 to-pink-600/20';
    }, []);

    return (
      <Link href={`/players/${player.id}`} prefetch={false} aria-label={`${player.handle_name} のプロフィール`}>
        {/* 高さを固定してCLSを防ぐ */}
        <div
          className={`glass-card rounded-xl p-4 sm:p-6 hover:scale-[1.02] transition-all cursor-pointer ${
            isTop3 ? 'border-2' : 'border'
          } border-gradient bg-gradient-to-r ${getFrameColor(rank)} min-h-[180px]`}
        >
          <div className="flex items-center gap-3 sm:gap-4">
            {/* ランク */}
            <RankBadge rank={rank} />

            {/* アバター */}
            <div className="relative">
              {isTop3 && (
                <div
                  className={`absolute -inset-1 rounded-full blur-sm ${
                    rank === 1 ? 'bg-yellow-400' : rank === 2 ? 'bg-gray-300' : 'bg-orange-500'
                  }`}
                />
              )}
              <LazyImage
                src={player.avatar_url || '/default-avatar.png'}
                alt={player.handle_name}
                className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 border-purple-500 object-cover"
              />
            </div>

            {/* 情報（所在地は削除） */}
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

            {/* ポイント */}
            <div className="text-right flex-shrink-0">
              <div className={`text-2xl sm:text-3xl font-bold ${isTop3 ? 'text-yellow-100' : 'text-purple-300'}`}>
                {player.ranking_points ?? 0}
              </div>
              <div className="text-xs sm:text-sm text-gray-400">ポイント</div>
            </div>
          </div>

          {/* 統計バー */}
          <div className="mt-3 sm:mt-4 grid grid-cols-3 gap-2 sm:gap-4 text-center">
            <div className="bg-purple-900/30 rounded-lg py-1.5 sm:py-2">
              <div className="text-green-400 font-bold text-sm sm:text-base">{player.wins ?? 0}</div>
              <div className="text-xs text-gray-500">勝利</div>
            </div>
            <div className="bg-purple-900/30 rounded-lg py-1.5 sm:py-2">
              <div className="text-red-400 font-bold text-sm sm:text-base">{player.losses ?? 0}</div>
              <div className="text-xs text-gray-500">敗北</div>
            </div>
            <div className="bg-purple-900/30 rounded-lg py-1.5 sm:py-2">
              <div className="text-blue-400 font-bold text-sm sm:text-base">
                {games > 0 ? `${winRate.toFixed(1)}%` : '—'}
              </div>
              <div className="text-xs text-gray-500">勝率</div>
            </div>
          </div>
        </div>
      </Link>
    );
  },
  // 変更がない限り再レンダリングしない
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
  }
);

// ───────────────── Stats Cards ─────────────────
const StatsCards = memo(function StatsCards({
  stats,
}: {
  stats: { activeCount: number; highestPoints: number; averagePoints: number };
}) {
  return (
    <div className="mb-6 sm:mb-8 overflow-x-auto">
      <div className="flex gap-4 min-w-max sm:min-w-0 sm:grid sm:grid-cols-3">
        <div className="glass-card rounded-xl p-4 sm:p-6 text-center border border-pink-500/20 min-w-[140px]">
          <FaChartLine className="text-3xl sm:text-4xl text-pink-400 mx-auto mb-2 sm:mb-3" />
          <div className="text-2xl sm:text-3xl font-bold text-yellow-100 mb-1">{stats.activeCount}</div>
          <div className="text-gray-400 text-xs sm:text-base">アクティブプレーヤー</div>
        </div>

        <div className="glass-card rounded-xl p-4 sm:p-6 text-center border border-yellow-500/20 min-w-[140px]">
          <FaFire className="text-3xl sm:text-4xl text-yellow-400 mx-auto mb-2 sm:mb-3" />
          <div className="text-2xl sm:text-3xl font-bold text-yellow-100 mb-1">{stats.highestPoints}</div>
          <div className="text-gray-400 text-xs sm:text-base">最高ポイント</div>
        </div>

        <div className="glass-card rounded-xl p-4 sm:p-6 text-center border border-purple-500/20 min-w-[140px]">
          <FaMedal className="text-3xl sm:text-4xl text-purple-400 mx-auto mb-2 sm:mb-3" />
          <div className="text-2xl sm:text-3xl font-bold text-yellow-100 mb-1">{stats.averagePoints}</div>
          <div className="text-gray-400 text-xs sm:text-base">平均ポイント</div>
        </div>
      </div>
    </div>
  );
});

// ───────────────── Page ─────────────────
export default function RankingsPage() {
  const { players, loading, error, retrying, refetch } = usePlayersData();

  const [sortBy, setSortBy] = useState<'points' | 'handicap'>('points');
  const [isPending, startTransition] = useTransition();
  const deferredPlayers = useDeferredValue(players);

  // ソート
  const sortedPlayers = useMemo(() => {
    const arr = [...deferredPlayers];
    if (sortBy === 'points') {
      arr.sort((a, b) => (b.ranking_points ?? 0) - (a.ranking_points ?? 0));
    } else {
      arr.sort((a, b) => (a.handicap ?? 0) - (b.handicap ?? 0));
    }
    return arr as Player[];
  }, [deferredPlayers, sortBy]);

  // 統計
  const stats = useMemo(() => {
    const totalPoints = deferredPlayers.reduce((sum, p) => sum + (p.ranking_points ?? 0), 0);
    return {
      activeCount: deferredPlayers.length,
      highestPoints: (sortedPlayers[0]?.ranking_points ?? 0) as number,
      averagePoints: deferredPlayers.length > 0 ? Math.round(totalPoints / deferredPlayers.length) : 0,
    };
  }, [deferredPlayers, sortedPlayers]);

  const handleSortChange = useCallback((k: 'points' | 'handicap') => {
    startTransition(() => setSortBy(k));
  }, []);

  const renderItem = useCallback(
    (index: number) => {
      const p = sortedPlayers[index];
      if (!p) return null;
      return <PlayerCard key={p.id} player={p} rank={index + 1} />;
    },
    [sortedPlayers]
  );

  return (
    <div className="container mx-auto px-4 py-6 sm:py-8">
      {/* ヘッダー */}
      <div className="text-center mb-8 sm:mb-12">
        <div className="inline-block p-3 sm:p-4 mb-3 sm:mb-4 rounded-full bg-gradient-to-br from-yellow-400/20 to-orange-600/20">
          <FaTrophy className="text-4xl sm:text-5xl text-yellow-400" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold mb-3 sm:mb-4 text-yellow-100">🏆 ランキング</h1>
        <p className="text-gray-400 text-sm sm:text-base">豊浦シャッフラーズクラブのプレーヤーランキング</p>
      </div>

      {/* ローディング / エラー */}
      <MobileLoadingState
        loading={loading}
        error={error}
        retrying={retrying}
        onRetry={refetch}
        emptyMessage="アクティブなプレーヤーがいません"
        dataLength={players.length}
      />

      {/* コンテンツ */}
      {!loading && !error && players.length > 0 && (
        <>
          <StatsCards stats={stats} />

          {/* ソート切替 */}
          <div className="mb-6 sm:mb-8 flex justify-center">
            <div className="inline-flex rounded-lg overflow-hidden shadow-lg">
              <button
                onClick={() => handleSortChange('points')}
                className={`px-4 sm:px-6 py-2.5 sm:py-3 font-medium transition-all text-sm sm:text-base ${
                  sortBy === 'points'
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                    : 'bg-purple-900/30 text-gray-400 hover:text-white'
                }`}
                aria-pressed={sortBy === 'points'}
              >
                ポイント順 {isPending && sortBy === 'points' ? '…' : ''}
              </button>
              <button
                onClick={() => handleSortChange('handicap')}
                className={`px-4 sm:px-6 py-2.5 sm:py-3 font-medium transition-all text-sm sm:text-base ${
                  sortBy === 'handicap'
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                    : 'bg-purple-900/30 text-gray-400 hover:text-white'
                }`}
                aria-pressed={sortBy === 'handicap'}
              >
                ハンディキャップ順 {isPending && sortBy === 'handicap' ? '…' : ''}
              </button>
            </div>
          </div>

          {/* リスト（件数に応じて最適化） */}
          {sortedPlayers.length <= 20 ? (
            <div className="space-y-3 sm:space-y-4">
              {sortedPlayers.map((p, i) => (
                <PlayerCard key={p.id} player={p} rank={i + 1} />
              ))}
            </div>
          ) : (
            <Suspense fallback={<div className="text-center py-6">リストを読み込み中…</div>}>
              <VirtualList
                items={sortedPlayers}
                height={600}
                itemHeight={180}
                renderItem={renderItem}
                className="space-y-3 sm:space-y-4"
              />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
}
