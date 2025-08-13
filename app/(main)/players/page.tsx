'use client';;
import Image from "next/image";

import { useState, useMemo, memo, useCallback } from 'react';
import Link from 'next/link';
import { FaUsers, FaTrophy, FaSearch, FaFilter, FaMedal, FaChartLine, FaCrown } from 'react-icons/fa';
import { useFetchPlayersData } from '@/lib/hooks/useFetchSupabaseData';
import { MobileLoadingState } from '@/components/MobileLoadingState';

// 画像の遅延読み込み用カスタムコンポーネント
const LazyImage = memo(function LazyImage({ src, alt, className }: { src: string; alt: string; className: string }) {
  return (
    <Image
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
});

// プレーヤー型定義
interface Player {
  id: string;
  handle_name: string;
  avatar_url: string | null;
  address: string;
  ranking_points: number;
  handicap: number;
  matches_played: number;
  wins: number;
  losses: number;
  is_admin: boolean;
}

// プレーヤーカードコンポーネント（メモ化）
const PlayerCard = memo(function PlayerCard({ 
  player, 
  index, 
  rankIcon, 
  sortBy 
}: { 
  player: Player; 
  index: number; 
  rankIcon: string | null; 
  sortBy: string;
}) {
  const winRate = useMemo(() => {
    if (!player.matches_played || player.matches_played === 0) return 0;
    return Math.round(((player.wins || 0) / player.matches_played) * 100);
  }, [player.matches_played, player.wins]);
  
  return (
    <Link href={`/players/${player.id}`} prefetch={false}>
      <div className="glass-card rounded-xl p-4 sm:p-5 lg:p-6 hover:scale-105 transition-transform cursor-pointer relative border border-purple-500/30">
        {/* ランクアイコン */}
        {rankIcon && sortBy === 'ranking' && (
          <div className="absolute top-2 right-2 text-xl sm:text-2xl">
            {rankIcon}
          </div>
        )}
        
        {/* 管理者バッジ */}
        {player.is_admin && (
          <div className="absolute top-2 left-2">
            <div className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-yellow-500/20 border border-yellow-500/30 rounded-full">
              <FaCrown className="text-yellow-400 text-xs" />
              <span className="text-yellow-400 text-xs font-medium hidden sm:inline">管理者</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 sm:gap-4 mb-3 sm:mb-4">
          <LazyImage
            src={player.avatar_url || '/default-avatar.png'}
            alt={player.handle_name}
            className="w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 rounded-full border-2 border-purple-500/30 object-cover"
          />
          <div className="min-w-0 flex-1">
            <h3 className="text-base sm:text-lg font-bold text-white truncate">{player.handle_name}</h3>
            <p className="text-xs sm:text-sm text-gray-400 truncate">{player.address}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-3 sm:mb-4">
          <div className="text-center">
            <div className="text-xl sm:text-2xl font-bold text-yellow-400">{player.ranking_points || 0}</div>
            <div className="text-xs text-gray-400">ポイント</div>
          </div>
          <div className="text-center">
            <div className="text-xl sm:text-2xl font-bold text-purple-400">{player.handicap || 0}</div>
            <div className="text-xs text-gray-400">ハンディ</div>
          </div>
        </div>

        <div className="flex justify-between items-center text-xs sm:text-sm">
          <div className="text-gray-400">
            試合数: <span className="text-white font-medium">{player.matches_played || 0}</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <span className="text-green-400">{player.wins || 0}勝</span>
            <span className="text-gray-400">/</span>
            <span className="text-red-400">{player.losses || 0}敗</span>
          </div>
        </div>

        <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm text-gray-400">勝率</span>
            <span className={`text-xs sm:text-sm font-bold ${
              winRate >= 60 ? 'text-green-400' :
              winRate >= 40 ? 'text-yellow-400' :
              'text-red-400'
            }`}>
              {winRate}%
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
});

// ヘッダーコンポーネント（メモ化）
const PageHeader = memo(function PageHeader({ playerCount }: { playerCount: number }) {
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

export default function PlayersPage() {
  const { players, loading, error, retrying, refetch } = useFetchPlayersData();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAddress, setFilterAddress] = useState('all');
  const [sortBy, setSortBy] = useState('ranking');

  const addressOptions = useMemo(() => [
    '豊浦町', '洞爺湖町', '壮瞥町', '伊達市', '室蘭市', '登別市',
    '倶知安町', 'ニセコ町', '札幌市', 'その他道内', '内地', '外国（Visitor)'
  ], []);

  // フィルタリングとソートをメモ化
  const filteredAndSortedPlayers = useMemo(() => {
    return players
      .filter(player => {
        const matchesSearch = player.handle_name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesAddress = filterAddress === 'all' || player.address === filterAddress;
        return matchesSearch && matchesAddress;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'ranking':
            return (b.ranking_points || 0) - (a.ranking_points || 0);
          case 'handicap':
            return (a.handicap || 0) - (b.handicap || 0);
          case 'wins':
            return (b.wins || 0) - (a.wins || 0);
          case 'matches':
            return (b.matches_played || 0) - (a.matches_played || 0);
          default:
            return 0;
        }
      });
  }, [players, searchTerm, filterAddress, sortBy]);

  const getRankIcon = useCallback((index: number) => {
    if (index === 0) return '🥇';
    if (index === 1) return '🥈';
    if (index === 2) return '🥉';
    return null;
  }, []);

  // 検索ハンドラーのメモ化
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  }, []);

  const handleAddressFilterChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilterAddress(e.target.value);
  }, []);

  const handleSortChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSortBy(e.target.value);
  }, []);

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
            {/* フィルター・検索 - モバイル対応 */}
            <div className="mb-6 sm:mb-8 space-y-3 sm:space-y-4">
              {/* 検索バー */}
              <div className="relative">
                <FaSearch className="absolute left-3 sm:left-4 top-1/2 transform -translate-y-1/2 text-gray-400 text-sm sm:text-base pointer-events-none" />
                <input
                  type="text"
                  placeholder="プレーヤー名で検索..."
                  value={searchTerm}
                  onChange={handleSearchChange}
                  className="w-full pl-10 sm:pl-12 pr-3 sm:pr-4 py-2.5 sm:py-3 bg-gray-900/60 border border-purple-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-purple-400 text-sm sm:text-base"
                />
              </div>

              {/* フィルターとソート - モバイル対応 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-300 mb-1.5 sm:mb-2">
                    <FaFilter className="inline mr-1 sm:mr-2 text-xs sm:text-sm" />
                    地域でフィルター
                  </label>
                  <select
                    value={filterAddress}
                    onChange={handleAddressFilterChange}
                    className="w-full px-3 sm:px-4 py-2 sm:py-2.5 bg-gray-900/60 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:border-purple-400 text-sm sm:text-base"
                  >
                    <option value="all">すべての地域</option>
                    {addressOptions.map(address => (
                      <option key={address} value={address}>{address}</option>
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

            {/* プレーヤーカード */}
            {filteredAndSortedPlayers.length === 0 ? (
              <div className="text-center py-8 sm:py-12">
                <p className="text-gray-400 text-sm sm:text-base">該当するプレーヤーが見つかりませんでした</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
                {filteredAndSortedPlayers.map((player, index) => {
                  const rankIcon = getRankIcon(index);
                  return (
                    <PlayerCard 
                      key={player.id} 
                      player={player} 
                      index={index} 
                      rankIcon={rankIcon} 
                      sortBy={sortBy} 
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}