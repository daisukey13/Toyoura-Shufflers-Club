'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type TrendMode = 'daily' | 'weekly' | 'monthly';

type RankingConfigRow = {
  id: string;
  trend_daily_days: number | null;
  trend_weekly_weeks: number | null;
  trend_monthly_months: number | null;
  trend_default_mode: TrendMode | null;
};

function clampInt(v: any, min: number, max: number, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export default function RankingConfigTab() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string>('');

  const [dailyDays, setDailyDays] = useState(5);
  const [weeklyWeeks, setWeeklyWeeks] = useState(5);
  const [monthlyMonths, setMonthlyMonths] = useState(5);
  const [defaultMode, setDefaultMode] = useState<TrendMode>('daily');

  const load = async () => {
    setLoading(true);
    setMsg('');
    try {
      const { data, error } = await (supabase.from('ranking_config') as any)
        .select('id, trend_daily_days, trend_weekly_weeks, trend_monthly_months, trend_default_mode')
        .eq('id', 'global')
        .maybeSingle();

      if (error) throw error;
      const cfg = (data as RankingConfigRow | null) ?? null;

      // 行が無い場合でもUIは動く（保存で作成される）
      setDailyDays(cfg?.trend_daily_days ?? 5);
      setWeeklyWeeks(cfg?.trend_weekly_weeks ?? 5);
      setMonthlyMonths(cfg?.trend_monthly_months ?? 5);
      setDefaultMode((cfg?.trend_default_mode as TrendMode) ?? 'daily');
    } catch (e: any) {
      setMsg(e?.message ?? '設定の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSave = async () => {
    setSaving(true);
    setMsg('');

    try {
      const payload = {
        id: 'global',
        trend_daily_days: clampInt(dailyDays, 1, 60, 5),
        trend_weekly_weeks: clampInt(weeklyWeeks, 1, 60, 5),
        trend_monthly_months: clampInt(monthlyMonths, 1, 60, 5),
        trend_default_mode: defaultMode,
        updated_at: new Date().toISOString(),
      };

      // ✅ upsert + select で「本当に書けたか」を確定させる
      const { data, error } = await (supabase.from('ranking_config') as any)
        .upsert(payload, { onConflict: 'id' })
        .select('id, trend_daily_days, trend_weekly_weeks, trend_monthly_months, trend_default_mode')
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error('保存できませんでした（権限/RLSの可能性）');

      const saved = data as RankingConfigRow;

      // ✅ DBから返った値でフォームを確定（「戻る」問題を潰す）
      setDailyDays(saved.trend_daily_days ?? payload.trend_daily_days);
      setWeeklyWeeks(saved.trend_weekly_weeks ?? payload.trend_weekly_weeks);
      setMonthlyMonths(saved.trend_monthly_months ?? payload.trend_monthly_months);
      setDefaultMode((saved.trend_default_mode as TrendMode) ?? payload.trend_default_mode);

      setMsg('保存しました');
    } catch (e: any) {
      setMsg(e?.message ?? '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-6 sm:p-7 border border-purple-500/30">
      <h2 className="text-lg sm:text-xl font-bold text-yellow-100 mb-4">ランキング設定</h2>

      {loading ? (
        <div className="text-gray-400">読み込み中...</div>
      ) : (
        <div className="space-y-4">
          {msg && <div className="text-sm text-gray-200">{msg}</div>}

          <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
            <div className="rounded-xl bg-gray-900/60 border border-purple-500/30 p-4">
              <div className="text-sm text-gray-200 mb-2">日次（直近◯日）</div>
              <input
                type="number"
                min={1}
                max={60}
                value={dailyDays}
                onChange={(e) => setDailyDays(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-black/30 border border-purple-500/30 text-gray-100"
              />
            </div>

            <div className="rounded-xl bg-gray-900/60 border border-purple-500/30 p-4">
              <div className="text-sm text-gray-200 mb-2">週次（直近◯週）</div>
              <input
                type="number"
                min={1}
                max={60}
                value={weeklyWeeks}
                onChange={(e) => setWeeklyWeeks(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-black/30 border border-purple-500/30 text-gray-100"
              />
            </div>

            <div className="rounded-xl bg-gray-900/60 border border-purple-500/30 p-4">
              <div className="text-sm text-gray-200 mb-2">月次（直近◯ヶ月）</div>
              <input
                type="number"
                min={1}
                max={60}
                value={monthlyMonths}
                onChange={(e) => setMonthlyMonths(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-black/30 border border-purple-500/30 text-gray-100"
              />
            </div>

            <div className="rounded-xl bg-gray-900/60 border border-purple-500/30 p-4">
              <div className="text-sm text-gray-200 mb-2">デフォルト表示</div>
              <select
                value={defaultMode}
                onChange={(e) => setDefaultMode(e.target.value as TrendMode)}
                className="w-full px-3 py-2 rounded-lg bg-black/30 border border-purple-500/30 text-gray-100"
              >
                <option value="daily">日次</option>
                <option value="weekly">週次</option>
                <option value="monthly">月次</option>
              </select>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              onClick={load}
              disabled={saving}
              className="px-3 py-2 rounded-lg bg-gray-900/60 border border-purple-500/30 text-gray-200 hover:border-purple-400/60"
            >
              再読み込み
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-purple-600/40 border border-purple-400/40 text-yellow-100 hover:bg-purple-600/55"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
