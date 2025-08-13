'use client';;
import Image from "next/image";

import { useState, useMemo, memo, useCallback, lazy, Suspense } from 'react';
import { FaTrophy, FaCalendar, FaMapMarkerAlt, FaMedal, FaHistory, FaGamepad, FaFilter, FaFire, FaStar } from 'react-icons/fa';
import Link from 'next/link';
import { useFetchMatchesData as useMatchesData } from '@/lib/hooks/useFetchSupabaseData';
import { MobileLoadingState } from '@/components/MobileLoadingState';

// 仮想スクロール用のコンポーネント
const VirtualList = lazy(() => import('@/components/VirtualList'));

// 型定義
interface MatchDetails {
  id: string;
  match_date: string;
  winner_id: string;
  winner_name: string;
  winner_avatar?: string;
  winner_current_points: number;
  winner_current_handicap: number;
  winner_points_change: number;
  loser_id: string;
  loser_name: string;
  loser_avatar?: string;
  loser_score: number;
  loser_current_points: number;
  loser_current_handicap: number;
  loser_points_change: number;
  is_tournament: boolean;
  tournament_name?: string;
  venue?: string;
  notes?: string;
}

// 画像の遅延読み込み用カスタムコンポーネント
const LazyImage = ({ src, alt, className }: { src: string; alt: string; className: string }) => {
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
};

// 統計カードコンポーネント（メモ化）
const StatsCards = memo(function StatsCards({ stats }: { stats: any }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8">
      <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-4 sm:p-6 text-center transform hover:scale-105 transition-all">
        <FaGamepad className="text-2xl sm:text-3xl text-purple-400 mx-auto mb-2 sm:mb-3" />
        <div className="text-2xl sm:text-3xl font-bold text-white">{stats.totalMatches}</div>
        <div className="text-xs sm:text-sm text-gray-400">総試合数</div>
      </div>
      
      <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-4 sm:p-6 text-center transform hover:scale-105 transition-all">
        <FaCalendar className="text-2xl sm:text-3xl text-blue-400 mx-auto mb-2 sm:mb-3" />
        <div className="text-2xl sm:text-3xl font-bold text-white">{stats.todayMatches}</div>
        <div className="text-xs sm:text-sm text-gray-400">本日の試合</div>
      </div>
      
      <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-4 sm:p-6 text-center transform hover:scale-105 transition-all">
        <FaMedal className="text-2xl sm:text-3xl text-yellow-400 mx-auto mb-2 sm:mb-3" />
        <div className="text-2xl sm:text-3xl font-bold text-white">{stats.tournamentMatches}</div>
        <div className="text-xs sm:text-sm text-gray-400">大会試合</div>
      </div>
      
      <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-4 sm:p-6 text-center transform hover:scale-105 transition-all">
        <FaTrophy className="text-2xl sm:text-3xl text-green-400 mx-auto mb-2 sm:mb-3" />
        <div className="text-2xl sm:text-3xl font-bold text-white">{stats.avgScoreDiff.toFixed(1)}</div>
        <div className="text-xs sm:text-sm text-gray-400">平均点差</div>
      </div>
    </div>
  );
});

