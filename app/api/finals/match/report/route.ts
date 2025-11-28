import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AnyBody = Record<string, any>;
type AnyError = { message?: string } | null;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const toInt = (v: unknown, fallback = 0) => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
};

async function isAdminUser(userId: string): Promise<boolean> {
  const [adminResp, playerResp] = await Promise.all([
    (supabaseAdmin.from('app_admins') as any).select('user_id').eq('user_id', userId).maybeSingle(),
    (supabaseAdmin.from('players') as any).select('is_admin').eq('id', userId).maybeSingle(),
  ]);
  if (adminResp?.data?.user_id) return true;
  if (playerResp?.data?.is_admin === true) return true;
  return false;
}

function normalizeReason(body: AnyBody): string {
  const r = String(body?.finish_reason ?? body?.end_reason ?? body?.reason ?? 'normal').trim().toLowerCase();
  return r || 'normal';
}

/**
 * final_matches の列名差異に耐える “段階的リトライ更新”
 * - finish_reason 列が無い → end_reason へ
 * - status 列が無い → 外す
 * - affects_rating / *_delta 列が無い → 外す
 */
async function updateFinalMatchWithFallback(matchId: string, patch: AnyBody) {
  // 1) finish_reason で試す
  let { error } = await supabaseAdmin.from('final_matches').update(patch).eq('id', matchId);
  if (!error) return { ok: true as const };

  // finish_reason 列が無い → end_reason に差し替え
  const msg1 = String((error as any)?.message || '');
  if (msg1.includes('column') && msg1.includes('finish_reason')) {
    const { finish_reason, ...rest } = patch;
    const retry = { ...rest, end_reason: patch.finish_reason };
    const r2 = await supabaseAdmin.from('final_matches').update(retry).eq('id', matchId);
    if (!r2.error) return { ok: true as const };
    error = r2.error;
  }

  // status 列が無い → 外して再試行
  const msg2 = String((error as any)?.message || '');
  if (msg2.includes('column') && msg2.includes('status')) {
    const { status, ...rest } = patch;
    const r3 = await supabaseAdmin.from('final_matches').update(rest).eq('id', matchId);
    if (!r3.error) return { ok: true as const };
    error = r3.error;
  }

  // affects_rating / delta 列が無い → 外して再試行
  const msg3 = String((error as any)?.message || '');
  if (
    msg3.includes('column') &&
    (msg3.includes('affects_rating') ||
      msg3.includes('winner_points_delta') ||
      msg3.includes('loser_points_delta') ||
      msg3.includes('winner_handicap_delta') ||
      msg3.includes('loser_handicap_delta'))
  ) {
    const {
      affects_rating,
      winner_points_delta,
      loser_points_delta,
      winner_handicap_delta,
      loser_handicap_delta,
      ...rest
    } = patch;
    const r4 = await supabaseAdmin.from('final_matches').update(rest).eq('id', matchId);
    if (!r4.error) return { ok: true as const };
    error = r4.error;
  }

  return { ok: false as const, error };
}

/**
 * match_id が無い場合に、(bracket_id, round_no, match_no) で final_matches.id を解決する。
 * - 見つからなければ INSERT して作る（最小限）
 */
