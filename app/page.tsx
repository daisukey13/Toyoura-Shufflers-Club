'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { FaTrophy, FaUsers, FaChartLine, FaHistory, FaUserPlus, FaCalendar, FaMedal, FaSignInAlt, FaTimes } from 'react-icons/fa';

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
  
  // ログイン関連の状態
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [handleName, setHandleName] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  const router = useRouter();
  const { refreshAuth, user, player, isAdmin, loading } = useAuth();

  useEffect(() => {
    fetchStats();
    fetchTopPlayers();
    fetchRecentMatches();
    fetchNotices();
  }, []);

  // ユーザーがログイン済みの場合、適切なページへリダイレクト
  useEffect(() => {
    if (user && player && !loading) {
      if (player.is_admin) {
        router.push('/admin/dashboard');
      } else {
        router.push(`/players/${player.id}`);
      }
    }
  }, [user, player, loading, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);

    try {
      // 1. ハンドルネームからプレーヤー情報を取得
      const { data: playerData, error: playerError } = await supabase
        .from('players')
        .select('id, email, is_admin')
        .eq('handle_name', handleName)
        .single();

      if (playerError || !playerData) {
        setLoginError('ユーザーが見つかりません');
        setIsLoggingIn(false);
        return;
      }

      // 2. メールアドレスとパスワードでログイン
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: playerData.email,
        password: password,
      });

      if (signInError) {
        setLoginError('パスワードが正しくありません');
        setIsLoggingIn(false);
        return;
      }

      // 3. 認証情報を更新
      await refreshAuth();

      // 4. リダイレクト処理
      setShowLoginModal(false);
      if (playerData.is_admin) {
        router.push('/admin/dashboard');
      } else {
        router.push(`/players/${playerData.id}`);
      }

    } catch (error: any) {
      console.error('ログインエラー:', error);
      setLoginError(error.message || 'ログインに失敗しました');
    } finally {
      setIsLoggingIn(false);
    }
  };

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
      {/* ヒーローセクション - モバイル最適化版 */}
      <div className="relative py-10 sm:py-20 text-center">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-purple-900/20 to-transparent"></div>
        </div>
        
        <div className="relative z-10 px-4">
          {/* コンパクトなヘッダー */}
          <div className="mb-6 sm:mb-8">
            {/* エンブレム風のロゴ */}
            <div className="inline-flex items-center justify-center w-14 h-14 sm:w-20 sm:h-20 mb-3 sm:mb-4 rounded-full bg-gradient-to-br from-yellow-400/20 to-orange-600/20 backdrop-blur-sm border border-yellow-400/30 shadow-lg float-animation">
              <span className="text-2xl sm:text-4xl">🏆</span>
            </div>
            
            {/* タイトル */}
            <h1 className="font-bold tracking-tight mb-2">
              {/* モバイル - 2行表示 */}
              <span className="sm:hidden">
                <span className="block text-2xl bg-gradient-to-r from-yellow-300 to-orange-400 bg-clip-text text-transparent">
                  豊浦シャッフラーズ
                </span>
                <span className="block text-lg text-yellow-200">
                  CLUB
                </span>
              </span>
              
              {/* デスクトップ */}
              <span className="hidden sm:inline-block text-5xl lg:text-6xl bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text text-transparent">
                豊浦シャッフラーズクラブ
              </span>
            </h1>
            
            {/* 装飾ライン */}
            <div className="flex items-center justify-center gap-1 mb-3">
              <div className="w-8 h-px bg-gradient-to-r from-transparent to-yellow-400/50"></div>
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-400"></div>
              <div className="w-8 h-px bg-gradient-to-l from-transparent to-yellow-400/50"></div>
            </div>
            
            {/* サブタイトル */}
            <p className="text-sm sm:text-lg text-gray-300 max-w-xs sm:max-w-md mx-auto">
              みんなで楽しくシャッフルボード！
            </p>
          </div>
          
          {/* CTAボタン */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-xs mx-auto sm:max-w-none">
            <Link href="/register" className="gradient-button px-6 py-2.5 sm:px-8 sm:py-3 rounded-full text-white font-medium text-sm sm:text-base flex items-center justify-center gap-2">
              <FaUserPlus className="text-sm" /> 新規登録
            </Link>
            <button 
              onClick={() => setShowLoginModal(true)}
              className="px-6 py-2.5 sm:px-8 sm:py-3 rounded-full border border-purple-500 text-purple-400 hover:bg-purple-500/10 transition-colors font-medium text-sm sm:text-base flex items-center justify-center gap-2"
            >
              <FaSignInAlt className="text-sm" /> ログイン
            </button>
          </div>

          {/* お知らせセクション - モバイル対応 */}
          {notices.length > 0 && (
            <div className="mt-8 sm:mt-12 max-w-2xl mx-auto">
              <h3 className="text-base sm:text-lg font-semibold text-yellow-300 mb-3 sm:mb-4 flex items-center justify-center gap-2">
                <span className="text-lg sm:text-base">📢</span> 
                <span>お知らせ</span>
              </h3>
              <div className="space-y-2">
                {notices.map((notice) => (
                  <Link 
                    key={notice.id} 
                    href={`/notices/${notice.id}`}
                    className="block glass-card rounded-lg px-3 sm:px-4 py-2.5 sm:py-3 hover:bg-purple-900/20 transition-all group"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 min-w-0">
                        <span className="text-xs sm:text-sm text-gray-400 flex-shrink-0">
                          {new Date(notice.date).toLocaleDateString('ja-JP', {
                            month: 'numeric',
                            day: 'numeric'
                          })}
                        </span>
                        <span className="text-sm sm:text-base text-yellow-100 group-hover:text-yellow-300 transition-colors truncate">
                          {notice.title}
                        </span>
                      </div>
                      <span className="text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-sm">
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

      {/* メニューグリッド - モバイル対応 */}
      <div className="container mx-auto px-4 py-8 sm:py-12">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-8 sm:mb-12">
          {menuItems.map((item, index) => {
            let cardClass = '';
            if (index === 0) cardClass = 'ranking-card';
            else if (index === 1) cardClass = 'members-card';
            else if (index === 2) cardClass = 'matches-card';
            else if (index === 3) cardClass = 'register-card';
            
            return (
              <Link key={index} href={item.href}>
                <div className={`${cardClass} glass-card rounded-xl p-4 sm:p-6 hover:scale-105 transition-transform cursor-pointer group h-full`}>
                  <div className="flex flex-col items-center text-center">
                    <div className="p-3 sm:p-4 rounded-full bg-gradient-to-br from-purple-600/20 to-pink-600/20 mb-2 sm:mb-4 group-hover:scale-110 transition-transform">
                      <item.icon className="text-xl sm:text-3xl text-purple-400" />
                    </div>
                    <h3 className="text-base sm:text-lg font-semibold mb-1 sm:mb-2 text-yellow-100">{item.title}</h3>
                    <p className="text-xs sm:text-sm text-gray-400 hidden sm:block">{item.description}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* 統計セクション - モバイル対応 */}
        <div className="grid grid-cols-3 gap-3 sm:gap-6 mb-8 sm:mb-12">
          <div className="glass-card rounded-xl p-3 sm:p-6 text-center">
            <FaUsers className="text-2xl sm:text-4xl text-pink-400 mx-auto mb-2 sm:mb-3" />
            <div className="text-xl sm:text-3xl font-bold mb-1 text-yellow-100">{stats.activeMembers}</div>
            <div className="text-xs sm:text-base text-gray-400">メンバー</div>
          </div>
          
          <div className="glass-card rounded-xl p-3 sm:p-6 text-center">
            <FaCalendar className="text-2xl sm:text-4xl text-yellow-400 mx-auto mb-2 sm:mb-3" />
            <div className="text-xl sm:text-3xl font-bold mb-1 text-yellow-100">{stats.totalMatches}</div>
            <div className="text-xs sm:text-base text-gray-400">試合数</div>
          </div>
          
          <div className="glass-card rounded-xl p-3 sm:p-6 text-center">
            <FaChartLine className="text-2xl sm:text-4xl text-blue-400 mx-auto mb-2 sm:mb-3" />
            <div className="text-xl sm:text-3xl font-bold mb-1 text-yellow-100">{stats.avgRankingPoint}</div>
            <div className="text-xs sm:text-base text-gray-400">平均pts</div>
          </div>
        </div>

        {/* トッププレイヤー - モバイル対応 */}
        <div className="mb-8 sm:mb-12">
          <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center gap-2 text-yellow-100">
            <FaTrophy className="text-yellow-400 text-lg sm:text-2xl" />
            トッププレーヤー
          </h2>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-6">
            {topPlayers.map((player, index) => (
              <Link key={player.id} href={`/players/${player.id}`}>
                <div className="glass-card rounded-xl p-4 sm:p-6 hover:scale-105 transition-transform cursor-pointer">
                  <div className="flex items-center justify-between mb-3 sm:mb-4">
                    <div className="flex items-center gap-3">
                      <image
                        src={player.avatar_url || '/default-avatar.png'}
                        alt={player.handle_name}
                        className="w-10 h-10 sm:w-12 sm:h-12 rounded-full"
                      />
                      <div>
                        <h3 className="font-semibold text-yellow-100 text-sm sm:text-base">{player.handle_name}</h3>
                        <p className="text-xs sm:text-sm text-gray-400">ハンディ: {player.handicap}</p>
                      </div>
                    </div>
                    <div className={`text-xl sm:text-2xl font-bold`}>
                      {index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl sm:text-2xl font-bold text-yellow-100">{player.ranking_points}pt</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* 最近の試合 - モバイル対応 */}
        <div>
          <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center gap-2 text-yellow-100">
            <FaHistory className="text-blue-400 text-lg sm:text-2xl" />
            最近の試合
          </h2>
          
          <div className="space-y-3">
            {recentMatches.slice(0, 3).map((match) => {
              const isUpset = (
                (match.winner_current_points < match.loser_current_points - 100) ||
                (match.winner_current_handicap > match.loser_current_handicap + 5)
              );
              
              return (
                <div key={match.id} className={`glass-card rounded-lg p-3 sm:p-4 relative ${
                  isUpset ? 'border border-yellow-500/50 shadow-lg shadow-yellow-500/10' : ''
                }`}>
                  {/* 番狂わせバッジ */}
                  {isUpset && (
                    <div className="absolute top-2 left-1/2 transform -translate-x-1/2">
                      <span className="px-2 py-0.5 rounded-full bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 text-yellow-400 text-xs font-medium">
                        番狂わせ
                      </span>
                    </div>
                  )}
                  
                  {/* スコア（中央） - モバイルで小さく */}
                  <div className="text-center mb-2 sm:mb-3">
                    <div className={`text-xl sm:text-2xl font-bold text-yellow-100 ${isUpset ? 'mt-5 sm:mt-6' : 'mt-1 sm:mt-2'}`}>
                      15 - {match.loser_score}
                    </div>
                  </div>
                  
                  {/* プレイヤー情報（左右） - モバイル対応 */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <Image
                        src={match.winner_avatar || '/default-avatar.png'}
                        alt={match.winner_name}
                        className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex-shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-yellow-100 text-sm sm:text-base truncate">{match.winner_name}</div>
                        <div className="text-xs sm:text-sm text-green-400">勝利</div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <div className="text-right min-w-0">
                        <div className="font-medium text-yellow-100 text-sm sm:text-base truncate">{match.loser_name}</div>
                        <div className="text-xs sm:text-sm text-red-400">敗北</div>
                      </div>
                      <Image
                        src={match.loser_avatar || '/default-avatar.png'}
                        alt={match.loser_name}
                        className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex-shrink-0"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          <div className="text-center mt-4 sm:mt-6">
            <Link href="/matches" className="text-purple-400 hover:text-purple-300 transition-colors text-sm sm:text-base">
              すべての試合を見る →
            </Link>
          </div>
        </div>
      </div>

      {/* ログインモーダル - モバイル対応 */}
      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowLoginModal(false)} />
          <div className="relative glass-card rounded-2xl p-6 sm:p-8 max-w-md w-full">
            <button
              onClick={() => setShowLoginModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-200"
            >
              <FaTimes />
            </button>
            
            <h2 className="text-xl sm:text-2xl font-bold text-yellow-100 mb-4 sm:mb-6 text-center">ログイン</h2>
            
            <form onSubmit={handleLogin} className="space-y-4">
              {loginError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <p className="text-sm text-red-400">{loginError}</p>
                </div>
              )}
              
              <div>
                <label htmlFor="handle-name" className="block text-sm font-medium text-gray-300 mb-2">
                  ハンドルネーム
                </label>
                <input
                  id="handle-name"
                  name="handle-name"
                  type="text"
                  autoComplete="username"
                  required
                  className="w-full px-4 py-2 rounded-lg bg-gray-800/50 border border-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm sm:text-base"
                  placeholder="ハンドルネーム"
                  value={handleName}
                  onChange={(e) => setHandleName(e.target.value)}
                />
              </div>
              
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                  パスワード
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="w-full px-4 py-2 rounded-lg bg-gray-800/50 border border-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm sm:text-base"
                  placeholder="パスワード"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              
              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full gradient-button py-2.5 sm:py-3 rounded-lg text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
              >
                {isLoggingIn ? 'ログイン中...' : 'ログイン'}
              </button>
            </form>
            
            <div className="mt-4 sm:mt-6 text-center">
              <p className="text-xs sm:text-sm text-gray-400">
                アカウントをお持ちでない方は
                <Link href="/register" className="text-purple-400 hover:text-purple-300 ml-1">
                  新規登録
                </Link>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}