// app/(main)/players/[id]/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Player } from '@/types/player';
import { MatchDetails } from '@/types/matches';
import { FaTrophy, FaUser, FaChartLine, FaHistory, FaMapMarkerAlt, FaMedal, FaEdit, FaSave, FaTimes, FaGamepad, FaStar, FaFire, FaShieldAlt } from 'react-icons/fa';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  params: {
    id: string;
  };
}

const supabase = createClient();

export default function PlayerProfilePage({ params }: Props) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [matches, setMatches] = useState<MatchDetails[]>([]);
  const [stats, setStats] = useState({
    winRate: 0,
    recentForm: [] as ('W' | 'L')[],
    bestWin: null as MatchDetails | null,
    avgPointsChange: 0,
  });
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<Partial<Player>>({});
  const [saving, setSaving] = useState(false);
  
  const { isAdmin } = useAuth();

  useEffect(() => {
    fetchPlayerData();
  }, [params.id]);

  const fetchPlayerData = async () => {
    try {
      // プレイヤー情報取得
      const { data: playerData, error: playerError } = await supabase
        .from('players')
        .select('*')
        .eq('id', params.id)
        .single();

      if (playerError || !playerData) {
        notFound();
      }

      setPlayer(playerData);
      setEditData(playerData);

      // 試合履歴取得
      const { data: matchesData, error: matchesError } = await supabase
        .from('match_details')
        .select('*')
        .or(`winner_id.eq.${params.id},loser_id.eq.${params.id}`)
        .order('match_date', { ascending: false });

      if (!matchesError && matchesData) {
        setMatches(matchesData);
        calculateStats(matchesData, params.id);
      }
    } catch (error) {
      console.error('Error fetching player data:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (matchesData: MatchDetails[], playerId: string) => {
    if (matchesData.length === 0) return;

    // 勝率計算
    const wins = matchesData.filter(m => m.winner_id === playerId).length;
    const winRate = (wins / matchesData.length) * 100;

    // 最近のフォーム（直近5試合）
    const recentForm = matchesData
      .slice(0, 5)
      .map(m => m.winner_id === playerId ? 'W' : 'L') as ('W' | 'L')[];

    // 最高勝利（相手のランキングポイントが最も高い勝利）
    const victories = matchesData.filter(m => m.winner_id === playerId);
    let bestWin = null;
    if (victories.length > 0) {
      // ここでは仮実装（実際には相手のランキングポイントを取得する必要がある）
      bestWin = victories[0];
    }

    // 平均ポイント変動
    const totalPointsChange = matchesData.reduce((sum, match) => {
      if (match.winner_id === playerId) {
        return sum + match.winner_points_change;
      } else {
        return sum + match.loser_points_change;
      }
    }, 0);
    const avgPointsChange = totalPointsChange / matchesData.length;

    setStats({
      winRate,
      recentForm,
      bestWin,
      avgPointsChange,
    });
  };

  const handleEdit = () => {
    setEditMode(true);
  };

  const handleCancel = () => {
    setEditMode(false);
    setEditData(player!);
  };

  const handleSave = async () => {
    if (!player) return;
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from('players')
        .update({
          handle_name: editData.handle_name,
          full_name: editData.full_name,
          email: editData.email,
          phone: editData.phone,
          address: editData.address,
          ranking_points: editData.ranking_points,
          handicap: editData.handicap,
          is_active: editData.is_active,
          is_admin: editData.is_admin,
        })
        .eq('id', player.id);

      if (error) throw error;

      setPlayer({ ...player, ...editData });
      setEditMode(false);
      alert('プレイヤー情報を更新しました');
    } catch (error) {
      console.error('Error updating player:', error);
      alert('更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex items-center justify-center">
        <div className="text-white text-xl">読み込み中...</div>
      </div>
    );
  }

  if (!player) {
    return notFound();
  }

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8">
        {/* プロフィールヘッダー */}
        <div className="relative mb-8">
          {/* 背景グラデーション */}
          <div className="absolute inset-0 bg-gradient-to-r from-purple-800/30 to-pink-800/30 rounded-2xl blur-xl"></div>
          
          <div className="relative bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-8">
            <div className="flex justify-between items-start mb-6">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent flex items-center gap-3">
                <FaGamepad className="text-purple-400" />
                プレイヤープロフィール
              </h1>
              {isAdmin && !editMode && (
                <button
                  onClick={handleEdit}
                  className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 transition-all transform hover:scale-105 shadow-lg"
                >
                  <FaEdit />
                  編集
                </button>
              )}
              {isAdmin && editMode && (
                <div className="flex gap-3">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl hover:from-green-700 hover:to-emerald-700 transition-all transform hover:scale-105 shadow-lg disabled:opacity-50"
                  >
                    <FaSave />
                    {saving ? '保存中...' : '保存'}
                  </button>
                  <button
                    onClick={handleCancel}
                    className="flex items-center gap-2 px-6 py-3 bg-gray-700 text-white rounded-xl hover:bg-gray-800 transition-all transform hover:scale-105 shadow-lg"
                  >
                    <FaTimes />
                    キャンセル
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-col lg:flex-row items-center gap-8">
              {/* アバター */}
              <div className="relative group">
                <div className="absolute inset-0 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full blur-md opacity-75 group-hover:opacity-100 transition-opacity"></div>
                <img
                  src={player.avatar_url || '/default-avatar.png'}
                  alt={player.handle_name}
                  className="relative w-40 h-40 rounded-full border-4 border-purple-500/50 shadow-2xl"
                />
                {/* レベルバッジ */}
                <div className="absolute -bottom-2 -right-2 bg-gradient-to-r from-yellow-500 to-orange-500 text-white text-sm font-bold px-3 py-1 rounded-full shadow-lg">
                  Lv.{Math.floor(player.ranking_points / 100)}
                </div>
              </div>
              
              {/* プレイヤー情報 */}
              <div className="flex-1 text-center lg:text-left">
                {editMode ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-purple-300 mb-1">ハンドルネーム</label>
                      <input
                        type="text"
                        value={editData.handle_name || ''}
                        onChange={(e) => setEditData({ ...editData, handle_name: e.target.value })}
                        className="w-full px-4 py-2 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white focus:border-purple-400 focus:outline-none"
                      />
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-purple-300 mb-1">氏名（非公開）</label>
                        <input
                          type="text"
                          value={editData.full_name || ''}
                          onChange={(e) => setEditData({ ...editData, full_name: e.target.value })}
                          className="w-full px-4 py-2 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white focus:border-purple-400 focus:outline-none"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-purple-300 mb-1">メール（非公開）</label>
                        <input
                          type="email"
                          value={editData.email || ''}
                          onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                          className="w-full px-4 py-2 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white focus:border-purple-400 focus:outline-none"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-purple-300 mb-1">電話番号（非公開）</label>
                        <input
                          type="tel"
                          value={editData.phone || ''}
                          onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                          className="w-full px-4 py-2 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white focus:border-purple-400 focus:outline-none"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-purple-300 mb-1">住所</label>
                        <input
                          type="text"
                          value={editData.address || ''}
                          onChange={(e) => setEditData({ ...editData, address: e.target.value })}
                          className="w-full px-4 py-2 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white focus:border-purple-400 focus:outline-none"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-purple-300 mb-1">ランキングポイント</label>
                        <input
                          type="number"
                          value={editData.ranking_points || 0}
                          onChange={(e) => setEditData({ ...editData, ranking_points: parseInt(e.target.value) })}
                          className="w-full px-4 py-2 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white focus:border-purple-400 focus:outline-none"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-purple-300 mb-1">ハンディキャップ</label>
                        <input
                          type="number"
                          value={editData.handicap || 0}
                          onChange={(e) => setEditData({ ...editData, handicap: parseInt(e.target.value) })}
                          className="w-full px-4 py-2 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white focus:border-purple-400 focus:outline-none"
                        />
                      </div>
                    </div>
                    
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editData.is_active || false}
                          onChange={(e) => setEditData({ ...editData, is_active: e.target.checked })}
                          className="w-5 h-5 bg-gray-800 border-purple-500 text-purple-600 rounded focus:ring-purple-500"
                        />
                        <span className="text-purple-300">アクティブ</span>
                      </label>
                      
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editData.is_admin || false}
                          onChange={(e) => setEditData({ ...editData, is_admin: e.target.checked })}
                          className="w-5 h-5 bg-gray-800 border-purple-500 text-purple-600 rounded focus:ring-purple-500"
                        />
                        <span className="text-purple-300">管理者</span>
                      </label>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 className="text-4xl font-bold mb-3">{player.handle_name}</h2>
                    
                    <div className="flex flex-wrap gap-4 justify-center lg:justify-start text-gray-300 mb-4">
                      {player.address && (
                        <span className="flex items-center gap-2">
                          <FaMapMarkerAlt className="text-purple-400" />
                          {player.address}
                        </span>
                      )}
                    </div>

                    {/* ステータスバッジ */}
                    <div className="flex flex-wrap gap-3 justify-center lg:justify-start mb-6">
                      {player.is_active ? (
                        <span className="px-4 py-2 bg-green-500/20 border border-green-500/50 text-green-400 rounded-full text-sm font-medium flex items-center gap-2">
                          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                          アクティブ
                        </span>
                      ) : (
                        <span className="px-4 py-2 bg-gray-500/20 border border-gray-500/50 text-gray-400 rounded-full text-sm font-medium">
                          非アクティブ
                        </span>
                      )}
                      {player.is_admin && (
                        <span className="px-4 py-2 bg-purple-500/20 border border-purple-500/50 text-purple-400 rounded-full text-sm font-medium flex items-center gap-2">
                          <FaShieldAlt />
                          管理者
                        </span>
                      )}
                    </div>

                    {/* ランキング情報 */}
                    <div className="flex flex-wrap gap-6 justify-center lg:justify-start">
                      <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 rounded-xl px-6 py-3">
                        <div className="flex items-center gap-2 text-yellow-400">
                          <FaTrophy className="text-2xl" />
                          <div>
                            <div className="text-sm opacity-80">ランキングポイント</div>
                            <div className="text-2xl font-bold">{player.ranking_points.toLocaleString()}pt</div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border border-blue-500/30 rounded-xl px-6 py-3">
                        <div className="flex items-center gap-2 text-blue-400">
                          <FaGamepad className="text-2xl" />
                          <div>
                            <div className="text-sm opacity-80">ハンディキャップ</div>
                            <div className="text-2xl font-bold">{player.handicap}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* 統計情報 */}
              {!editMode && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-gray-800/50 backdrop-blur border border-green-500/30 rounded-xl p-4 text-center transform hover:scale-105 transition-transform">
                    <div className="text-3xl font-bold text-green-400 mb-1">{player.wins}</div>
                    <div className="text-sm text-gray-400">勝利</div>
                  </div>
                  <div className="bg-gray-800/50 backdrop-blur border border-red-500/30 rounded-xl p-4 text-center transform hover:scale-105 transition-transform">
                    <div className="text-3xl font-bold text-red-400 mb-1">{player.losses}</div>
                    <div className="text-sm text-gray-400">敗北</div>
                  </div>
                  <div className="bg-gray-800/50 backdrop-blur border border-blue-500/30 rounded-xl p-4 text-center transform hover:scale-105 transition-transform">
                    <div className="text-3xl font-bold text-blue-400 mb-1">{player.matches_played}</div>
                    <div className="text-sm text-gray-400">試合数</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 詳細統計 */}
        {!editMode && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-6 transform hover:scale-105 transition-all">
                <div className="flex items-center gap-3 mb-4 text-purple-300">
                  <FaChartLine className="text-2xl" />
                  <span className="font-medium">勝率</span>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-purple-400 mb-2">
                    {stats.winRate.toFixed(1)}%
                  </div>
                  <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-1000"
                      style={{ width: `${stats.winRate}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-6 transform hover:scale-105 transition-all">
                <div className="flex items-center gap-3 mb-4 text-green-300">
                  <FaHistory className="text-2xl" />
                  <span className="font-medium">直近5試合</span>
                </div>
                <div className="flex gap-2 justify-center">
                  {stats.recentForm.map((result, index) => (
                    <div
                      key={index}
                      className={`w-12 h-12 flex items-center justify-center rounded-lg font-bold text-lg ${
                        result === 'W' 
                          ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-green-500/30 shadow-lg' 
                          : 'bg-gradient-to-r from-red-500 to-pink-500 text-white shadow-red-500/30 shadow-lg'
                      }`}
                    >
                      {result}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-6 transform hover:scale-105 transition-all">
                <div className="flex items-center gap-3 mb-4 text-yellow-300">
                  <FaTrophy className="text-2xl" />
                  <span className="font-medium">平均ポイント変動</span>
                </div>
                <div className="text-center">
                  <div className={`text-4xl font-bold ${stats.avgPointsChange > 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {stats.avgPointsChange > 0 ? '+' : ''}{stats.avgPointsChange.toFixed(1)}
                  </div>
                  <div className="text-sm text-gray-400 mt-1">ポイント/試合</div>
                </div>
              </div>

              <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-6 transform hover:scale-105 transition-all">
                <div className="flex items-center gap-3 mb-4 text-blue-300">
                  <FaUser className="text-2xl" />
                  <span className="font-medium">登録日</span>
                </div>
                <div className="text-center">
                  <div className="text-lg text-gray-300">
                    {formatDate(player.created_at)}
                  </div>
                  <div className="text-sm text-gray-400 mt-1">
                    {Math.floor((Date.now() - new Date(player.created_at).getTime()) / (1000 * 60 * 60 * 24))}日経過
                  </div>
                </div>
              </div>
            </div>

            {/* 試合履歴 */}
            <div>
              <h2 className="text-3xl font-bold mb-6 flex items-center gap-3">
                <FaHistory className="text-purple-400" />
                試合履歴
              </h2>

              {matches.length === 0 ? (
                <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-12 text-center">
                  <FaGamepad className="text-6xl text-gray-600 mx-auto mb-4" />
                  <p className="text-xl text-gray-400">まだ試合履歴がありません</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {matches.map((match) => {
                    const isWinner = match.winner_id === params.id;
                    const opponent = isWinner 
                      ? { id: match.loser_id, name: match.loser_name, avatar: match.loser_avatar }
                      : { id: match.winner_id, name: match.winner_name, avatar: match.winner_avatar };
                    const playerScore = isWinner ? 15 : match.loser_score;
                    const opponentScore = isWinner ? match.loser_score : 15;
                    const pointsChange = isWinner ? match.winner_points_change : match.loser_points_change;
                    const handicapChange = isWinner ? match.winner_handicap_change : match.loser_handicap_change;

                    return (
                      <div
                        key={match.id}
                        className={`bg-gray-900/60 backdrop-blur-md rounded-xl border ${
                          isWinner ? 'border-green-500/30' : 'border-red-500/30'
                        } p-6 hover:border-purple-400/50 transition-all`}
                      >
                        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                          <div className="flex items-center gap-4">
                            <div className={`text-3xl font-bold ${
                              isWinner 
                                ? 'text-green-400 bg-green-500/20 w-16 h-16 rounded-xl flex items-center justify-center' 
                                : 'text-red-400 bg-red-500/20 w-16 h-16 rounded-xl flex items-center justify-center'
                            }`}>
                              {isWinner ? 'W' : 'L'}
                            </div>
                            
                            <div>
                              <div className="flex items-center gap-3 mb-2">
                                <span className="text-gray-400">vs</span>
                                <img
                                  src={opponent.avatar || '/default-avatar.png'}
                                  alt={opponent.name}
                                  className="w-8 h-8 rounded-full border-2 border-purple-500/30"
                                />
                                <Link
                                  href={`/players/${opponent.id}`}
                                  className="font-medium text-lg hover:text-purple-400 transition-colors"
                                >
                                  {opponent.name}
                                </Link>
                                {match.is_tournament && match.tournament_name && (
                                  <span className="ml-2 px-3 py-1 text-xs rounded-full bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 text-yellow-400 flex items-center gap-1">
                                    <FaMedal />
                                    {match.tournament_name}
                                  </span>
                                )}
                              </div>
                              
                              <div className="text-sm text-gray-400">
                                {formatDate(match.match_date)}
                                {match.venue && ` • ${match.venue}`}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-6">
                            <div className="text-center">
                              <div className="text-2xl font-bold text-white">
                                {playerScore} - {opponentScore}
                              </div>
                              <div className="text-xs text-gray-400 mt-1">スコア</div>
                            </div>
                            
                            <div className="text-center">
                              <div className={`text-2xl font-bold ${
                                pointsChange > 0 ? 'text-green-400' : 'text-red-400'
                              }`}>
                                {pointsChange > 0 ? '+' : ''}{pointsChange}pt
                              </div>
                              {handicapChange !== 0 && (
                                <div className="text-sm text-gray-400">
                                  HC: {handicapChange > 0 ? '+' : ''}{handicapChange}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {match.notes && (
                          <div className="mt-4 p-3 bg-gray-800/50 rounded-lg text-sm text-gray-300 border-l-4 border-purple-500/50">
                            {match.notes}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}