async function resolveOrCreateFinalMatchId(body: AnyBody): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const direct = String(body?.match_id ?? '').trim();
  if (direct) return { ok: true, id: direct };

  const bracket_id = String(body?.bracket_id ?? '').trim();
  const round_no = toInt(body?.round_no, NaN);
  const match_no = toInt(body?.match_no, NaN);

  if (!bracket_id || !Number.isFinite(round_no) || !Number.isFinite(match_no)) {
    return {
      ok: false,
      message: 'match_id が未指定です（代替で bracket_id / round_no / match_no も必要です）。',
    };
  }

  // 1) 既存検索
  const found = await supabaseAdmin
    .from('final_matches')
    .select('id')
    .eq('bracket_id', bracket_id)
    .eq('round_no', round_no)
    .eq('match_no', match_no)
    .maybeSingle();

  if (!found.error && found.data?.id) {
    return { ok: true, id: found.data.id as string };
  }

  // match_no 列名が違う可能性に備えて、match_index でも探す
  const msg = String((found.error as AnyError)?.message || '');
  if (msg.includes('column') && msg.includes('match_no')) {
    const found2 = await supabaseAdmin
      .from('final_matches')
      .select('id')
      .eq('bracket_id', bracket_id)
      .eq('round_no', round_no)
      .eq('match_index', match_no as any)
      .maybeSingle();

    if (!found2.error && found2.data?.id) return { ok: true, id: found2.data.id as string };
  }

  // 2) 無ければ作る（必要最小限）
  const baseRow: AnyBody = {
    bracket_id,
    round_no,
    match_no,
  };

  // status 列がある場合だけ入れたいが、無いと失敗するのでまず無しで insert して、あれば後で update でもOK
  const ins = await supabaseAdmin.from('final_matches').insert(baseRow).select('id').single();
  if (!ins.error && ins.data?.id) return { ok: true, id: ins.data.id as string };

  // match_no が無いスキーマなら match_index でリトライ
  const insMsg = String((ins.error as AnyError)?.message || '');
  if (insMsg.includes('column') && insMsg.includes('match_no')) {
    const { match_no: _mn, ...rest } = baseRow;
    const ins2 = await supabaseAdmin
      .from('final_matches')
      .insert({ ...rest, match_index: match_no })
      .select('id')
      .single();

    if (!ins2.error && ins2.data?.id) return { ok: true, id: ins2.data.id as string };
    return { ok: false, message: `final_matches 作成に失敗: ${String((ins2.error as AnyError)?.message || '')}` };
  }

  return { ok: false, message: `final_matches 作成に失敗: ${String((ins.error as AnyError)?.message || '')}` };
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json({ ok: false, message: 'Supabase 環境変数が未設定です。' }, { status: 500 });
    }

    const cookieStore = cookies();
    const supa = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options?: any) {
            cookieStore.set({ name, value, ...(options || {}) } as any);
          },
          remove(name: string, options?: any) {
            cookieStore.set({ name, value: '', ...(options || {}) } as any);
          },
        },
      } as any
    );

    const { data: userData, error: userErr } = await supa.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, message: '認証が必要です。' }, { status: 401 });
    }

    const userId = userData.user.id;
    if (!(await isAdminUser(userId))) {
      return NextResponse.json({ ok: false, message: '権限がありません。' }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as AnyBody | null;
    if (!body) {
      return NextResponse.json({ ok: false, message: '不正なリクエストです。' }, { status: 400 });
    }

    // ✅ ここが今回のポイント：match_id 必須をやめ、無ければ (bracket_id, round_no, match_no) で解決する
    const resolved = await resolveOrCreateFinalMatchId(body);
    if (!resolved.ok) {
      return NextResponse.json({ ok: false, message: resolved.message }, { status: 400 });
    }
    const match_id = resolved.id;

    const winner_id = String(body.winner_id || '').trim();
    const loser_id = String(body.loser_id || '').trim();
    if (!winner_id || !loser_id) {
      return NextResponse.json({ ok: false, message: '勝者/敗者を選択してください。' }, { status: 400 });
    }
    if (winner_id === loser_id) {
      return NextResponse.json({ ok: false, message: '同一プレイヤーは選べません。' }, { status: 400 });
    }

    const winner_score = clamp(toInt(body.winner_score, 0), 0, 99);
    const loser_score = clamp(toInt(body.loser_score, 0), 0, 99);
    if (winner_score <= loser_score) {
      return NextResponse.json({ ok: false, message: 'スコアが不正です（勝者スコア > 敗者スコア）。' }, { status: 400 });
    }

    const finish_reason = normalizeReason(body);

    // ✅ 追加条件：時間制限/不戦勝/棄権は RP/HC 変化なし
    const affects_rating = finish_reason === 'normal';

    const patch: AnyBody = {
      winner_id,
      loser_id,
      winner_score,
      loser_score,
      status: 'finalized',
      finish_reason, // 列が無ければ end_reason にフォールバック
      affects_rating,
      winner_points_delta: 0,
      loser_points_delta: 0,
      winner_handicap_delta: 0,
      loser_handicap_delta: 0,
      updated_at: new Date().toISOString(),
    };

    const upd = await updateFinalMatchWithFallback(match_id, patch);
    if (!upd.ok) {
      const msg = String((upd.error as AnyError)?.message || upd.error || 'update failed');
      return NextResponse.json({ ok: false, message: `更新に失敗しました: ${msg}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, match_id }, { status: 200 });
  } catch (e: any) {
    console.error('[api/finals/match/report] fatal:', e);
    return NextResponse.json({ ok: false, message: 'サーバエラーが発生しました。' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: false, message: 'Use POST' }, { status: 405 });
}
