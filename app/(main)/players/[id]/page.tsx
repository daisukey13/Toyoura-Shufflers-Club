'use client';

import { useState, useEffect, useMemo, memo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useFetchPlayerDetail } from '@/lib/hooks/useFetchSupabaseData';
import { MobileLoadingState } from '@/components/MobileLoadingState';
import { FaTrophy, FaMedal, FaChartLine, FaArrowLeft, FaUser } from 'react-icons/fa';
import type { Player } from '@/types/player';

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

// 統計カードコンポーネント
const StatsCard = memo(function StatsCard({ 
  value, 
  label, 
  icon: Icon, 
  color 
}: { 
  value: number | string; 
  label: string; 
  icon?: any; 
  color: string 
}) {
  return (
    <div className="glass-card rounded-xl p-4 sm:p-6 text-center border border-purple-500/20">
      {Icon && <Icon className={`text-2xl sm:text-3xl ${color} mx-auto mb-2`} />}
      <div className={`text-2xl sm:text-3xl font-bold ${color} mb-1`}>{value}</div>
      <div className="text-xs sm:text-sm text-gray-400">{label}</div>
    </div>
  );
});

// 試合結果カードコンポーネント
const MatchCard = memo(function MatchCard({ match }: { match: any }) {
  return (
    <div className="glass-card rounded-lg p-3 sm:p-4 border border-purple-500/20 hover:border-purple-400/40 transition-all">
      <div className="flex items-center justify-between gap-3">
        {/* 対戦相手情報 */}
        <Link 
          href={`/players/${match.opponent_id}`} 
          className="flex items-center gap-2 sm:gap-3 min-w-0 hover:opacity-80 transition-opacity"
        >
          <LazyImage
            src={match.opponent_avatar || '/default-avatar.png'}
            alt={match.opponent_name}
            className="w-10 h-10 sm:w-12 sm:h-12 rounded-full object-cover flex-shrink-0"
          />
          <div className="min-w-0">
            <div className="font-semibold text-yellow-100 text-sm sm:text-base truncate">
              {match.opponent_name}
            </div>
            <div className="text-xs text-gray-400">
              {new Date(match.match_date).toLocaleDateString('ja-JP')}
            </div>
          </div>
        </Link>
        
        {/* スコアと結果 */}
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <div className="text-right">
            <div className="text-lg sm:text-xl font-bold">
              <span className={match.result === 'win' ? 'text-green-400' : 'text-gray-400'}>
                {match.player_score}
              </span>
              <span className="text-gray-500 mx-1">-</span>
              <span className={match.result === 'loss' ? 'text-red-400' : 'text-gray-400'}>
                {match.opponent_score}
              </span>
            </div>
          </div>
          <div className={`px-2 py-1 rounded-full text-xs font-bold ${
            match.result === 'win' 
              ? 'bg-green-500/20 text-green-400' 
              : 'bg-red-500/20 text-red-400'
          }`}>
            {match.result === 'win' ? 'W' : 'L'}
          </div>
        </div>
      </div>
    </div>
  );
});

