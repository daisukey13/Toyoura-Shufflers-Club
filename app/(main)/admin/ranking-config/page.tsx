'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FaArrowLeft, FaCog, FaSave, FaSpinner } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

type TrendMode = 'daily' | 'weekly' | 'monthly';

type TrendConfig = {
  trend_daily_days: number;
  trend_weekly_weeks: number;
  trend_monthly_months: number;
  trend_default_mode: TrendMode;
};

export default function AdminRankingConfigPage() {
  const router = useRouter();

  const supabase = useMemo<ReturnType<typeof createClient> | null>(() => {
    if (typeof window === 'undefined') return null;
    return createClient();
  }, []);

  const [authz, setAuthz] = useState<'checking' | 'ok' | 'no'>('checking');
  const [userId, setUserId] = useState<string>('');

  const [cfg, setCfg] = useState<TrendConfig>({
    trend_daily_days: 5,
    trend_weekly_weeks: 5,
    trend_monthly_months: 5,
    trend_default_mode: 'daily',
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!supabase) return;

        // cookieログイン確認
        const r = await fetch('/auth/whoami', { cache: 'no-store', credentials: 'include' });
        const j = r.ok ? await r.json() : { authenticated: false };
        if (!j?.authenticated) {
          router.replace('/login?redirect=/admin/ranking-config');
          return;
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace('/login?redirect=/admin/ranking-config');
          return;
        }

        if (cancelled) return;
        setUserId(user.id);

        // 管理者判定（DB側に合わせて複数候補を確認）
        const [a1, a2, a3] = await Promise.all([
          (supabase.from('app_admins') as any).select('user_id').eq('user_id', user.id).maybeSingle(),
          (supabase.from('players_private') as any).select('is_admin').eq('player_id', user.id).maybeSingle(),
          (supabase.from('players') as any).select('is_admin').eq('id', user.id).maybeSingle(),
        ]);

        const ok = !!a1.data?.user_id || a2.data?.is_admin === true || a3.data?.is_admin === true;
        if (!ok) {
          setAuthz('no');
          return;
        }

        setAuthz('ok');
        await loadFromApi();
      } catch {
        setAuthz('no');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, router]);

  const loadFromApi = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/ranking-config', { cache: 'no-store' });
      const j = await r.json();
      if (r.ok && j?.ok && j?.trend) {
        const t = j.trend as Partial<TrendConfig>;
        setCfg((prev) => ({
          ...prev,
          trend_daily_days: Number(t.trend_daily_days ?? prev.trend_daily_days),
          trend_weekly_weeks: Number(t.trend_weekly_weeks ?? prev.trend_weekly_weeks),
          trend_monthly_months: Number(t.trend_monthly_months ?? prev.trend_monthly_months),
          trend_default_mode: (t.trend_default_mode as any) ?? prev.trend_default_mode,
        }));
      }
    } finally {
      setLoading(false);
    }
  };

  const saveToApi = async () => {
    if (!userId) return;

    setSaving(true);
    try {
      // バリデーション（最小）
      const clampInt = (v: any, min: number, max: number) => {
        const n = Math.trunc(Number(v));
        if (!Number.isFinite(n)) return min;
        return Math.max(min, Math.min(max, n));
      };

      const payload: TrendConfig = {
        trend_daily_days: clampInt(cfg.trend_daily_days, 1, 60),
        trend_weekly_weeks: clampInt(cfg.trend_weekly_weeks, 1, 60),
        trend_monthly_months: clampInt(cfg.trend_monthly_months, 1, 60),
        trend_default_mode: cfg.trend_default_mode,
      };

      const r = await fetch('/api/admin/ranking-config', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({ trend: payload }),
      });

      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.message || `HTTP ${r.status}`);

      alert('表示設定を保存しました');

      // 保存後、必ずAPIの値を読み直して画面の「戻る」を防ぐ
      await loadFromApi();
    } catch (e: any) {
      alert(`保存に失敗しました: ${e?.message || 'failed'}`);
    } finally {
      setSaving(false);
    }
  };

  if (authz === 'checking') {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex items-center justify-center text-white">
        認証を確認しています...
      </div>
    );
  }

  if (authz === 'no') {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex items-center justify-center text-white">
        アクセス権限がありません
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link href="/admin/dashboard" className="inline-flex items-center gap-2 text-purple-300 hover:text-purple-200">
            <FaArrowLeft /> ダッシュボードへ
          </Link>
        </div>

        <div className="max-w-3xl mx-auto bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-8">
          <h1 className="text-2xl sm:text-3xl font-bold mb-6 flex items-center gap-3">
            <FaCog className="text-purple-400" />
            順位推移の表示設定
          </h1>

          {loading ? (
            <div className="text-gray-300">
              <FaSpinner className="inline mr-2 animate-spin" />
              読み込み中…
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20">
                <label className="block text-sm text-gray-300 mb-2">デフォルト表示</label>
                <select
                  value={cfg.trend_default_mode}
                  onChange={(e) => setCfg((p) => ({ ...p, trend_default_mode: e.target.value as TrendMode }))}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900/60 border border-purple-500/30 text-gray-100
                             focus:outline-none focus:border-purple-400"
                >
                  <option value="daily">日次</option>
                  <option value="weekly">週次（月曜）</option>
                  <option value="monthly">月次（1日）</option>
                </select>
              </div>

              <div className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20">
                <label className="block text-sm text-gray-300 mb-2">直近◯日（毎日0時更新）</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={cfg.trend_daily_days}
                  onChange={(e) => setCfg((p) => ({ ...p, trend_daily_days: Number(e.target.value) }))}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900/60 border border-purple-500/30 text-gray-100
                             focus:outline-none focus:border-purple-400"
                />
              </div>

              <div className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20">
                <label className="block text-sm text-gray-300 mb-2">直近◯週（毎週月曜ごと）</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={cfg.trend_weekly_weeks}
                  onChange={(e) => setCfg((p) => ({ ...p, trend_weekly_weeks: Number(e.target.value) }))}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900/60 border border-purple-500/30 text-gray-100
                             focus:outline-none focus:border-purple-400"
                />
              </div>

              <div className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20">
                <label className="block text-sm text-gray-300 mb-2">直近◯ヶ月（毎月1日ごと）</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={cfg.trend_monthly_months}
                  onChange={(e) => setCfg((p) => ({ ...p, trend_monthly_months: Number(e.target.value) }))}
                  className="w-full px-3 py-2 rounded-lg bg-gray-900/60 border border-purple-500/30 text-gray-100
                             focus:outline-none focus:border-purple-400"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={saveToApi}
                  disabled={saving}
                  className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl
                             hover:from-purple-700 hover:to-pink-700 transition-all transform hover:scale-105
                             shadow-lg disabled:opacity-50 disabled:transform-none inline-flex items-center gap-2"
                >
                  <FaSave />
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>

              <div className="text-xs text-gray-400">
                ※ 保存後に値が戻る場合は、APIがエラーを返しているはずです（このページは失敗時にアラートが出ます）
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
