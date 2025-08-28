// app/(main)/admin/dashboard/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FaCog,
  FaUsers,
  FaTrophy,
  FaSignOutAlt,
  FaChartLine,
  FaShieldAlt,
  FaGamepad,
  FaFire,
  FaBolt,
  FaBullhorn,
  FaPlus,
  FaEdit,
  FaEye,
  FaEyeSlash,
} from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

type RankingConfig = {
  k_factor: number;
  score_diff_multiplier: number;
  handicap_diff_multiplier: number;
  win_threshold_handicap_change: number;
  handicap_change_amount: number;
};

type Notice = {
  id: string;
  title: string;
  content: string;
  date: string; // YYYY-MM-DD
  is_published: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

export default function AdminDashboard() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // 認可フラグ
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

  // お知らせ
  const [notices, setNotices] = useState<Notice[]>([]);
  const [nLoading, setNLoading] = useState(true);

  /** サーバ側Cookieベースでログインかを確認 → その後に管理者判定 */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/auth/whoami', { cache: 'no-store' });
        const j = r.ok ? await r.json() : { authenticated: false };
        if (!j?.authenticated) {
          router.replace('/login?redirect=/admin/dashboard');
          return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.replace('/login?redirect=/admin/dashboard');
          return;
        }
        if (cancelled) return;
        setUserId(user.id);

        let isAdmin = false;
        const [{ data: adminRow }, { data: playerRow }] = await Promise.all([
          supabase.from('app_admins').select('user_id').eq('user_id', user.id).maybeSingle(),
          supabase.from('players').select('is_admin').eq('id', user.id).maybeSingle(),
        ]);
        if (adminRow && adminRow.user_id) isAdmin = true;
if (playerRow && playerRow.is_admin === true) isAdmin = true;
        if (!isAdmin) {
          setAuthz('no');
          return;
        }

        setAuthz('ok');
        void fetchStats();
        void loadConfig();
        void fetchNotices();
      } catch {
        setAuthz('no');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, router]);

  /** 統計情報 */
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

  /** お知らせ取得（最新3件、公開/非公開問わず） */
    const fetchNotices = async () => {
    setNLoading(true);
    try {
      const { data, error } = await supabase
        .from('notices')
        .select('*')
        // 🚫 nullslast を使わず、単純に2キー降順
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(3);
      if (error) throw error;
      setNotices((data ?? []) as Notice[]);
    } catch (e) {
      console.error('[admin/dashboard] notices fetch error:', e);
    } finally {
      setNLoading(false);
    }
  };


  /** 公開トグル */
  const togglePublish = async (target: Notice) => {
    const next = !target.is_published;
    setNotices((prev) => prev.map((n) => (n.id === target.id ? { ...n, is_published: next } : n)));
    try {
     const { error } = await (supabase.from('notices') as any)
  .update({ is_published: next } as any)
  .eq('id', target.id);

      if (error) throw error;
    } catch (e) {
      console.error('[admin/dashboard] toggle publish error:', e);
      setNotices((prev) => prev.map((n) => (n.id === target.id ? { ...n, is_published: !next } : n)));
      alert('公開状態の更新に失敗しました。RLS の許可設定をご確認ください。');
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

  /** 安全なパーセンテージ */
  const percent = (num: number, den: number) => {
    if (!den || den <= 0) return 0;
    const v = (num / den) * 100;
    return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
  };

  // 認証中
  if (authz === 'checking') {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">
        認証を確認しています...
      </div>
    );
  }

  // 権限なし
  if (authz === 'no') {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">
        アクセス権限がありません
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
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

              <Link
                href="/admin/notices"
                className="group bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-8 hover:border-purple-400/50 transition-all transform hover:scale-105"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-4 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl group-hover:shadow-lg group-hover:shadow-pink-500/30 transition-all">
                    <FaBullhorn className="text-3xl text-white" />
                  </div>
                  <h3 className="text-2xl font-bold">お知らせ管理</h3>
                </div>
                <p className="text-gray-400">お知らせの作成・公開設定・編集・削除</p>
              </Link>
            </div>

            {/* 最新のお知らせ（管理ウィジェット） */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold flex items-center gap-3">
                  <FaBullhorn className="text-yellow-300" />
                  最新のお知らせ
                </h2>
                <div className="flex gap-2">
                  <Link
                    href="/admin/notices/new"
                    className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg hover:from-purple-700 hover:to-pink-700 transition-colors flex items-center gap-2"
                  >
                    <FaPlus /> 新規作成
                  </Link>
                  <Link
                    href="/admin/notices"
                    className="px-4 py-2 border border-purple-500/40 rounded-lg hover:bg-purple-900/20 transition-colors"
                  >
                    一覧へ
                  </Link>
                </div>
              </div>

              {nLoading ? (
                <div className="text-gray-400">読み込み中...</div>
              ) : notices.length === 0 ? (
                <div className="text-gray-400">お知らせはまだありません。</div>
              ) : (
                <div className="space-y-3">
                  {notices.map((n) => (
                    <div
                      key={n.id}
                      className="flex items-start justify-between gap-4 p-4 rounded-xl border border-purple-500/20 bg-gray-900/40"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="text-lg font-semibold text-yellow-100 break-all">
                            {n.title || '無題'}
                          </h3>
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs ${
                              n.is_published ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-300'
                            }`}
                          >
                            {n.is_published ? '公開中' : '非公開'}
                          </span>
                          <span className="text-sm text-gray-400">
                            {n.date
                              ? new Date(n.date).toLocaleDateString('ja-JP', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                })
                              : ''}
                          </span>
                        </div>
                        <p
                          className="text-gray-300 mt-1 overflow-hidden text-ellipsis"
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            whiteSpace: 'normal',
                          }}
                          title={n.content}
                        >
                          {n.content}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => togglePublish(n)}
                          className="p-2 rounded-lg hover:bg-purple-900/30 transition-colors"
                          title={n.is_published ? '非公開にする' : '公開する'}
                        >
                          {n.is_published ? <FaEyeSlash className="text-gray-300" /> : <FaEye className="text-purple-300" />}
                        </button>
                        <Link
                          href={`/admin/notices/${n.id}/edit`}
                          className="p-2 rounded-lg hover:bg-purple-900/30 transition-colors"
                          title="編集"
                        >
                          <FaEdit className="text-purple-300" />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