export default function PlayerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const playerId = params.id as string;
  
  // カスタムフックを使用してプレーヤーデータを取得
  const { player, matches, loading, error, refetch } = useFetchPlayerDetail(playerId) as { 
    player: Player | null; 
    matches: any[]; 
    loading: boolean; 
    error: any; 
    refetch: () => void;
  };

  // 勝率の計算
  const winRate = useMemo(() => {
    return player && player.matches_played > 0 
      ? Math.round((player.wins / player.matches_played) * 100) 
      : 0;
  }, [player]);

  // 最近の成績を整形
  const recentPerformance = useMemo(() => {
    return matches?.slice(0, 10).map(match => {
      const isWinner = match.winner_id === playerId;
      return {
        ...match,
        result: isWinner ? 'win' : 'loss',
        player_score: isWinner ? match.winner_score : match.loser_score,
        opponent_score: isWinner ? match.loser_score : match.winner_score,
        opponent_id: isWinner ? match.loser_id : match.winner_id,
        opponent_name: isWinner ? match.loser_name : match.winner_name,
        opponent_avatar: isWinner ? match.loser_avatar : match.winner_avatar,
      };
    }) || [];
  }, [matches, playerId]);

  // 直近5試合の勝敗
  const recentResults = useMemo(() => {
    return recentPerformance.slice(0, 5);
  }, [recentPerformance]);

  // ローディング/エラー状態
  if (loading || error || !player) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-purple-900 via-purple-800 to-pink-900">
        <div className="container mx-auto px-4 py-6">
          {/* ヘッダー */}
          <div className="mb-6">
            <Link 
              href="/players" 
              className="inline-flex items-center gap-2 text-gray-400 hover:text-yellow-100 transition-colors"
            >
              <FaArrowLeft className="text-sm" />
              <span>戻る</span>
            </Link>
          </div>

          <MobileLoadingState
            loading={loading}
            error={error}
            retrying={false}
            onRetry={refetch}
            emptyMessage="プレーヤーが見つかりません"
            dataLength={player ? 1 : 0}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-900 via-purple-800 to-pink-900">
      <div className="container mx-auto px-4 py-6">
        {/* ヘッダー */}
        <div className="mb-6">
          <Link 
            href="/players" 
            className="inline-flex items-center gap-2 text-gray-400 hover:text-yellow-100 transition-colors"
          >
            <FaArrowLeft className="text-sm" />
            <span>戻る</span>
          </Link>
        </div>

        {/* プロフィールカード */}
        <div className="glass-card rounded-xl p-6 sm:p-8 mb-6 border border-purple-500/20">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6">
            {/* アバター */}
            <div className="relative">
              <div className="absolute -inset-1 bg-gradient-to-br from-purple-400 to-pink-400 rounded-full blur-sm"></div>
              <LazyImage
                src={player.avatar_url || '/default-avatar.png'}
                alt={player.full_name}
                className="relative w-24 h-24 sm:w-32 sm:h-32 rounded-full object-cover border-2 border-purple-500"
              />
            </div>

            {/* 基本情報 */}
            <div className="flex-1 text-center sm:text-left">
              <h1 className="text-2xl sm:text-3xl font-bold text-yellow-100 mb-2">
                {player.full_name}
              </h1>
              <p className="text-base sm:text-lg text-gray-400 mb-3">@{player.handle_name}</p>
              
              {/* バッジ */}
              <div className="flex flex-wrap gap-2 justify-center sm:justify-start mb-4">
                <div className="px-3 py-1.5 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 rounded-full">
                  <span className="text-yellow-300 font-semibold text-sm">
                    #{player.current_rank || '-'} ランキング
                  </span>
                </div>
                <div className="px-3 py-1.5 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-full">
                  <span className="text-blue-300 font-semibold text-sm">
                    {player.ranking_points} pts
                  </span>
                </div>
                <div className={`px-3 py-1.5 rounded-full ${
                  player.is_active 
                    ? 'bg-green-500/20 text-green-400' 
                    : 'bg-gray-500/20 text-gray-400'
                }`}>
                  <span className="font-semibold text-sm">
                    {player.is_active ? 'アクティブ' : '非アクティブ'}
                  </span>
                </div>
              </div>

              {/* メタ情報 */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="text-gray-500">ハンディ:</span>
                  <span className="ml-1 text-gray-300 font-medium">{player.handicap}</span>
                </div>
                <div>
                  <span className="text-gray-500">チーム:</span>
                  <span className="ml-1 text-gray-300 font-medium">{player.team_id || 'なし'}</span>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <span className="text-gray-500">登録:</span>
                  <span className="ml-1 text-gray-300 font-medium">
                    {new Date(player.created_at).toLocaleDateString('ja-JP')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 統計情報 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <StatsCard
            value={player.matches_played}
            label="試合数"
            icon={FaChartLine}
            color="text-purple-400"
          />
          <StatsCard
            value={player.wins}
            label="勝利"
            icon={FaTrophy}
            color="text-green-400"
          />
          <StatsCard
            value={player.losses}
            label="敗北"
            color="text-red-400"
          />
          <StatsCard
            value={`${winRate}%`}
            label="勝率"
            icon={FaMedal}
            color="text-yellow-400"
          />
        </div>

        {/* 最近の試合結果 */}
        <div className="glass-card rounded-xl p-4 sm:p-6 border border-purple-500/20">
          <h2 className="text-xl sm:text-2xl font-bold text-yellow-100 mb-4 sm:mb-6 flex items-center gap-2">
            <FaChartLine className="text-purple-400" />
            最近の試合結果
          </h2>
          
          {/* 直近5試合の勝敗表示 */}
          {recentResults.length > 0 && (
            <div className="mb-4 sm:mb-6">
              <p className="text-sm text-gray-400 mb-2">直近5試合</p>
              <div className="flex gap-2">
                {recentResults.map((match: any, index: number) => (
                  <div
                    key={index}
                    className={`w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center text-white font-bold shadow-lg ${
                      match.result === 'win' 
                        ? 'bg-gradient-to-br from-green-400 to-emerald-500' 
                        : 'bg-gradient-to-br from-red-400 to-rose-500'
                    }`}
                    title={`${match.result === 'win' ? '勝利' : '敗北'} vs ${match.opponent_name}`}
                  >
                    {match.result === 'win' ? 'W' : 'L'}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* 詳細な試合結果 */}
          {recentPerformance.length > 0 ? (
            <div className="space-y-3">
              {recentPerformance.map((match: any, index: number) => (
                <MatchCard key={index} match={match} />
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-400">まだ試合記録がありません</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}