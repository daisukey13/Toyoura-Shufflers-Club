'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { FaUser, FaTrophy, FaGamepad, FaEdit, FaSave, FaTimes, FaChartLine, FaHistory, FaCrown, FaExclamationTriangle } from 'react-icons/fa';

const supabase = createClient();

interface Player {
  id: string;
  handle_name: string;
  full_name: string;
  email: string;
  phone: string;
  address: string;
  avatar_url: string;
  ranking_points: number;
  handicap: number;
  matches_played: number;
  wins: number;
  losses: number;
  created_at: string;
  is_active: boolean;
  is_admin: boolean;
}

interface MatchDetail {
  id: string;
  winner_name: string;
  loser_name: string;
  winner_id: string;
  loser_id: string;
  winner_score: number;
  loser_score: number;
  winner_ranking_change: number;
  loser_ranking_change: number;
  created_at: string;
}

export default function PlayerProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { user, player: currentPlayer } = useAuth();
  const playerId = params.id as string;

  const [player, setPlayer] = useState<Player | null>(null);
  const [matches, setMatches] = useState<MatchDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    full_name: '',
    phone: '',
    address: '',
    avatar_url: ''
  });
  const [avatarOptions, setAvatarOptions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // 自分のプロフィールかどうか
  const isOwnProfile = user?.id === playerId || currentPlayer?.id === playerId;

  useEffect(() => {
    fetchPlayer();
    fetchMatches();
    if (isOwnProfile) {
      fetchAvatarOptions();
    }
  }, [playerId]);

  const fetchPlayer = async () => {
    try {
      const { data, error } = await supabase
        .from('players')
        .select('*')
        .eq('id', playerId)
        .single();

      if (error) throw error;

      setPlayer(data);
      setEditForm({
        full_name: data.full_name,
        phone: data.phone,
        address: data.address,
        avatar_url: data.avatar_url
      });
    } catch (error) {
      console.error('Error fetching player:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMatches = async () => {
    try {
      const { data, error } = await supabase
        .from('match_details')
        .select('*')
        .or(`winner_id.eq.${playerId},loser_id.eq.${playerId}`)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setMatches(data || []);
    } catch (error) {
      console.error('Error fetching matches:', error);
    }
  };

  const fetchAvatarOptions = async () => {
    try {
      const { data, error } = await supabase
        .storage
        .from('avatars')
        .list('preset', {
          limit: 100,
          offset: 0,
        });

      if (!error && data) {
        const urls = data.map(file => {
          const { data: publicData } = supabase
            .storage
            .from('avatars')
            .getPublicUrl(`preset/${file.name}`);
          return publicData.publicUrl;
        });
        setAvatarOptions(urls);
      }
    } catch (error) {
      console.error('Error fetching avatars:', error);
    }
  };

  const handleSave = async () => {
    if (!isOwnProfile) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('players')
        .update({
          full_name: editForm.full_name,
          phone: editForm.phone,
          address: editForm.address,
          avatar_url: editForm.avatar_url
        })
        .eq('id', playerId);

      if (error) throw error;

      await fetchPlayer();
      setIsEditing(false);
      alert('プロフィールを更新しました');
    } catch (error) {
      console.error('Error updating profile:', error);
      alert('更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const getWinRate = () => {
    if (!player || player.matches_played === 0) return 0;
    return Math.round((player.wins / player.matches_played) * 100);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex items-center justify-center">
        <div className="text-white">読み込み中...</div>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex items-center justify-center">
        <div className="text-white">プレーヤーが見つかりません</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#2a2a3e]">
      <div className="container mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-white mb-2 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            プレーヤープロフィール
          </h1>
          {player.is_admin && (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-500/20 border border-yellow-500/30 rounded-full">
              <FaCrown className="text-yellow-400" />
              <span className="text-yellow-400 text-sm font-medium">管理者</span>
            </div>
          )}
        </div>

        {/* プロフィール情報 */}
        <div className="max-w-4xl mx-auto space-y-8">
          {/* 基本情報カード */}
          <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <FaUser className="text-purple-400" />
                基本情報
              </h2>
              {isOwnProfile && !isEditing && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
                >
                  <FaEdit />
                  編集
                </button>
              )}
              {isEditing && (
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    <FaSave />
                    保存
                  </button>
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setEditForm({
                        full_name: player.full_name,
                        phone: player.phone,
                        address: player.address,
                        avatar_url: player.avatar_url
                      });
                    }}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-2"
                  >
                    <FaTimes />
                    キャンセル
                  </button>
                </div>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* 左側：アバターと基本情報 */}
              <div className="space-y-4">
                <div className="flex items-center gap-6">
                  <img
                    src={player.avatar_url || '/default-avatar.png'}
                    alt={player.handle_name}
                    className="w-24 h-24 rounded-full border-4 border-purple-500/30"
                  />
                  <div>
                    <h3 className="text-2xl font-bold text-white">{player.handle_name}</h3>
                    <p className="text-gray-400">登録日: {new Date(player.created_at).toLocaleDateString('ja-JP')}</p>
                  </div>
                </div>

                {isEditing && (
                  <div>
                    <label className="block text-sm font-medium text-purple-300 mb-2">
                      アバター画像を変更
                    </label>
                    <div className="grid grid-cols-6 gap-2 max-h-48 overflow-y-auto">
                      {avatarOptions.map((url, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => setEditForm({ ...editForm, avatar_url: url })}
                          className={`relative p-1 rounded-lg border-2 transition-all ${
                            editForm.avatar_url === url
                              ? 'border-purple-400 bg-purple-500/20'
                              : 'border-purple-500/30 hover:border-purple-400/50'
                          }`}
                        >
                          <img
                            src={url}
                            alt={`Avatar ${index + 1}`}
                            className="w-full h-auto rounded"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 右側：詳細情報 */}
              <div className="space-y-4">
                {isOwnProfile && (
                  <>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">氏名</label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editForm.full_name}
                          onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                          className="w-full px-3 py-2 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white"
                        />
                      ) : (
                        <p className="text-white">{player.full_name}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm text-gray-400 mb-1">電話番号</label>
                      {isEditing ? (
                        <input
                          type="tel"
                          value={editForm.phone}
                          onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                          className="w-full px-3 py-2 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white"
                        />
                      ) : (
                        <p className="text-white">{player.phone}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm text-gray-400 mb-1">メールアドレス</label>
                      <p className="text-white">{player.email}</p>
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-sm text-gray-400 mb-1">お住まいの地域</label>
                  {isEditing && isOwnProfile ? (
                    <select
                      value={editForm.address}
                      onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white"
                    >
                      <option value="豊浦町">豊浦町</option>
                      <option value="洞爺湖町">洞爺湖町</option>
                      <option value="壮瞥町">壮瞥町</option>
                      <option value="伊達市">伊達市</option>
                      <option value="室蘭市">室蘭市</option>
                      <option value="登別市">登別市</option>
                      <option value="倶知安町">倶知安町</option>
                      <option value="ニセコ町">ニセコ町</option>
                      <option value="札幌市">札幌市</option>
                      <option value="その他道内">その他道内</option>
                      <option value="内地">内地</option>
                      <option value="外国（Visitor)">外国（Visitor)</option>
                    </select>
                  ) : (
                    <p className="text-white">{player.address}</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* アクションボタン */}
          {isOwnProfile && (
            <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-6">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2 mb-4">
                <FaGamepad className="text-purple-400" />
                アクション
              </h2>
              <div className="flex flex-wrap gap-4">
                <Link
                  href="/matches/register"
                  className="px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg hover:from-green-700 hover:to-emerald-700 transition-all transform hover:scale-105 shadow-lg font-medium flex items-center gap-2"
                >
                  <FaTrophy />
                  試合を報告する
                </Link>
                <Link
                  href="/rankings"
                  className="px-6 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-lg hover:from-blue-700 hover:to-cyan-700 transition-all transform hover:scale-105 shadow-lg font-medium flex items-center gap-2"
                >
                  <FaChartLine />
                  ランキングを見る
                </Link>
              </div>
            </div>
          )}

          {/* 統計情報 */}
          <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-6">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2 mb-6">
              <FaChartLine className="text-purple-400" />
              統計情報
            </h2>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-yellow-400">{player.ranking_points}</div>
                <div className="text-sm text-gray-400">ランキングポイント</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-purple-400">{player.handicap}</div>
                <div className="text-sm text-gray-400">ハンディキャップ</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-400">{player.matches_played}</div>
                <div className="text-sm text-gray-400">試合数</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-400">{getWinRate()}%</div>
                <div className="text-sm text-gray-400">勝率</div>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-700">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-400">{player.wins}</div>
                  <div className="text-sm text-gray-400">勝利</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-400">{player.losses}</div>
                  <div className="text-sm text-gray-400">敗北</div>
                </div>
              </div>
            </div>
          </div>

          {/* 最近の試合結果 */}
          <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-6">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2 mb-6">
              <FaHistory className="text-purple-400" />
              最近の試合結果
            </h2>

            {matches.length === 0 ? (
              <p className="text-gray-400 text-center py-8">まだ試合結果がありません</p>
            ) : (
              <div className="space-y-3">
                {matches.map((match) => {
                  const isWinner = match.winner_id === playerId;
                  const opponentName = isWinner ? match.loser_name : match.winner_name;
                  const score = isWinner 
                    ? `${match.winner_score} - ${match.loser_score}`
                    : `${match.loser_score} - ${match.winner_score}`;
                  const pointChange = isWinner 
                    ? match.winner_ranking_change 
                    : match.loser_ranking_change;

                  return (
                    <div
                      key={match.id}
                      className={`p-4 rounded-lg border ${
                        isWinner 
                          ? 'bg-green-900/20 border-green-500/30' 
                          : 'bg-red-900/20 border-red-500/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`text-lg font-bold ${
                            isWinner ? 'text-green-400' : 'text-red-400'
                          }`}>
                            {isWinner ? '勝利' : '敗北'}
                          </div>
                          <div className="text-white">
                            vs {opponentName}
                          </div>
                          <div className="text-gray-400">
                            {score}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className={`text-sm font-medium ${
                            pointChange > 0 ? 'text-green-400' : 'text-red-400'
                          }`}>
                            {pointChange > 0 ? '+' : ''}{pointChange}pt
                          </div>
                          <div className="text-sm text-gray-400">
                            {new Date(match.created_at).toLocaleDateString('ja-JP')}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}