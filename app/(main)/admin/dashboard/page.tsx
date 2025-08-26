// app/(main)/admin/dashboard/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FaCog, FaUsers, FaTrophy, FaSignOutAlt, FaChartLine, FaShieldAlt, FaGamepad, FaFire, FaBolt
} from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

type RankingConfig = {
  k_factor: number;
  score_diff_multiplier: number;
  handicap_diff_multiplier: number;
  win_threshold_handicap_change: number;
  handicap_change_amount: number;
};

export default function AdminDashboard() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // 認可フラグ: 'checking' | 'ok' | 'no'
  const [authz, setAuthz] = useState<'checking' | 'ok' | 'no'>('checking');
  const [userId, setUserId] = useState<string | null>(null);

  // UI
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

  /** サーバ側Cookieベースでログインかを確認 → その後に管理者判定（RLSに従う） */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 1) サーバCookie基準でログイン済みか（/login 循環対策）
        const r = await fetch('/auth/whoami', { cache: 'no-store' });
        const j = r.ok ? await r.json() : { authenticated: false };
        if (!j?.authenticated) {
          router.replace('/login?redirect=/admin/dashboard');
          return;
        }

        // 2) クライアント側のユーザーも取得
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.replace('/login?redirect=/admin/dashboard');
          return;
        }
        if (cancelled) return;
        setUserId(user.id);

        // 3) 管理者判定（どちらかが真ならOK）
        let isAdmin = false;

        const [{ data: adminRow }, { data: playerRow }] = await Promise.all([
          supabase.from('app_admins').select('user_id').eq('user_id', user.id).maybeSingle(),
          supabase.from('players').select('is_admin').eq('id', user.id).maybeSingle(),
        ]);

        if (adminRow?.user_id) isAdmin = true;
        if (playerRow?.is_admin === true) isAdmin = true;

        if (!isAdmin) {
          setAuthz('no');
          return;
        }

        setAuthz('ok');
        // 初回統計取得
        void fetchStats();
        // 設定ロード
        void loadConfig();
      } catch {
        setAuthz('no');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, router]);

  /** 統計情報の取得（RLS: 参照可能な範囲で集計） */
  const fetchStats = async () => {
    try {
      const [{ data: players }, { data: matches }] = await Promise.all([
        supabase.from('players').select('id,is_active'),
        supabase.from('matches').select('id,created_at'),
      ]);

      const todayISO = new Date().toISOString().split('T')[0];

      const totalPlayers = players?.length ?? 0;
      const activePlayers = (players ?? []).filter((p) => (p as any).is_active).length;
      const totalMatches = matches?.length ?? 0;
      const todayMatches =
        (matches ?? []).filter((m) =>
          typeof (m as any).created_at === 'string'
            ? (m as any).created_at.startsWith(todayISO)
            : false
        ).length;

      setStats({ totalPlayers, activePlayers, totalMatches, todayMatches });
    } catch (error) {
      console.error('[admin/dashboard] fetchStats error:', error);
    }
  };

  /** 設定ロード（暫定: localStorage） */
  const loadConfig = () => {
    try {
      const raw = localStorage.getItem('rankingConfig');
      if (!raw) return;
      const parsed = JSON.parse(raw) as RankingConfig;
      setConfig((prev) => ({ ...prev, ...parsed }));
    } catch (e) {
      console.warn('[admin/dashboard] loadConfig parse error:', e);
    }
  };

  /** 設定保存（将来は Supabase へ） */
  const saveConfig = () => {
    try {
      setSaving(true);
      localStorage.setItem('rankingConfig', JSON.stringify(config));
      setTimeout(() => {
        setSaving(false);
        alert('設定を保存しました');
      }, 250);
    } catch (e) {
      setSaving(false);
      alert('設定の保存に失敗しました');
      console.error('[admin/dashboard] saveConfig error:', e);
    }
  };

  /** サインアウト（サーバCookieも同期） */
  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      try {
        await fetch('/auth/callback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event: 'SIGNED_OUT', session: null }),
        });
      } catch {}
    } finally {
      router.replace('/');
    }
  };

  /** 表示用の安全な幅計算（NaN/Infinity 回避） */
  const percent = (num: number, den: number) => {
    if (!den || den <= 0) return 0;
    const v = (num / den) * 100;
    return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
  };

  // 認証中表示
  if (authz === 'checking') {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center">
        <div className="text-white text-xl">認証を確認しています...</div>
      </div>
    );
  }

  // 権限なしフォールバック
  if (authz === 'no') {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center">
        <div className="text-white text-xl">アクセス権限がありません</div>
      </div>
    );
  }

  // --- 管理者のみ表示 ---
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
                  <div className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full" style={{ width: '100%' }} />
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
                    style={{ width: `${percent(stats.activePlayers, stats.totalPlayers)}%` }}
                  />
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
                  <div className="h-full bg-gradient-to-r from-yellow-500 to-yellow-400 rounded-full" style={{ width: '100%' }} />
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
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-purple-400 rounded-full animate-pulse"
                    style={{ width: `${percent(stats.todayMatches, 10)}%` }}
                  />
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
                <p className="text-gray-400">プレイヤーの情報を編集・管理できます</p>
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
                <p className="text-gray-400">試合結果の編集・削除を行えます</p>
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
                  <label className="block text-lg font-medium text-purple-300 mb-2">K係数（ELOレーティング）</label>
                  <p className="text-sm text-gray-400 mb-4">レーティング変動の大きさ。通常は16〜64。</p>
                  <div className="flex items-center gap-6">
                    <input
                      type="range"
                      min={16}
                      max={64}
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
                  <label className="block text-lg font-medium text-purple-300 mb-2">スコア差倍率</label>
                  <p className="text-sm text-gray-400 mb-4">0.01〜0.1 推奨。</p>
                  <div className="flex items-center gap-6">
                    <input
                      type="range"
                      min={0.01}
                      max={0.1}
                      step={0.01}
                      value={config.score_diff_multiplier}
                      onChange={(e) => setConfig({ ...config, score_diff_multiplier: parseFloat(e.target.value) })}
                      className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="w-20 text-center">
                      <span className="text-2xl font-bold text-purple-400">{config.score_diff_multiplier}</span>
                    </div>
                  </div>
                </div>

                {/* ハンディ差倍率 */}
                <div className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20">
                  <label className="block text-lg font-medium text-purple-300 mb-2">ハンディキャップ差倍率</label>
                  <p className="text-sm text-gray-400 mb-4">0.01〜0.05 推奨。</p>
                  <div className="flex items-center gap-6">
                    <input
                      type="range"
                      min={0.01}
                      max={0.05}
                      step={0.01}
                      value={config.handicap_diff_multiplier}
                      onChange={(e) => setConfig({ ...config, handicap_diff_multiplier: parseFloat(e.target.value) })}
                      className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="w-20 text-center">
                      <span className="text-2xl font-bold text-purple-400">{config.handicap_diff_multiplier}</span>
                    </div>
                  </div>
                </div>

                {/* ハンディ変更閾値 */}
                <div className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20">
                  <label className="block text-lg font-medium text-purple-300 mb-2">ハンディキャップ変更閾値（点差）</label>
                  <p className="text-sm text-gray-400 mb-4">この点差以上で勝利した場合にハンディを調整。</p>
                  <div className="flex items-center gap-6">
                    <input
                      type="range"
                      min={5}
                      max={15}
                      value={config.win_threshold_handicap_change}
                      onChange={(e) =>
                        setConfig({ ...config, win_threshold_handicap_change: parseInt(e.target.value) })
                      }
                      className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="w-20 text-center">
                      <span className="text-2xl font-bold text-purple-400">{config.win_threshold_handicap_change}点</span>
                    </div>
                  </div>
                </div>

                {/* ハンディ変更量 */}
                <div className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20">
                  <label className="block text-lg font-medium text-purple-300 mb-2">ハンディキャップ変更量</label>
                  <p className="text-sm text-gray-400 mb-4">閾値を超えた場合の変更量。</p>
                  <div className="flex items-center gap-6">
                    <input
                      type="range"
                      min={1}
                      max={5}
                      value={config.handicap_change_amount}
                      onChange={(e) =>
                        setConfig({ ...config, handicap_change_amount: parseInt(e.target.value) })
                      }
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
