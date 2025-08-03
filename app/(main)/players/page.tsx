// app/(main)/players/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Player } from '@/types/player';
import { FaSearch, FaUsers, FaTrophy, FaChartLine, FaGamepad, FaMapMarkerAlt, FaCalendar, FaStar } from 'react-icons/fa';
import Link from 'next/link';

const supabase = createClient();

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'rank' | 'handicap' | 'matches' | 'created'>('handicap');
  const [filterBy, setFilterBy] = useState<'all' | 'active' | 'inactive'>('all');

  useEffect(() => {
    fetchPlayers();
  }, []);

  const fetchPlayers = async () => {
    try {
      const { data, error } = await supabase
        .from('players')
        .select('*')
        .eq('is_admin', false)  // 管理者を除外
        .order('handicap', { ascending: true }); // デフォルトをハンディキャップ昇順に変更

      if (!error && data) {
        setPlayers(data);
      }
    } catch (err) {
      console.error('Error fetching players:', err);
    } finally {
      setLoading(false);
    }
  };

  // フィルタリングとソート
  const filteredAndSortedPlayers = players
    .filter(player => {
      const matchesSearch = 
        player.handle_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (player.address && player.address.toLowerCase().includes(searchTerm.toLowerCase()));
      
      if (filterBy === 'all') return matchesSearch;
      if (filterBy === 'active') return player.is_active && matchesSearch;
      if (filterBy === 'inactive') return !player.is_active && matchesSearch;
      
      return matchesSearch;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'rank':
          return b.ranking_points - a.ranking_points;
        case 'handicap':
          return a.handicap - b.handicap; // 昇順
        case 'matches':
          return b.matches_played - a.matches_played;
        case 'created':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime(); // 登録日降順
        default:
          return 0;
      }
    });

  const getRankColor = (points: number) => {
    if (points >= 1500) return 'from-yellow-400 to-yellow-600'; // ゴールド
    if (points >= 1200) return 'from-purple-400 to-purple-600'; // パープル
    if (points >= 1000) return 'from-blue-400 to-blue-600'; // ブルー
    return 'from-gray-400 to-gray-600'; // グレー
  };

  const getRankIcon = (points: number) => {
    if (points >= 1500) return '👑';
    if (points >= 1200) return '⭐';
    if (points >= 1000) return '🎯';
    return '🎲';
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center text-yellow-100">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* ヘッダー */}
      <div className="text-center mb-12">
        <div className="inline-block p-4 mb-4 rounded-full bg-gradient-to-br from-blue-400/20 to-purple-600/20">
          <FaUsers className="text-5xl text-blue-400" />
        </div>
        <h1 className="text-4xl font-bold mb-4 text-yellow-100">
          プレイヤー一覧
        </h1>
        <p className="text-gray-400">
          豊浦シャッフラーズクラブの仲間たち
        </p>
      </div>

      {/* 統計カード */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="glass-card rounded-lg p-4 text-center">
          <FaUsers className="text-2xl text-pink-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-yellow-100">{players.length}</div>
          <div className="text-xs text-gray-400">総メンバー</div>
        </div>
        
        <div className="glass-card rounded-lg p-4 text-center">
          <FaStar className="text-2xl text-yellow-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-yellow-100">
            {players.filter(p => p.is_active).length}
          </div>
          <div className="text-xs text-gray-400">アクティブ</div>
        </div>
        
        <div className="glass-card rounded-lg p-4 text-center">
          <FaGamepad className="text-2xl text-green-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-yellow-100">
            {players.reduce((sum, p) => sum + p.matches_played, 0)}
          </div>
          <div className="text-xs text-gray-400">総試合数</div>
        </div>
        
        <div className="glass-card rounded-lg p-4 text-center">
          <FaTrophy className="text-2xl text-purple-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-yellow-100">
            {Math.round(players.reduce((sum, p) => sum + p.wins, 0) / players.length) || 0}
          </div>
          <div className="text-xs text-gray-400">平均勝利数</div>
        </div>
      </div>

      {/* 検索・フィルター */}
      <div className="mb-8 space-y-4">
        <div className="relative">
          <FaSearch className="absolute left-4 top-1/2 transform -translate-y-1/2 text-purple-400" />
          <input
            type="text"
            placeholder="名前や地域で検索..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100 placeholder-gray-500 focus:outline-none focus:border-purple-400"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <div>
            <label className="sr-only">並び順</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'rank' | 'handicap' | 'matches' | 'created')}
              className="px-4 py-2 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100 focus:outline-none focus:border-purple-400"
            >
              <option value="handicap">ハンディキャップ順</option>
              <option value="rank">ランク順</option>
              <option value="matches">試合数順</option>
              <option value="created">登録日順（新しい順）</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setFilterBy('all')}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                filterBy === 'all' 
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white' 
                  : 'bg-purple-900/30 text-gray-400 hover:text-white'
              }`}
            >
              全て
            </button>
            <button
              onClick={() => setFilterBy('active')}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                filterBy === 'active' 
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white' 
                  : 'bg-purple-900/30 text-gray-400 hover:text-white'
              }`}
            >
              アクティブ
            </button>
            <button
              onClick={() => setFilterBy('inactive')}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                filterBy === 'inactive' 
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white' 
                  : 'bg-purple-900/30 text-gray-400 hover:text-white'
              }`}
            >
              非アクティブ
            </button>
          </div>
        </div>
      </div>

      {/* プレイヤーカード */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredAndSortedPlayers.map((player) => {
          const winRate = player.matches_played > 0 
            ? ((player.wins / player.matches_played) * 100).toFixed(1)
            : '0.0';
          
          return (
            <Link key={player.id} href={`/players/${player.id}`} className="block group">
              <div className="glass-card rounded-xl p-6 hover:scale-[1.02] transition-all duration-200 cursor-pointer border border-purple-500/30 group-hover:border-purple-400/50">
                {/* ランクアイコンとプロフィール */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <img
                        src={player.avatar_url || '/default-avatar.png'}
                        alt={player.handle_name}
                        className="w-16 h-16 rounded-full border-2 border-purple-500"
                      />
                      <div className="absolute -bottom-1 -right-1 text-xl">
                        {getRankIcon(player.ranking_points)}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-yellow-100">{player.handle_name}</h3>
                      {player.address && (
                        <p className="text-sm text-gray-400 flex items-center gap-1">
                          <FaMapMarkerAlt className="text-xs" />
                          {player.address}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  {/* ステータスバッジ */}
                  <div className="flex flex-col gap-1">
                    {player.is_active ? (
                      <span className="px-2 py-1 bg-green-500/20 border border-green-500/50 text-green-400 text-xs rounded-full">
                        アクティブ
                      </span>
                    ) : (
                      <span className="px-2 py-1 bg-gray-500/20 border border-gray-500/50 text-gray-400 text-xs rounded-full">
                        非アクティブ
                      </span>
                    )}
                  </div>
                </div>

                {/* ランキングポイントバー */}
                <div className="mb-4">
                  <div className="flex justify-between items-end mb-1">
                    <span className="text-sm text-gray-400">ランキング</span>
                    <span className="text-2xl font-bold text-yellow-100">{player.ranking_points}pt</span>
                  </div>
                  <div className="h-2 bg-purple-900/30 rounded-full overflow-hidden">
                    <div 
                      className={`h-full bg-gradient-to-r ${getRankColor(player.ranking_points)} rounded-full transition-all duration-500`}
                      style={{ width: `${Math.min((player.ranking_points / 2000) * 100, 100)}%` }}
                    />
                  </div>
                </div>

                {/* ステータス */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-purple-900/30 rounded-lg p-3 text-center">
                    <FaChartLine className="text-blue-400 mx-auto mb-1" />
                    <div className="text-sm text-gray-400">ハンディ</div>
                    <div className="font-bold text-yellow-100">{player.handicap}</div>
                  </div>
                  
                  <div className="bg-purple-900/30 rounded-lg p-3 text-center">
                    <FaGamepad className="text-green-400 mx-auto mb-1" />
                    <div className="text-sm text-gray-400">試合数</div>
                    <div className="font-bold text-yellow-100">{player.matches_played}</div>
                  </div>
                </div>

                {/* 勝敗統計 */}
                <div className="flex justify-between items-center pt-4 border-t border-purple-500/20">
                  <div className="text-center">
                    <p className="text-xl font-bold text-green-400">{player.wins}</p>
                    <p className="text-xs text-gray-500">勝利</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-red-400">{player.losses}</p>
                    <p className="text-xs text-gray-500">敗北</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-purple-400">{winRate}%</p>
                    <p className="text-xs text-gray-500">勝率</p>
                  </div>
                </div>

                {/* ホバー時のインジケーター */}
                <div className="mt-4 text-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <span className="text-sm text-purple-400">詳細を見る →</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {filteredAndSortedPlayers.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <FaUsers className="text-6xl mx-auto mb-4 opacity-50" />
          <p>該当するプレイヤーが見つかりません</p>
        </div>
      )}
    </div>
  );
}