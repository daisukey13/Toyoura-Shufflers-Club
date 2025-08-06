'use client';

import { useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { FaTrophy, FaMedal, FaChartLine, FaFire, FaMapMarkerAlt } from 'react-icons/fa';
import Link from 'next/link';
import { usePlayersData } from '@/lib/hooks/useSupabaseData';
import { MobileLoadingState } from '@/components/MobileLoadingState';

// 仮想スクロール用のコンポーネント
const VirtualList = lazy(() => import('@/components/VirtualList'));

// 画像の遅延読み込み用カスタムコンポーネント
const LazyImage = ({ src, alt, className }: { src: string; alt: string; className: string }) => {
  return (
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
};

// ランクバッジコンポーネント（メモ化）
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
  } else if (rank === 2) {
    return (
      <div className="relative">
        <div className="absolute -inset-1 bg-gray-300 rounded-full blur-sm"></div>
        <div className="relative bg-gradient-to-br from-gray-300 to-gray-500 text-gray-900 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-base sm:text-lg">
          2
        </div>
      </div>
    );
  } else if (rank === 3) {
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

// プレイヤーカードコンポーネント（メモ化）
const PlayerCard = memo(function PlayerCard({ player, rank }: { player: any; rank: number }) {
  const isTop3 = rank <= 3;
  const winRate = useMemo(() => {
    return player.matches_played > 0 
      ? Math.round(((player.wins || 0) / player.matches_played) * 100)
      : 0;
  }, [player.matches_played, player.wins]);
  
  const getFrameColor = useCallback((rank: number) => {
    if (rank === 1) return 'from-yellow-400/50 to-yellow-600/50';
    if (rank === 2) return 'from-gray-300/50 to-gray-500/50';
    if (rank === 3) return 'from-orange-400/50 to-orange-600/50';
    return 'from-purple-600/20 to-pink-600/20';
  }, []);

  return (
    <Link href={`/players/${player.id}`} prefetch={false}>
      <div className={`glass-card rounded-xl p-4 sm:p-6 hover:scale-[1.02] transition-all cursor-pointer ${
        isTop3 ? 'border-2' : 'border'
      } border-gradient bg-gradient-to-r ${getFrameColor(rank)}`}>
        <div className="flex items-center gap-3 sm:gap-4">
          {/* ランクバッジ */}
          <RankBadge rank={rank} />
          
          {/* アバター */}
          <div className="relative">
            {isTop3 && (
              <div className={`absolute -inset-1 rounded-full blur-sm ${
                rank === 1 ? 'bg-yellow-400' :
                rank === 2 ? 'bg-gray-300' :
                'bg-orange-500'
              }`}></div>
            )}
            <LazyImage
              src={player.avatar_url || '/default-avatar.png'}
              alt={player.handle_name}
              className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 border-purple-500 object-cover"
            />
          </div>
          
          {/* プレイヤー情報 */}
          <div className="flex-1 min-w-0">
            <h3 className="text-lg sm:text-xl font-bold text-yellow-100 mb-1 truncate">
              {player.handle_name}
            </h3>
            <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm text-gray-400">
              {player.address && (
                <span className="flex items-center gap-1 truncate">
                  <FaMapMarkerAlt className="text-xs flex-shrink-0" />
                  <span className="truncate">{player.address}</span>
                </span>
              )}
              <span className="px-2 py-1 rounded-full bg-purple-900/30 text-purple-300 whitespace-nowrap">
                ハンディ: {player.handicap || 0}
              </span>
            </div>
          </div>
          
          {/* ポイント */}
          <div className="text-right flex-shrink-0">
            <div className={`text-2xl sm:text-3xl font-bold ${
              isTop3 ? 'text-yellow-100' : 'text-purple-300'
            }`}>
              {player.ranking_points || 0}
            </div>
            <div className="text-xs sm:text-sm text-gray-400">ポイント</div>
          </div>
        </div>
        
        {/* 統計バー - モバイルで簡略化 */}
        <div className="mt-3 sm:mt-4 grid grid-cols-3 gap-2 sm:gap-4 text-center">
          <div className="bg-purple-900/30 rounded-lg py-1.5 sm:py-2">
            <div className="text-green-400 font-bold text-sm sm:text-base">{player.wins || 0}</div>
            <div className="text-xs text-gray-500">勝利</div>
          </div>
          <div className="bg-purple-900/30 rounded-lg py-1.5 sm:py-2">
            <div className="text-red-400 font-bold text-sm sm:text-base">{player.losses || 0}</div>
            <div className="text-xs text-gray-500">敗北</div>
          </div>
          <div className="bg-purple-900/30 rounded-lg py-1.5 sm:py-2">
            <div className="text-blue-400 font-bold text-sm sm:text-base">{winRate}%</div>
            <div className="text-xs text-gray-500">勝率</div>
          </div>
        </div>
      </div>
    </Link>
  );
});

// 統計カードコンポーネント（メモ化）
const StatsCards = memo(function StatsCards({ stats }: { stats: any }) {
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

export default function RankingsPage() {
  const { players, loading, error, retrying, refetch } = usePlayersData();
  const [sortBy, setSortBy] = useState('points');

  // ソート処理をメモ化
  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => {
      if (sortBy === 'points') {
        return (b.ranking_points || 0) - (a.ranking_points || 0);
      } else {
        return (a.handicap || 0) - (b.handicap || 0);
      }
    });
  }, [players, sortBy]);

  // 統計情報をメモ化
  const stats = useMemo(() => {
    const totalPoints = players.reduce((sum, p) => sum + (p.ranking_points || 0), 0);
    return {
      activeCount: players.length,
      highestPoints: sortedPlayers[0]?.ranking_points || 0,
      averagePoints: players.length > 0 ? Math.round(totalPoints / players.length) : 0
    };
  }, [players, sortedPlayers]);

  // ソート切り替えのコールバック
  const handleSortChange = useCallback((newSortBy: string) => {
    setSortBy(newSortBy);
  }, []);

  // 仮想スクロール用のアイテムレンダラー
  const renderItem = useCallback((index: number) => {
    const player = sortedPlayers[index];
    const rank = index + 1;
    return <PlayerCard key={player.id} player={player} rank={rank} />;
  }, [sortedPlayers]);

  return (
    <div className="container mx-auto px-4 py-6 sm:py-8">
      {/* ヘッダー */}
      <div className="text-center mb-8 sm:mb-12">
        <div className="inline-block p-3 sm:p-4 mb-3 sm:mb-4 rounded-full bg-gradient-to-br from-yellow-400/20 to-orange-600/20">
          <FaTrophy className="text-4xl sm:text-5xl text-yellow-400" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold mb-3 sm:mb-4 text-yellow-100">
          🏆 ランキング
        </h1>
        <p className="text-gray-400 text-sm sm:text-base">
          豊浦シャッフラーズクラブのプレーヤーランキング
        </p>
      </div>

      {/* ローディング/エラー状態 */}
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
          {/* 統計カード */}
          <StatsCards stats={stats} />

          {/* ソート切り替え */}
          <div className="mb-6 sm:mb-8 flex justify-center">
            <div className="inline-flex rounded-lg overflow-hidden shadow-lg">
              <button
                onClick={() => handleSortChange('points')}
                className={`px-4 sm:px-6 py-2.5 sm:py-3 font-medium transition-all text-sm sm:text-base ${
                  sortBy === 'points' 
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white' 
                    : 'bg-purple-900/30 text-gray-400 hover:text-white'
                }`}
              >
                ポイント順
              </button>
              <button
                onClick={() => handleSortChange('handicap')}
                className={`px-4 sm:px-6 py-2.5 sm:py-3 font-medium transition-all text-sm sm:text-base ${
                  sortBy === 'handicap' 
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white' 
                    : 'bg-purple-900/30 text-gray-400 hover:text-white'
                }`}
              >
                ハンディキャップ順
              </button>
            </div>
          </div>

          {/* ランキングリスト */}
          {sortedPlayers.length <= 20 ? (
            // プレイヤーが少ない場合は通常のリスト表示
            <div className="space-y-3 sm:space-y-4">
              {sortedPlayers.map((player, index) => (
                <PlayerCard key={player.id} player={player} rank={index + 1} />
              ))}
            </div>
          ) : (
            // プレイヤーが多い場合は仮想スクロール
            <Suspense fallback={<div className="text-center py-4">読み込み中...</div>}>
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

// React.memoのインポート
import { memo } from 'react';