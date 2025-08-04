// app/page.tsx

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { FaTrophy, FaUsers, FaChartLine, FaHistory, FaUserPlus, FaCalendar, FaMedal } from 'react-icons/fa';

const supabase = createClient();

interface Stats {
  totalMatches: number;
  activeMembers: number;
  avgRankingPoint: number;
}

interface TopPlayer {
  id: string;
  handle_name: string;
  avatar_url: string;
  ranking_points: number;
  handicap: number;
}

interface Notice {
  id: string;
  title: string;
  content: string;
  date: string;
  is_published: boolean;
  created_by: string;
}

export default function HomePage() {
  const [stats, setStats] = useState<Stats>({
    totalMatches: 0,
    activeMembers: 0,
    avgRankingPoint: 1000,
  });
  const [topPlayers, setTopPlayers] = useState<TopPlayer[]>([]);
  const [recentMatches, setRecentMatches] = useState<any[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    fetchStats();
    fetchTopPlayers();
    fetchRecentMatches();
    fetchNotices();
  }, []);

  const fetchStats = async () => {
    try {
      const [matchesResult, playersResult] = await Promise.all([
        supabase.from('matches').select('id', { count: 'exact' }),
        supabase.from('players').select('id, ranking_points, is_active').eq('is_admin', false),
      ]);

      if (playersResult.data) {
        const activePlayers = playersResult.data.filter(p => p.is_active);
        const avgPoints = playersResult.data.reduce((sum, p) => sum + p.ranking_points, 0) / playersResult.data.length;
        
        setStats({
          totalMatches: matchesResult.count || 0,
          activeMembers: activePlayers.length,
          avgRankingPoint: Math.round(avgPoints),
        });
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchTopPlayers = async () => {
    try {
      const { data } = await supabase
        .from('players')
        .select('id, handle_name, avatar_url, ranking_points, handicap')
        .eq('is_active', true)
        .eq('is_admin', false)
        .order('ranking_points', { ascending: false })
        .limit(3);

      if (data) {
        setTopPlayers(data);
      }
    } catch (error) {
      console.error('Error fetching top players:', error);
    }
  };

  const fetchRecentMatches = async () => {
    try {
      const { data } = await supabase
        .from('match_details')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      if (data) {
        setRecentMatches(data);
      }
    } catch (error) {
      console.error('Error fetching recent matches:', error);
    }
  };

  const fetchNotices = async () => {
    try {
      const { data, error } = await supabase
        .from('notices')
        .select('*')
        .eq('is_published', true)
        .order('date', { ascending: false })
        .limit(3);

      if (error) {
        console.error('Error fetching notices:', error);
        return;
      }

      if (data) {
        setNotices(data);
      }
    } catch (error) {
      console.error('Error fetching notices:', error);
    }
  };

  const menuItems = [
    { icon: FaChartLine, title: 'ランキング', description: '最新のランキング', href: '/rankings' },
    { icon: FaUsers, title: 'メンバー', description: 'クラブメンバーを見る', href: '/players' },
    { icon: FaHistory, title: '試合結果', description: '過去の試合をチェック', href: '/matches' },
    { icon: FaUserPlus, title: '試合登録', description: '新しい試合を登録', href: '/matches/register' },
  ];

  return (
    <div className="min-h-screen">
      {/* ヒーローセクション */}
      <div className="relative py-20 text-center">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-purple-900/20 to-transparent"></div>
        </div>
        
        <div className="relative z-10">
          <div className="inline-block p-6 mb-6 rounded-full bg-blue-600/20 backdrop-blur-sm float-animation">
            <FaTrophy className="text-6xl text-yellow-400" />
          </div>
          
          <h1 className="text-6xl font-bold mb-4 bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text text-transparent">
            豊浦シャッフラーズクラブ
          </h1>
          
          <p className="text-xl text-gray-300 mb-8">
            みんなで楽しくシャッフルボード！<br />
            友達と競い合い、スキルを磨こう
          </p>
          
          <div className="flex gap-4 justify-center">
            <Link href="/register" className="gradient-button px-8 py-3 rounded-full text-white font-medium flex items-center gap-2">
              <FaUserPlus /> 新規登録
            </Link>
            <Link href="/admin/login" className="px-8 py-3 rounded-full border border-purple-500 text-purple-400 hover:bg-purple-500/10 transition-colors font-medium">
              ログイン
            </Link>
          </div>

          {/* お知らせセクション - 新規追加 */}
          {notices.length > 0 && (
            <div className="mt-12 max-w-2xl mx-auto">
              <h3 className="text-lg font-semibold text-yellow-300 mb-4 flex items-center justify-center gap-2">
                <span>📢</span> クラブからのお知らせ
              </h3>
              <div className="space-y-2">
                {notices.map((notice) => (
                  <Link 
                    key={notice.id} 
                    href={`/notices/${notice.id}`}
                    className="block glass-card rounded-lg px-4 py-3 hover:bg-purple-900/20 transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-400">
                          {new Date(notice.date).toLocaleDateString('ja-JP', {
                            year: 'numeric',
                            month: 'numeric',
                            day: 'numeric'
                          })}
                        </span>
                        <span className="text-yellow-100 group-hover:text-yellow-300 transition-colors">
                          {notice.title}
                        </span>
                      </div>
                      <span className="text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        →
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* メニューグリッド */}
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          {menuItems.map((item, index) => {
            let cardClass = '';
            if (index === 0) cardClass = 'ranking-card';
            else if (index === 1) cardClass = 'members-card';
            else if (index === 2) cardClass = 'matches-card';
            else if (index === 3) cardClass = 'register-card';
            
            return (
              <Link key={index} href={item.href}>
                <div className={`${cardClass} glass-card rounded-xl p-6 hover:scale-105 transition-transform cursor-pointer group`}>
                  <div className="flex flex-col items-center text-center">
                    <div className="p-4 rounded-full bg-gradient-to-br from-purple-600/20 to-pink-600/20 mb-4 group-hover:scale-110 transition-transform">
                      <item.icon className="text-3xl text-purple-400" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2 text-yellow-100">{item.title}</h3>
                    <p className="text-sm text-gray-400">{item.description}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* 統計セクション */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="glass-card rounded-xl p-6 text-center">
            <FaUsers className="text-4xl text-pink-400 mx-auto mb-3" />
            <div className="text-3xl font-bold mb-1 text-yellow-100">{stats.activeMembers}</div>
            <div className="text-gray-400">アクティブメンバー</div>
          </div>
          
          <div className="glass-card rounded-xl p-6 text-center">
            <FaCalendar className="text-4xl text-yellow-400 mx-auto mb-3" />
            <div className="text-3xl font-bold mb-1 text-yellow-100">{stats.totalMatches}</div>
            <div className="text-gray-400">総試合数</div>
          </div>
          
          <div className="glass-card rounded-xl p-6 text-center">
            <FaChartLine className="text-4xl text-blue-400 mx-auto mb-3" />
            <div className="text-3xl font-bold mb-1 text-yellow-100">{stats.avgRankingPoint}</div>
            <div className="text-gray-400">平均ランキングポイント</div>
          </div>
        </div>

        {/* トッププレイヤー */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2 text-yellow-100">
            <FaTrophy className="text-yellow-400" />
            トッププレーヤー
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {topPlayers.map((player, index) => (
              <Link key={player.id} href={`/players/${player.id}`}>
                <div className="glass-card rounded-xl p-6 hover:scale-105 transition-transform cursor-pointer">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <img
                        src={player.avatar_url || '/default-avatar.png'}
                        alt={player.handle_name}
                        className="w-12 h-12 rounded-full"
                      />
                      <div>
                        <h3 className="font-semibold text-yellow-100">{player.handle_name}</h3>
                        <p className="text-sm text-gray-400">ハンディ: {player.handicap}</p>
                      </div>
                    </div>
                    <div className={`text-2xl font-bold ${
                      index === 0 ? 'text-yellow-400' :
                      index === 1 ? 'text-gray-300' :
                      'text-orange-600'
                    }`}>
                      {index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-yellow-100">{player.ranking_points}pt</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* 最近の試合 */}
        <div>
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2 text-yellow-100">
            <FaHistory className="text-blue-400" />
            最近の試合
          </h2>
          
          <div className="space-y-3">
            {recentMatches.map((match) => {
              const isUpset = (
                (match.winner_current_points < match.loser_current_points - 100) ||
                (match.winner_current_handicap > match.loser_current_handicap + 5)
              );
              
              return (
                <div key={match.id} className={`glass-card rounded-lg p-4 relative ${
                  isUpset ? 'border border-yellow-500/50 shadow-lg shadow-yellow-500/10' : ''
                }`}>
                  {/* 番狂わせバッジ */}
                  {isUpset && (
                    <div className="absolute top-2 left-1/2 transform -translate-x-1/2">
                      <span className="px-2 py-1 rounded-full bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 text-yellow-400 text-xs font-medium">
                        番狂わせ
                      </span>
                    </div>
                  )}
                  
                  {/* スコア（中央） */}
                  <div className="text-center mb-3">
                    <div className={`text-2xl font-bold text-yellow-100 ${isUpset ? 'mt-6' : 'mt-2'}`}>
                      15 - {match.loser_score}
                    </div>
                  </div>
                  
                  {/* プレイヤー情報（左右） */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <img
                        src={match.winner_avatar || '/default-avatar.png'}
                        alt={match.winner_name}
                        className="w-10 h-10 rounded-full"
                      />
                      <div>
                        <div className="font-medium text-yellow-100">{match.winner_name}</div>
                        <div className="text-sm text-green-400">勝利</div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-medium text-yellow-100">{match.loser_name}</div>
                        <div className="text-sm text-red-400">敗北</div>
                      </div>
                      <img
                        src={match.loser_avatar || '/default-avatar.png'}
                        alt={match.loser_name}
                        className="w-10 h-10 rounded-full"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          <div className="text-center mt-6">
            <Link href="/matches" className="text-purple-400 hover:text-purple-300 transition-colors">
              すべての試合を見る →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}