'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { FaUsers, FaTrophy, FaSearch, FaFilter, FaMedal, FaChartLine, FaCrown } from 'react-icons/fa';

const supabase = createClient();

interface Player {
  id: string;
  handle_name: string;
  avatar_url: string;
  ranking_points: number;
  handicap: number;
  matches_played: number;
  wins: number;
  losses: number;
  address: string;
  is_active: boolean;
  is_admin: boolean;
}

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAddress, setFilterAddress] = useState('all');
  const [sortBy, setSortBy] = useState<'ranking' | 'handicap' | 'wins' | 'matches'>('ranking');

  const addressOptions = [
    '豊浦町', '洞爺湖町', '壮瞥町', '伊達市', '室蘭市', '登別市',
    '倶知安町', 'ニセコ町', '札幌市', 'その他道内', '内地', '外国（Visitor)'
  ];

  useEffect(() => {
    fetchPlayers();
  }, []);

  const fetchPlayers = async () => {
    try {
      const { data, error } = await supabase
        .from('players')
        .select('*')
        .eq('is_active', true)
        .order('ranking_points', { ascending: false });

      if (error) throw error;
      setPlayers(data || []);
    } catch (error) {
      console.error('Error fetching players:', error);
    } finally {
      setLoading(false);
    }
  };

  // フィルタリングとソート
  const filteredAndSortedPlayers = players
    .filter(player => {
      const matchesSearch = player.handle_name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesAddress = filterAddress === 'all' || player.address === filterAddress;
      return matchesSearch && matchesAddress;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'ranking':
          return b.ranking_points - a.ranking_points;
        case 'handicap':
          return a.handicap - b.handicap;
        case 'wins':
          return b.wins - a.wins;
        case 'matches':
          return b.matches_played - a.matches_played;
        default:
          return 0;
      }
    });

  const getWinRate = (player: Player) => {
    if (player.matches_played === 0) return 0;
    return Math.round((player.wins / player.matches_played) * 100);
  };

  const getRankIcon = (index: number) => {
    if (index === 0) return '🥇';
    if (index === 1) return '🥈';
    if (index === 2) return '🥉';
    return null;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex items-center justify-center">
        <div className="text-white">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#2a2a3e]">
      <div className="container mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="mb-8 text-center">
          <div className="inline-block p-4 mb-4 rounded-full bg-gradient-to-br from-purple-400/20 to-pink-600/20">
            <FaUsers className="text-5xl text-purple-400" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-2 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            プレーヤー一覧
          </h1>
          <p className="text-gray-300">
            総勢 {players.length} 名のシャッフラーズ
          </p>
        </div>

        {/* フィルター・検索 */}
        <div className="mb-8 space-y-4">
          {/* 検索バー */}
          <div className="relative">
            <FaSearch className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="プレーヤー名で検索..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-gray-900/60 border border-purple-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-purple-400"
            />
          </div>

          {/* フィルターとソート */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                <FaFilter className="inline mr-2" />
                地域でフィルター
              </label>
              <select
                value={filterAddress}
                onChange={(e) => setFilterAddress(e.target.value)}
                className="w-full px-4 py-2 bg-gray-900/60 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:border-purple-400"
              >
                <option value="all">すべての地域</option>
                {addressOptions.map(address => (
                  <option key={address} value={address}>{address}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                <FaChartLine className="inline mr-2" />
                並び順
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="w-full px-4 py-2 bg-gray-900/60 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:border-purple-400"
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAndSortedPlayers.map((player, index) => {
            const winRate = getWinRate(player);
            const rankIcon = getRankIcon(index);
            
            return (
              <Link key={player.id} href={`/players/${player.id}`}>
                <div className="glass-card rounded-xl p-6 hover:scale-105 transition-transform cursor-pointer relative border border-purple-500/30">
                  {/* ランクアイコン */}
                  {rankIcon && sortBy === 'ranking' && (
                    <div className="absolute top-2 right-2 text-2xl">
                      {rankIcon}
                    </div>
                  )}
                  
                  {/* 管理者バッジ */}
                  {player.is_admin && (
                    <div className="absolute top-2 left-2">
                      <div className="flex items-center gap-1 px-2 py-1 bg-yellow-500/20 border border-yellow-500/30 rounded-full">
                        <FaCrown className="text-yellow-400 text-xs" />
                        <span className="text-yellow-400 text-xs font-medium">管理者</span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-4 mb-4">
                    <img
                      src={player.avatar_url || '/default-avatar.png'}
                      alt={player.handle_name}
                      className="w-16 h-16 rounded-full border-2 border-purple-500/30"
                    />
                    <div>
                      <h3 className="text-lg font-bold text-white">{player.handle_name}</h3>
                      <p className="text-sm text-gray-400">{player.address}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-yellow-400">{player.ranking_points}</div>
                      <div className="text-xs text-gray-400">ポイント</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-purple-400">{player.handicap}</div>
                      <div className="text-xs text-gray-400">ハンディ</div>
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-sm">
                    <div className="text-gray-400">
                      試合数: <span className="text-white font-medium">{player.matches_played}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-400">{player.wins}勝</span>
                      <span className="text-gray-400">/</span>
                      <span className="text-red-400">{player.losses}敗</span>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-gray-700">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-400">勝率</span>
                      <span className={`text-sm font-bold ${
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
          })}
        </div>

        {/* 結果がない場合 */}
        {filteredAndSortedPlayers.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400">該当するプレーヤーが見つかりませんでした</p>
          </div>
        )}
      </div>
    </div>
  );
}