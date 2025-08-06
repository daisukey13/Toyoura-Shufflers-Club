// app/(main)/rankings/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Player } from '@/types/player';
import { FaTrophy, FaMedal, FaChartLine, FaFire, FaMapMarkerAlt } from 'react-icons/fa';
import Link from 'next/link';

const supabase = createClient();

export default function RankingsPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'points' | 'handicap'>('points');

  useEffect(() => {
    fetchPlayers();
  }, []);

  const fetchPlayers = async () => {
    try {
      const { data, error } = await supabase
        .from('players')
        .select('*')
        .eq('is_active', true)
        .eq('is_admin', false)  // 管理者を除外
        .eq('is_deleted', false)  // 退会者を除外
        .order('ranking_points', { ascending: false });

      if (!error && data) {
        setPlayers(data);
      }
    } catch (err) {
      console.error('Error fetching players:', err);
    } finally {
      setLoading(false);
    }
  };

  const sortedPlayers = [...players].sort((a, b) => {
    if (sortBy === 'points') {
      return b.ranking_points - a.ranking_points;
    } else {
      return a.handicap - b.handicap;
    }
  });

  const getRankBadge = (rank: number) => {
    if (rank === 1) {
      return (
        <div className="relative">
          <div className="absolute -inset-1 bg-yellow-400 rounded-full blur-sm animate-pulse"></div>
          <div className="relative bg-gradient-to-br from-yellow-400 to-yellow-600 text-gray-900 w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg">
            1
          </div>
        </div>
      );
    } else if (rank === 2) {
      return (
        <div className="relative">
          <div className="absolute -inset-1 bg-gray-300 rounded-full blur-sm"></div>
          <div className="relative bg-gradient-to-br from-gray-300 to-gray-500 text-gray-900 w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg">
            2
          </div>
        </div>
      );
    } else if (rank === 3) {
      return (
        <div className="relative">
          <div className="absolute -inset-1 bg-orange-500 rounded-full blur-sm"></div>
          <div className="relative bg-gradient-to-br from-orange-400 to-orange-600 text-gray-900 w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg">
            3
          </div>
        </div>
      );
    }
    return (
      <div className="bg-purple-900/30 text-purple-300 w-12 h-12 rounded-full flex items-center justify-center font-bold">
        #{rank}
      </div>
    );
  };

  const getFrameColor = (rank: number) => {
    if (rank === 1) return 'from-yellow-400/50 to-yellow-600/50';
    if (rank === 2) return 'from-gray-300/50 to-gray-500/50';
    if (rank === 3) return 'from-orange-400/50 to-orange-600/50';
    return 'from-purple-600/20 to-pink-600/20';
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
        <div className="inline-block p-4 mb-4 rounded-full bg-gradient-to-br from-yellow-400/20 to-orange-600/20">
          <FaTrophy className="text-5xl text-yellow-400" />
        </div>
        <h1 className="text-4xl font-bold mb-4 text-yellow-100">
          🏆 ランキング
        </h1>
        <p className="text-gray-400">
          豊浦シャッフラーズクラブのプレーヤーランキング
        </p>
      </div>

      {/* 統計カード */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="glass-card rounded-xl p-6 text-center border border-pink-500/20">
          <FaChartLine className="text-4xl text-pink-400 mx-auto mb-3" />
          <div className="text-3xl font-bold text-yellow-100 mb-1">{players.length}</div>
          <div className="text-gray-400">アクティブプレーヤー</div>
        </div>
        
        <div className="glass-card rounded-xl p-6 text-center border border-yellow-500/20">
          <FaFire className="text-4xl text-yellow-400 mx-auto mb-3" />
          <div className="text-3xl font-bold text-yellow-100 mb-1">
            {sortedPlayers[0]?.ranking_points || 0}
          </div>
          <div className="text-gray-400">最高ポイント</div>
        </div>
        
        <div className="glass-card rounded-xl p-6 text-center border border-purple-500/20">
          <FaMedal className="text-4xl text-purple-400 mx-auto mb-3" />
          <div className="text-3xl font-bold text-yellow-100 mb-1">
            {Math.round(players.reduce((sum, p) => sum + p.ranking_points, 0) / players.length) || 0}
          </div>
          <div className="text-gray-400">平均ポイント</div>
        </div>
      </div>

      {/* ソート切り替え */}
      <div className="mb-8 flex justify-center">
        <div className="inline-flex rounded-lg overflow-hidden">
          <button
            onClick={() => setSortBy('points')}
            className={`px-6 py-3 font-medium transition-all ${
              sortBy === 'points' 
                ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white' 
                : 'bg-purple-900/30 text-gray-400 hover:text-white'
            }`}
          >
            ポイント順
          </button>
          <button
            onClick={() => setSortBy('handicap')}
            className={`px-6 py-3 font-medium transition-all ${
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
      <div className="space-y-4">
        {sortedPlayers.map((player, index) => {
          const rank = index + 1;
          const isTop3 = rank <= 3;
          
          return (
            <Link key={player.id} href={`/players/${player.id}`}>
              <div className={`glass-card rounded-xl p-6 hover:scale-[1.02] transition-all cursor-pointer ${
                isTop3 ? 'border-2' : 'border'
              } border-gradient bg-gradient-to-r ${getFrameColor(rank)}`}>
                <div className="flex items-center gap-4">
                  {/* ランクバッジ */}
                  {getRankBadge(rank)}
                  
                  {/* アバター */}
                  <div className="relative">
                    {isTop3 && (
                      <div className={`absolute -inset-1 rounded-full blur-sm ${
                        rank === 1 ? 'bg-yellow-400' :
                        rank === 2 ? 'bg-gray-300' :
                        'bg-orange-500'
                      }`}></div>
                    )}
                    <img
                      src={player.avatar_url || '/default-avatar.png'}
                      alt={player.handle_name}
                      className="relative w-16 h-16 rounded-full border-2 border-purple-500"
                    />
                  </div>
                  
                  {/* プレイヤー情報 */}
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-yellow-100 mb-1">
                      {player.handle_name}
                    </h3>
                    <div className="flex items-center gap-4 text-sm text-gray-400">
                      {player.address && (
                        <span className="flex items-center gap-1">
                          <FaMapMarkerAlt className="text-xs" />
                          {player.address}
                        </span>
                      )}
                      <span className="px-2 py-1 rounded-full bg-purple-900/30 text-purple-300">
                        ハンディ: {player.handicap}
                      </span>
                    </div>
                  </div>
                  
                  {/* ポイント */}
                  <div className="text-right">
                    <div className={`text-3xl font-bold ${
                      isTop3 ? 'text-yellow-100' : 'text-purple-300'
                    }`}>
                      {player.ranking_points}
                    </div>
                    <div className="text-sm text-gray-400">ポイント</div>
                  </div>
                </div>
                
                {/* 統計バー */}
                <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                  <div className="bg-purple-900/30 rounded-lg py-2">
                    <div className="text-green-400 font-bold">{player.wins}</div>
                    <div className="text-xs text-gray-500">勝利</div>
                  </div>
                  <div className="bg-purple-900/30 rounded-lg py-2">
                    <div className="text-red-400 font-bold">{player.losses}</div>
                    <div className="text-xs text-gray-500">敗北</div>
                  </div>
                  <div className="bg-purple-900/30 rounded-lg py-2">
                    <div className="text-blue-400 font-bold">
                      {player.matches_played > 0 
                        ? ((player.wins / player.matches_played) * 100).toFixed(0)
                        : '0'}%
                    </div>
                    <div className="text-xs text-gray-500">勝率</div>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {sortedPlayers.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <FaTrophy className="text-6xl mx-auto mb-4 opacity-50" />
          <p>アクティブなプレイヤーがいません</p>
        </div>
      )}
    </div>
  );
}