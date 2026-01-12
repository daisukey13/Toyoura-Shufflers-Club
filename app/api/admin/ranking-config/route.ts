// app/api/admin/ranking-config/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY (or equivalent) / NEXT_PUBLIC_SUPABASE_URL');
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

async function assertAdminOrThrow(supabaseAdmin: ReturnType<typeof adminClient>, userId: string) {
  const [a1, a2, a3] = await Promise.all([
    supabaseAdmin.from('app_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    supabaseAdmin.from('players_private').select('is_admin').eq('player_id', userId).maybeSingle(),
    supabaseAdmin.from('players').select('is_admin').eq('id', userId).maybeSingle(),
  ]);

  // ✅ TS が「data が null の可能性」を指摘しても確実に通る形にする（最小修正）
  const ok1 =
    !a1.error &&
    !!a1.data &&
    typeof (a1.data as any).user_id === 'string' &&
    (a1.data as any).user_id.length > 0;

  const ok2 = !a2.error && a2.data?.is_admin === true;
  const ok3 = !a3.error && a3.data?.is_admin === true;

  const ok = ok1 || ok2 || ok3;

  if (!ok) {
    const e = new Error('forbidden');
    // @ts-expect-error
    e.status = 403;
    throw e;
  }
}

function noStore(res: NextResponse) {
  res.headers.set('cache-control', 'no-store');
  return res;
}

export async function GET() {
  try {
    const supabaseAdmin = adminClient();

    // 基本は id='global'
    let row: any = null;
    const q1 = await supabaseAdmin.from('ranking_config').select('*').eq('id', 'global').maybeSingle();
    if (!q1.error && q1.data) row = q1.data;

    // フォールバック：先頭1行
    if (!row) {
      const q2 = await supabaseAdmin.from('ranking_config').select('*').limit(1).maybeSingle();
      if (!q2.error && q2.data) row = q2.data;
    }

    // 返却（クライアントが欲しい形に整形）
    const config = {
      k_factor: row?.k_factor ?? 32,
      score_diff_multiplier: row?.score_diff_multiplier ?? 0.05,
      handicap_diff_multiplier: row?.handicap_diff_multiplier ?? 0.03,
      win_threshold_handicap_change: row?.win_threshold_handicap_change ?? 10,
      handicap_change_amount: row?.handicap_change_amount ?? 2,
    };

    const trend = {
      trend_daily_days: row?.trend_daily_days ?? 5,
      trend_weekly_weeks: row?.trend_weekly_weeks ?? 5,
      trend_monthly_months: row?.trend_monthly_months ?? 5,
      trend_default_mode: row?.trend_default_mode ?? 'daily',
    };

    return noStore(NextResponse.json({ ok: true, config, trend, raw: row ?? null }));
  } catch (e: any) {
    return noStore(
      NextResponse.json({ ok: false, message: e?.message ?? 'failed' }, { status: 500 })
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const supabaseAdmin = adminClient();

    const userId = req.headers.get('x-user-id') || '';
    if (!userId) {
      return noStore(NextResponse.json({ ok: false, message: 'missing x-user-id' }, { status: 401 }));
    }

    await assertAdminOrThrow(supabaseAdmin, userId);

    const body = await req.json().catch(() => ({}));

    // 受け取り方は柔軟に（{config:{...}, trend:{...}} でもフラットでもOK）
    const cfg = body?.config ?? body ?? {};
    const tr = body?.trend ?? body ?? {};

    const patch: any = {
      id: 'global',

      // ranking（ELO設定）
      k_factor: cfg.k_factor,
      score_diff_multiplier: cfg.score_diff_multiplier,
      handicap_diff_multiplier: cfg.handicap_diff_multiplier,
      win_threshold_handicap_change: cfg.win_threshold_handicap_change,
      handicap_change_amount: cfg.handicap_change_amount,

      // trend（表示設定）
      trend_daily_days: tr.trend_daily_days,
      trend_weekly_weeks: tr.trend_weekly_weeks,
      trend_monthly_months: tr.trend_monthly_months,
      trend_default_mode: tr.trend_default_mode,
    };

    // undefined を落とす（指定されたものだけ更新）
    Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

    const { data, error } = await supabaseAdmin
      .from('ranking_config')
      .upsert(patch, { onConflict: 'id' })
      .select('*')
      .maybeSingle();

    if (error) {
      return noStore(NextResponse.json({ ok: false, message: error.message }, { status: 400 }));
    }

    return noStore(NextResponse.json({ ok: true, saved: data ?? null }));
  } catch (e: any) {
    const status = e?.status === 403 ? 403 : 500;
    const message = e?.status === 403 ? 'forbidden' : e?.message ?? 'failed';
    return noStore(NextResponse.json({ ok: false, message }, { status }));
  }
}
