// app/api/admin/ranking-config/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

function envOrThrow(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function clampNum(v: any, min: number, max: number, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function clampInt(v: any, min: number, max: number, fallback: number) {
  return Math.trunc(clampNum(v, min, max, fallback));
}

type TrendMode = 'daily' | 'weekly' | 'monthly';

async function isAdmin(admin: ReturnType<typeof createClient>, userId: string) {
  // dashboard と同じ判定を踏襲（app_admins or players.is_admin）
  const [a1, a2] = await Promise.all([
    admin.from('app_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    admin.from('players').select('is_admin').eq('id', userId).maybeSingle(),
  ]);

  const ok1 = !!a1.data?.user_id;
  const ok2 = a2.data?.is_admin === true;
  return ok1 || ok2;
}

async function loadRow(admin: ReturnType<typeof createClient>) {
  // まず id='global' を読む。無ければ 1行目フォールバック。
  const q1 = await admin.from('ranking_config').select('*').eq('id', 'global').maybeSingle();
  if (!q1.error && q1.data) return q1.data;

  const q2 = await admin.from('ranking_config').select('*').limit(1).maybeSingle();
  if (!q2.error && q2.data) return q2.data;

  return null;
}

export async function GET() {
  try {
    const url = envOrThrow('NEXT_PUBLIC_SUPABASE_URL');
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE ||
      '';

    if (!key) throw new Error('Missing env: SUPABASE_SERVICE_ROLE_KEY');

    const admin = createClient(url, key, { auth: { persistSession: false } });

    const row = await loadRow(admin);

    // 既定値（あなたのUIと同じ）
    const cfg = {
      k_factor: clampInt(row?.k_factor, 10, 64, 32),
      score_diff_multiplier: clampNum(row?.score_diff_multiplier, 0.01, 0.1, 0.05),
      handicap_diff_multiplier: clampNum(row?.handicap_diff_multiplier, 0.01, 0.05, 0.02),
      win_threshold_handicap_change: clampInt(row?.win_threshold_handicap_change, 0, 50, 10),
      handicap_change_amount: clampInt(row?.handicap_change_amount, -10, 10, 1),
    };

    const modeRaw = String(row?.trend_default_mode ?? 'daily').toLowerCase();
    const mode: TrendMode = modeRaw === 'weekly' || modeRaw === 'monthly' ? (modeRaw as TrendMode) : 'daily';

    const trend = {
      trend_daily_days: clampInt(row?.trend_daily_days, 1, 60, 5),
      trend_weekly_weeks: clampInt(row?.trend_weekly_weeks, 1, 60, 5),
      trend_monthly_months: clampInt(row?.trend_monthly_months, 1, 60, 5),
      trend_default_mode: mode,
    };

    return NextResponse.json({ ok: true, config: cfg, trend, row_id: row?.id ?? 'global' });
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: e?.message || 'failed' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const url = envOrThrow('NEXT_PUBLIC_SUPABASE_URL');
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE ||
      '';

    if (!key) throw new Error('Missing env: SUPABASE_SERVICE_ROLE_KEY');

    const admin = createClient(url, key, { auth: { persistSession: false } });

    const userId = req.headers.get('x-user-id') || '';
    if (!userId) {
      return NextResponse.json({ ok: false, message: 'Missing x-user-id' }, { status: 401 });
    }

    const ok = await isAdmin(admin, userId);
    if (!ok) {
      return NextResponse.json({ ok: false, message: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();

    // 旧UI/新UIどちらでも受けられるように、フラットでもネストでも拾う
    const src = body?.config && typeof body.config === 'object' ? body.config : body;
    const tsrc = body?.trend && typeof body.trend === 'object' ? body.trend : body;

    const modeRaw = String(tsrc?.trend_default_mode ?? src?.trend_default_mode ?? 'daily').toLowerCase();
    const mode: TrendMode = modeRaw === 'weekly' || modeRaw === 'monthly' ? (modeRaw as TrendMode) : 'daily';

    const payload = {
      id: 'global',

      // ELO系
      k_factor: clampInt(src?.k_factor, 10, 64, 32),
      score_diff_multiplier: clampNum(src?.score_diff_multiplier, 0.01, 0.1, 0.05),
      handicap_diff_multiplier: clampNum(src?.handicap_diff_multiplier, 0.01, 0.05, 0.02),
      win_threshold_handicap_change: clampInt(src?.win_threshold_handicap_change, 0, 50, 10),
      handicap_change_amount: clampInt(src?.handicap_change_amount, -10, 10, 1),

      // trend_*（今回の本命）
      trend_daily_days: clampInt(tsrc?.trend_daily_days, 1, 60, 5),
      trend_weekly_weeks: clampInt(tsrc?.trend_weekly_weeks, 1, 60, 5),
      trend_monthly_months: clampInt(tsrc?.trend_monthly_months, 1, 60, 5),
      trend_default_mode: mode,

      updated_at: new Date().toISOString(),
    };

    const { data, error } = await admin
      .from('ranking_config')
      .upsert(payload, { onConflict: 'id' })
      .select(
        'id,k_factor,score_diff_multiplier,handicap_diff_multiplier,win_threshold_handicap_change,handicap_change_amount,trend_daily_days,trend_weekly_weeks,trend_monthly_months,trend_default_mode,updated_at'
      )
      .maybeSingle();

    if (error) {
      // ここで落とす。成功メッセージは出させない。
      throw error;
    }
    if (!data) {
      throw new Error('No row returned from upsert');
    }

    return NextResponse.json({ ok: true, config: data, saved: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: e?.message || 'failed' }, { status: 500 });
  }
}
