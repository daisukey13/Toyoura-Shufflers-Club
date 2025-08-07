'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { FaUser, FaEnvelope, FaTrophy, FaShieldAlt, FaToggleOn, FaToggleOff, FaSave, FaArrowLeft, FaTrash, FaExclamationTriangle, FaUndo } from 'react-icons/fa';
import Link from 'next/link';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

interface Player {
  id: string;
  email: string;
  handle_name: string;
  handicap: number;
  rating: number;
  avatar_url: string | null;
  is_admin: boolean;
  is_active: boolean;
  is_deleted: boolean;
  deleted_at: string | null;
  deletion_note: string | null;
}

interface DeletedPlayerData {
  restoration_token: string;
  scheduled_purge_at: string;
}

export default function EditPlayerPage({ params }: { params: { id: string } }) {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const [player, setPlayer] = useState<Player | null>(null);
  const [deletedData, setDeletedData] = useState<DeletedPlayerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    handle_name: '',
    email: '',
    handicap: 0,
    rating: 1500,
    is_admin: false,
    is_active: true,
  });
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletionNote, setDeletionNote] = useState('');
  const [showRestoreModal, setShowRestoreModal] = useState(false);

  useEffect(() => {
    if (!isAdmin) {
      router.push('/');
      return;
    }
    fetchPlayer();
  }, [isAdmin, params.id]);

  const fetchPlayer = async () => {
    try {
      // プレーヤー情報を取得
      const playerResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/players?id=eq.${params.id}&select=*`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          }
        }
      );

      if (!playerResponse.ok) {
        throw new Error('Failed to fetch player');
      }

      const playerData = await playerResponse.json();
      if (!playerData || playerData.length === 0) {
        throw new Error('Player not found');
      }

      const playerInfo = playerData[0];
      setPlayer(playerInfo);
      setFormData({
        handle_name: playerInfo.handle_name,
        email: playerInfo.email,
        handicap: playerInfo.handicap,
        rating: playerInfo.rating || 1500,
        is_admin: playerInfo.is_admin,
        is_active: playerInfo.is_active,
      });

      // 退会済みの場合、復元情報を取得
      if (playerInfo.is_deleted) {
        const deletedResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/deleted_player_data?player_id=eq.${params.id}&select=restoration_token,scheduled_purge_at`,
          {
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            }
          }
        );

        if (deletedResponse.ok) {
          const deletedDataArray = await deletedResponse.json();
          if (deletedDataArray.length > 0) {
            setDeletedData(deletedDataArray[0]);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching player:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/players?id=eq.${params.id}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(formData)
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update player');
      }

      alert('プレイヤー情報を更新しました');
      router.push('/players');
    } catch (error) {
      console.error('Error updating player:', error);
      alert('更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      // RPC関数を呼び出す
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/soft_delete_player`,
        {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            p_player_id: params.id,
            p_deletion_note: deletionNote || null
          })
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete player');
      }

      alert('プレーヤーを退会処理しました');
      router.push('/players');
    } catch (error) {
      console.error('Error deleting player:', error);
      alert('退会処理に失敗しました');
    } finally {
      setSaving(false);
      setShowDeleteModal(false);
    }
  };

  const handleRestore = async () => {
    if (!deletedData?.restoration_token) return;
    
    setSaving(true);
    try {
      // RPC関数を呼び出す
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/restore_deleted_player`,
        {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            p_restoration_token: deletedData.restoration_token
          })
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to restore player');
      }

      alert('プレーヤーを復活しました');
      router.push('/players');
    } catch (error) {
      console.error('Error restoring player:', error);
      alert('復活処理に失敗しました');
    } finally {
      setSaving(false);
      setShowRestoreModal(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400 mx-auto mb-4"></div>
          <div className="text-white text-xl">読み込み中...</div>
        </div>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center">
        <div className="text-white text-xl">プレーヤーが見つかりません</div>
      </div>
    );
  }

  const purgeDate = deletedData?.scheduled_purge_at 
    ? new Date(deletedData.scheduled_purge_at).toLocaleDateString('ja-JP')
    : null;

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white p-4 sm:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/players"
            className="p-2 hover:bg-purple-600/20 rounded-lg transition-colors"
          >
            <FaArrowLeft className="text-xl" />
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold">プレーヤー編集</h1>
        </div>

        {player.is_deleted && (
          <div className="bg-red-900/30 border border-red-600/50 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3">
              <FaExclamationTriangle className="text-red-400 text-xl flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-red-200 font-bold">このプレーヤーは退会済みです</p>
                <p className="text-red-300 text-sm">
                  {purgeDate && `${purgeDate} に完全削除予定`}
                </p>
                {player.deletion_note && (
                  <p className="text-gray-400 text-sm mt-2">
                    メモ: {player.deletion_note}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => setShowRestoreModal(true)}
              className="mt-4 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg transition-colors flex items-center gap-2"
            >
              <FaUndo />
              復活する
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">
              <FaUser className="inline mr-2" />
              ハンドルネーム
            </label>
            <input
              type="text"
              value={formData.handle_name}
              onChange={(e) => setFormData({ ...formData, handle_name: e.target.value })}
              className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
              required
              disabled={player.is_deleted}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              <FaEnvelope className="inline mr-2" />
              メールアドレス
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
              required
              disabled={player.is_deleted}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                ハンディキャップ
              </label>
              <input
                type="number"
                value={formData.handicap}
                onChange={(e) => setFormData({ ...formData, handicap: parseInt(e.target.value) })}
                className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
                min="0"
                max="15"
                disabled={player.is_deleted}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                <FaTrophy className="inline mr-2" />
                レーティング
              </label>
              <input
                type="number"
                value={formData.rating}
                onChange={(e) => setFormData({ ...formData, rating: parseInt(e.target.value) })}
                className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
                disabled={player.is_deleted}
              />
            </div>
          </div>

          <div className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_admin}
                onChange={(e) => setFormData({ ...formData, is_admin: e.target.checked })}
                className="w-5 h-5"
                disabled={player.is_deleted}
              />
              <FaShieldAlt className="text-purple-400" />
              <span>管理者権限</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="w-5 h-5"
                disabled={player.is_deleted}
              />
              {formData.is_active ? (
                <FaToggleOn className="text-green-400 text-xl" />
              ) : (
                <FaToggleOff className="text-gray-400 text-xl" />
              )}
              <span>アクティブ状態</span>
            </label>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <button
              type="submit"
              disabled={saving || player.is_deleted}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all transform hover:scale-105 disabled:opacity-50 disabled:transform-none flex items-center justify-center gap-2"
            >
              <FaSave />
              {saving ? '保存中...' : '変更を保存'}
            </button>

            {!player.is_deleted && (
              <button
                type="button"
                onClick={() => setShowDeleteModal(true)}
                className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-all flex items-center justify-center gap-2"
              >
                <FaTrash />
                退会処理
              </button>
            )}
          </div>
        </form>
      </div>

      {/* 退会確認モーダル */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold mb-4 text-red-400">退会処理の確認</h2>
            <p className="text-gray-300 mb-6">
              {player.handle_name} を退会処理しますか？<br />
              <span className="text-sm text-gray-400">
                ・30日以内であれば復活可能です<br />
                ・個人情報は匿名化され、30日後に完全削除されます<br />
                ・試合記録は個人情報なしで保持されます
              </span>
            </p>
            
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">
                管理者用メモ（任意）
              </label>
              <textarea
                value={deletionNote}
                onChange={(e) => setDeletionNote(e.target.value)}
                className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
                rows={3}
                placeholder="退会理由など..."
              />
            </div>

            <div className="flex gap-4">
              <button
                onClick={handleDelete}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                退会処理する
              </button>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 復活確認モーダル */}
      {showRestoreModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold mb-4 text-green-400">プレーヤーの復活</h2>
            <p className="text-gray-300 mb-6">
              {player.handle_name} を復活させますか？<br />
              <span className="text-sm text-gray-400">
                個人情報が復元され、通常通り利用可能になります。
              </span>
            </p>
            <div className="flex gap-4">
              <button
                onClick={handleRestore}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
              >
                復活する
              </button>
              <button
                onClick={() => setShowRestoreModal(false)}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}