// 試合カードコンポーネント（メモ化）
const MatchCard = memo(function MatchCard({ match }: { match: MatchDetails }) {
  const scoreDiff = 15 - (match.loser_score || 0);
  
  // 番狂わせの判定
  const isUpset = useMemo(() => (
    // 勝者のランキングポイントが敗者より100pt以上低い
    (// 勝者のハンディキャップが敗者より5以上高い
    ((match.winner_current_points || 0) < (match.loser_current_points || 0) - 100) || ((match.winner_current_handicap || 0) > (match.loser_current_handicap || 0) + 5))
  ), [match]);

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return `今日 ${date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays === 1) {
      return `昨日 ${date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays < 7) {
      return `${diffDays}日前`;
    } else {
      return date.toLocaleDateString('ja-JP', {
        month: 'long',
        day: 'numeric',
      });
    }
  }, []);

  const getScoreDifferenceColor = useCallback((scoreDiff: number) => {
    if (scoreDiff >= 10) return 'from-red-500 to-red-600';
    if (scoreDiff >= 5) return 'from-orange-500 to-orange-600';
    return 'from-blue-500 to-blue-600';
  }, []);
  
  return (
    <div
      className={`bg-gray-900/60 backdrop-blur-md rounded-xl p-4 sm:p-6 border transition-all relative ${
        isUpset 
          ? 'border-yellow-500/50 shadow-lg shadow-yellow-500/10' 
          : 'border-purple-500/30 hover:border-purple-400/50'
      }`}
    >
      {/* 番狂わせバッジ（控えめに） */}
      {isUpset && (
        <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
          <span className="px-2 sm:px-3 py-1 rounded-full bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 text-yellow-400 text-xs font-medium flex items-center gap-1">
            <FaStar className="text-xs" />
            <span className="hidden sm:inline">番狂わせ</span>
          </span>
        </div>
      )}

      {/* 試合情報ヘッダー */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3 sm:mb-4 text-xs sm:text-sm">
        {match.is_tournament && match.tournament_name && (
          <span className="px-2 sm:px-3 py-1 rounded-full bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 text-yellow-400 flex items-center gap-1">
            <FaMedal className="text-xs" />
            <span className="truncate max-w-[150px] sm:max-w-none">{match.tournament_name}</span>
          </span>
        )}
        <span className="text-gray-400 flex items-center gap-1">
          <FaCalendar className="text-xs" />
          {formatDate(match.match_date)}
        </span>
        {match.venue && (
          <span className="text-gray-400 flex items-center gap-1">
            <FaMapMarkerAlt className="text-xs" />
            <span className="truncate max-w-[100px] sm:max-w-none">{match.venue}</span>
          </span>
        )}
      </div>

      {/* 対戦カード - モバイル対応 */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4">
        {/* モバイル: 縦並び、デスクトップ: 横並び */}
        <div className="sm:grid sm:grid-cols-3 sm:items-center gap-3 sm:gap-4">
          {/* 勝者 */}
          <Link href={`/players/${match.winner_id}`} prefetch={false} className="group">
            <div className={`flex items-center gap-3 p-3 sm:p-4 rounded-lg border transition-all ${
              isUpset
                ? 'bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border-yellow-500/30 group-hover:border-yellow-400/50'
                : 'bg-gradient-to-r from-green-500/10 to-emerald-500/10 border-green-500/30 group-hover:border-green-400/50'
            }`}>
              <LazyImage
                src={match.winner_avatar || '/default-avatar.png'}
                alt={match.winner_name}
                className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 ${
                  isUpset ? 'border-yellow-500/50' : 'border-green-500/50'
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white group-hover:text-purple-400 transition-colors truncate">
                  {match.winner_name}
                </p>
                <p className={`text-xs sm:text-sm ${isUpset ? 'text-yellow-400' : 'text-green-400'}`}>
                  勝利
                </p>
                <div className="flex gap-3 text-xs text-gray-400">
                  <span>RP: {match.winner_current_points || 0}</span>
                  <span>HC: {match.winner_current_handicap || 0}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xl sm:text-2xl font-bold text-white">15</p>
                <p className={`text-xs sm:text-sm font-medium ${
                  (match.winner_points_change || 0) > 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {(match.winner_points_change || 0) > 0 ? '+' : ''}{match.winner_points_change || 0}pt
                </p>
              </div>
            </div>
          </Link>

          {/* VS表示 - モバイルでは横並び */}
          <div className="text-center my-2 sm:my-0">
            <div className={`inline-flex items-center justify-center w-12 h-12 sm:w-16 sm:h-16 rounded-full shadow-lg ${
              isUpset 
                ? 'bg-gradient-to-r from-yellow-500/80 to-orange-500/80' 
                : `bg-gradient-to-r ${getScoreDifferenceColor(scoreDiff)}`
            }`}>
              <span className="text-white font-bold text-sm sm:text-lg">VS</span>
            </div>
            <p className="text-xs sm:text-sm text-gray-400 mt-1 sm:mt-2">点差: {scoreDiff}</p>
          </div>

          {/* 敗者 */}
          <Link href={`/players/${match.loser_id}`} prefetch={false} className="group">
            <div className="flex items-center gap-3 p-3 sm:p-4 rounded-lg bg-gradient-to-r from-red-500/10 to-pink-500/10 border border-red-500/30 group-hover:border-red-400/50 transition-all">
              <LazyImage
                src={match.loser_avatar || '/default-avatar.png'}
                alt={match.loser_name}
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 border-red-500/50"
              />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white group-hover:text-purple-400 transition-colors truncate">
                  {match.loser_name}
                </p>
                <p className="text-xs sm:text-sm text-red-400">敗北</p>
                <div className="flex gap-3 text-xs text-gray-400">
                  <span>RP: {match.loser_current_points || 0}</span>
                  <span>HC: {match.loser_current_handicap || 0}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xl sm:text-2xl font-bold text-white">{match.loser_score || 0}</p>
                <p className="text-xs sm:text-sm text-red-400 font-medium">
                  {match.loser_points_change || 0}pt
                </p>
              </div>
            </div>
          </Link>
        </div>
      </div>

      {/* 備考 */}
      {match.notes && (
        <div className="mt-3 sm:mt-4 p-2.5 sm:p-3 bg-gray-800/50 rounded-lg border-l-4 border-purple-500/50">
          <p className="text-xs sm:text-sm text-gray-300">{match.notes}</p>
        </div>
      )}
    </div>
  );
});

export default function MatchesPage() {
  const { matches, loading, error, retrying, refetch } = useMatchesData();
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('all'); // all, today, week, month

  // フィルタリング処理をメモ化
  const filteredMatches = useMemo(() => {
    return (matches as MatchDetails[]).filter(match => {
      const matchesSearch = 
        match.winner_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        match.loser_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (match.venue && match.venue.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (match.tournament_name && match.tournament_name.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesType = 
        filter === 'all' ? true :
        filter === 'tournament' ? match.is_tournament :
        filter === 'normal' ? !match.is_tournament : true;

      // 日付フィルター
      const matchDate = new Date(match.match_date);
      const today = new Date();
      let matchesDate = true;
      
      if (dateFilter === 'today') {
        matchesDate = matchDate.toDateString() === today.toDateString();
      } else if (dateFilter === 'week') {
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        matchesDate = matchDate >= weekAgo;
      } else if (dateFilter === 'month') {
        const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        matchesDate = matchDate >= monthAgo;
      }

      return matchesSearch && matchesType && matchesDate;
    });
  }, [matches, searchTerm, filter, dateFilter]);

  // 統計情報をメモ化
  const stats = useMemo(() => {
    const typedMatches = matches as MatchDetails[];
    const totalMatches = typedMatches.length;
    const todayMatches = typedMatches.filter(m => 
      new Date(m.match_date).toDateString() === new Date().toDateString()
    ).length;
    const tournamentMatches = typedMatches.filter(m => m.is_tournament).length;
    const avgScoreDiff = typedMatches.length > 0
      ? typedMatches.reduce((sum, m) => sum + (15 - (m.loser_score || 0)), 0) / typedMatches.length
      : 0;

    return { totalMatches, todayMatches, tournamentMatches, avgScoreDiff };
  }, [matches]);

  // 仮想スクロール用のアイテムレンダラー
  const renderItem = useCallback((index: number) => {
    const match = filteredMatches[index];
    return <MatchCard key={match.id} match={match} />;
  }, [filteredMatches]);

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
            熱戦の記録
          </p>
        </div>

        {/* ローディング/エラー状態 */}
        <MobileLoadingState
          loading={loading}
          error={error}
          retrying={retrying}
          onRetry={refetch}
          emptyMessage="試合結果がありません"
          dataLength={matches.length}
        />

        {/* コンテンツ */}
        {!loading && !error && matches.length > 0 && (
          <>
            {/* 統計カード */}
            <StatsCards stats={stats} />

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
                placeholder="プレイヤー名、会場、大会名で検索..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2.5 sm:py-3 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400 transition-all text-sm sm:text-base"
              />

              <div className="flex flex-wrap gap-2 sm:gap-3">
                {/* 試合タイプフィルター */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setFilter('all')}
                    className={`px-3 sm:px-4 py-2 rounded-lg font-medium transition-all text-sm sm:text-base ${
                      filter === 'all' 
                        ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg' 
                        : 'bg-gray-800/50 text-gray-400 hover:text-white border border-purple-500/30'
                    }`}
                  >
                    すべて
                  </button>
                  <button
                    onClick={() => setFilter('normal')}
                    className={`px-3 sm:px-4 py-2 rounded-lg font-medium transition-all text-sm sm:text-base ${
                      filter === 'normal' 
                        ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg' 
                        : 'bg-gray-800/50 text-gray-400 hover:text-white border border-purple-500/30'
                    }`}
                  >
                    通常試合
                  </button>
                  <button
                    onClick={() => setFilter('tournament')}
                    className={`px-3 sm:px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-1 text-sm sm:text-base ${
                      filter === 'tournament' 
                        ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg' 
                        : 'bg-gray-800/50 text-gray-400 hover:text-white border border-purple-500/30'
                    }`}
                  >
                    <FaMedal className="text-sm" />
                    大会
                  </button>
                </div>

                {/* 期間フィルター */}
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="px-3 sm:px-4 py-2 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400 text-sm sm:text-base"
                >
                  <option value="all" className="bg-gray-800">全期間</option>
                  <option value="today" className="bg-gray-800">今日</option>
                  <option value="week" className="bg-gray-800">過去7日間</option>
                  <option value="month" className="bg-gray-800">過去30日間</option>
                </select>
              </div>
            </div>

            {/* 試合一覧 */}
            {filteredMatches.length === 0 ? (
              <div className="text-center py-12 sm:py-16">
                <FaGamepad className="text-5xl sm:text-6xl text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400 text-sm sm:text-base">試合結果が見つかりません</p>
              </div>
            ) : filteredMatches.length <= 20 ? (
              // 試合が少ない場合は通常のリスト表示
              (<div className="space-y-3 sm:space-y-4">
                {filteredMatches.map((match) => (
                  <MatchCard key={match.id} match={match} />
                ))}
              </div>)
            ) : (
              // 試合が多い場合は仮想スクロール
              (<Suspense fallback={<div className="text-center py-4">読み込み中...</div>}>
                <VirtualList
                  items={filteredMatches}
                  height={600}
                  itemHeight={window.innerWidth < 640 ? 300 : 250}
                  renderItem={renderItem}
                  className="space-y-3 sm:space-y-4"
                />
              </Suspense>)
            )}
          </>
        )}
      </div>
    </div>
  );
}