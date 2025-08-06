// app/(main)/admin/dashboard/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { FaCog, FaUsers, FaTrophy, FaSignOutAlt, FaChartLine, FaShieldAlt, FaGamepad, FaFire, FaBolt } from 'react-icons/fa';
import Link from 'next/link';

const supabase = createClient();

interface RankingConfig {
  k_factor: number;
  score_diff_multiplier: number;
  handicap_diff_multiplier: number;
  win_threshold_handicap_change: number;
  handicap_change_amount: number;
}

export default function AdminDashboard() {
  const { isAdmin, signOut, loading: authLoading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'overview' | 'settings'>('overview');
  const [stats, setStats] = useState({
    totalPlayers: 0,
    activePlayers: 0,
    totalMatches: 0,
    todayMatches: 0,
  });
  const [config, setConfig] = useState<RankingConfig>({
    k_factor: 32,
    score_diff_multiplier: 0.05,
    handicap_diff_multiplier: 0.02,
    win_threshold_handicap_change: 10,
    handicap_change_amount: 1,
  });
  const [saving, setSaving] = useState(false);

  // デバッグ用のログを追加
  useEffect(() => {
    console.log('AdminDashboard - authLoading:', authLoading);
    console.log('AdminDashboard - isAdmin:', isAdmin);
  }, [authLoading, isAdmin]);

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      console.log('非管理者のためリダイレクト中...');
      router.push('/');  // /loginではなくトップページへ
    }
  }, [isAdmin, authLoading, router]);

  useEffect(() => {
    if (isAdmin) {
      fetchStats();
      loadConfig();
    }
  }, [isAdmin]);

  const fetchStats = async () => {
    try {
      const [playersResult, matchesResult] = await Promise.all([
        supabase.from('players').select('id, is_active'),
        supabase.from('matches').select('id, created_at'),
      ]);

      if (playersResult.data && matchesResult.data) {
        const today = new Date().toISOString().split('T')[0];
        const todayMatchCount = matchesResult.data.filter(
          m => m.created_at.startsWith(today)
        ).length;

        setStats({
          totalPlayers: playersResult.data.length,
          activePlayers: playersResult.data.filter(p => p.is_active).length,
          totalMatches: matchesResult.data.length,
          todayMatches: todayMatchCount,
        });
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const loadConfig = () => {
    // 設定をローカルストレージから読み込み（本来はデータベースから）
    const savedConfig = localStorage.getItem('rankingConfig');
    if (savedConfig) {
      setConfig(JSON.parse(savedConfig));
    }
  };

  const saveConfig = () => {
    setSaving(true);
    // 設定をローカルストレージに保存（本来はデータベースに）
    localStorage.setItem('rankingConfig', JSON.stringify(config));
    setTimeout(() => {
      setSaving(false);
      alert('設定を保存しました');
    }, 500);
  };

  const handleLogout = async () => {
    await signOut();
    // signOutの中でrouter.push('/')が実行されるので、追加のリダイレクトは不要
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center">
        <div className="text-white text-xl">読み込み中...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center">
        <div className="text-white text-xl">アクセス権限がありません</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full">
              <FaShieldAlt className="text-2xl" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              管理者ダッシュボード
            </h1>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-red-600 to-pink-600 text-white rounded-xl hover:from-red-700 hover:to-pink-700 transition-all transform hover:scale-105 shadow-lg"
          >
            <FaSignOutAlt />
            ログアウト
          </button>
        </div>

        {/* タブ */}
        <div className="flex gap-4 mb-8 border-b border-purple-500/30">
          <button
            onClick={() => setActiveTab('overview')}
            className={`pb-3 px-6 flex items-center gap-2 transition-all ${
              activeTab === 'overview'
                ? 'border-b-2 border-purple-400 text-purple-400'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <FaChartLine />
            概要
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`pb-3 px-6 flex items-center gap-2 transition-all ${
              activeTab === 'settings'
                ? 'border-b-2 border-purple-400 text-purple-400'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <FaCog />
            ランキング設定
          </button>
        </div>

        {activeTab === 'overview' && (
          <div>
            {/* 統計カード */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-6 transform hover:scale-105 transition-all">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 bg-blue-500/20 rounded-lg">
                    <FaUsers className="text-3xl text-blue-400" />
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-400">総プレイヤー数</p>
                    <p className="text-3xl font-bold text-blue-400">{stats.totalPlayers}</p>
                  </div>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full" style={{ width: '100%' }}></div>
                </div>
              </div>

              <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-6 transform hover:scale-105 transition-all">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 bg-green-500/20 rounded-lg">
                    <FaFire className="text-3xl text-green-400" />
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-400">アクティブ</p>
                    <p className="text-3xl font-bold text-green-400">{stats.activePlayers}</p>
                  </div>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full" 
                    style={{ width: `${(stats.activePlayers / stats.totalPlayers) * 100}%` }}
                  ></div>
                </div>
              </div>

              <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-6 transform hover:scale-105 transition-all">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 bg-yellow-500/20 rounded-lg">
                    <FaTrophy className="text-3xl text-yellow-400" />
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-400">総試合数</p>
                    <p className="text-3xl font-bold text-yellow-400">{stats.totalMatches}</p>
                  </div>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-yellow-500 to-yellow-400 rounded-full" style={{ width: '100%' }}></div>
                </div>
              </div>

              <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-6 transform hover:scale-105 transition-all">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 bg-purple-500/20 rounded-lg">
                    <FaBolt className="text-3xl text-purple-400" />
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-400">本日の試合</p>
                    <p className="text-3xl font-bold text-purple-400">{stats.todayMatches}</p>
                  </div>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-purple-500 to-purple-400 rounded-full animate-pulse" style={{ width: `${Math.min((stats.todayMatches / 10) * 100, 100)}%` }}></div>
                </div>
              </div>
            </div>

            {/* 管理リンク */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Link
                href="/players"
                className="group bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-8 hover:border-purple-400/50 transition-all transform hover:scale-105"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-4 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl group-hover:shadow-lg group-hover:shadow-blue-500/30 transition-all">
                    <FaUsers className="text-3xl text-white" />
                  </div>
                  <h3 className="text-2xl font-bold">プレイヤー管理</h3>
                </div>
                <p className="text-gray-400">
                  プレイヤーの情報を編集・管理できます
                </p>
              </Link>

              <Link
                href="/matches"
                className="group bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-8 hover:border-purple-400/50 transition-all transform hover:scale-105"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-4 bg-gradient-to-r from-yellow-600 to-orange-600 rounded-xl group-hover:shadow-lg group-hover:shadow-yellow-500/30 transition-all">
                    <FaGamepad className="text-3xl text-white" />
                  </div>
                  <h3 className="text-2xl font-bold">試合管理</h3>
                </div>
                <p className="text-gray-400">
                  試合結果の編集・削除を行えます
                </p>
              </Link>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-4xl mx-auto">
            <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-8">
              <h2 className="text-3xl font-bold mb-8 flex items-center gap-3">
                <FaCog className="text-purple-400" />
                ランキング計算設定
              </h2>
              
              <div className="space-y-8">
                {/* K係数 */}
                <div className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20">
                  <label className="block text-lg font-medium text-purple-300 mb-2">
                    K係数（ELOレーティング）
                  </label>
                  <p className="text-sm text-gray-400 mb-4">
                    レーティング変動の大きさを決定します。大きいほど1試合での変動が大きくなります。
                    通常は16〜64の範囲で設定します。
                  </p>
                  <div className="flex items-center gap-6">
                    <input
                      type="range"
                      min="16"
                      max="64"
                      value={config.k_factor}
                      onChange={(e) => setConfig({ ...config, k_factor: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="w-20 text-center">
                      <span className="text-2xl font-bold text-purple-400">{config.k_factor}</span>
                    </div>
                  </div>
                </div>

                {/* スコア差倍率 */}
                <div className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20">
                  <label className="block text-lg font-medium text-purple-300 mb-2">
                    スコア差倍率
                  </label>
                  <p className="text-sm text-gray-400 mb-4">
                    試合のスコア差（15-0と15-14など）によるポイント変動への影響度。
                    0.01〜0.1の範囲が推奨されます。
                  </p>
                  <div className="flex items-center gap-6">
                    <input
                      type="range"
                      min="0.01"
                      max="0.1"
                      step="0.01"
                      value={config.score_diff_multiplier}
                      onChange={(e) => setConfig({ ...config, score_diff_multiplier: parseFloat(e.target.value) })}
                      className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="w-20 text-center">
                      <span className="text-2xl font-bold text-purple-400">{config.score_diff_multiplier}</span>
                    </div>
                  </div>
                </div>

                {/* ハンディキャップ差倍率 */}
                <div className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20">
                  <label className="block text-lg font-medium text-purple-300 mb-2">
                    ハンディキャップ差倍率
                  </label>
                  <p className="text-sm text-gray-400 mb-4">
                    プレイヤー間のハンディキャップ差によるポイント変動への影響度。
                    ハンディキャップが高い方が勝った場合、より多くのポイントを獲得します。
                  </p>
                  <div className="flex items-center gap-6">
                    <input
                      type="range"
                      min="0.01"
                      max="0.05"
                      step="0.01"
                      value={config.handicap_diff_multiplier}
                      onChange={(e) => setConfig({ ...config, handicap_diff_multiplier: parseFloat(e.target.value) })}
                      className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="w-20 text-center">
                      <span className="text-2xl font-bold text-purple-400">{config.handicap_diff_multiplier}</span>
                    </div>
                  </div>
                </div>

                {/* ハンディキャップ変更閾値 */}
                <div className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20">
                  <label className="block text-lg font-medium text-purple-300 mb-2">
                    ハンディキャップ変更閾値（点差）
                  </label>
                  <p className="text-sm text-gray-400 mb-4">
                    この点差以上で勝利した場合、勝者のハンディキャップが減少し、
                    敗者のハンディキャップが増加します。
                  </p>
                  <div className="flex items-center gap-6">
                    <input
                      type="range"
                      min="5"
                      max="15"
                      value={config.win_threshold_handicap_change}
                      onChange={(e) => setConfig({ ...config, win_threshold_handicap_change: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="w-20 text-center">
                      <span className="text-2xl font-bold text-purple-400">{config.win_threshold_handicap_change}点</span>
                    </div>
                  </div>
                </div>

                {/* ハンディキャップ変更量 */}
                <div className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20">
                  <label className="block text-lg font-medium text-purple-300 mb-2">
                    ハンディキャップ変更量
                  </label>
                  <p className="text-sm text-gray-400 mb-4">
                    閾値を超えた場合のハンディキャップ変更量です。
                  </p>
                  <div className="flex items-center gap-6">
                    <input
                      type="range"
                      min="1"
                      max="5"
                      value={config.handicap_change_amount}
                      onChange={(e) => setConfig({ ...config, handicap_change_amount: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="w-20 text-center">
                      <span className="text-2xl font-bold text-purple-400">{config.handicap_change_amount}</span>
                    </div>
                  </div>
                </div>

                {/* 保存ボタン */}
                <div className="flex justify-end pt-4">
                  <button
                    onClick={saveConfig}
                    disabled={saving}
                    className="px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 transition-all transform hover:scale-105 shadow-lg disabled:opacity-50 disabled:transform-none flex items-center gap-2 font-medium"
                  >
                    {saving ? '保存中...' : '設定を保存'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 20px;
          height: 20px;
          background: linear-gradient(135deg, #a855f7, #ec4899);
          cursor: pointer;
          border-radius: 50%;
          box-shadow: 0 0 10px rgba(168, 85, 247, 0.5);
        }

        .slider::-moz-range-thumb {
          width: 20px;
          height: 20px;
          background: linear-gradient(135deg, #a855f7, #ec4899);
          cursor: pointer;
          border-radius: 50%;
          box-shadow: 0 0 10px rgba(168, 85, 247, 0.5);
          border: none;
        }
      `}</style>
    </div>
  );
}