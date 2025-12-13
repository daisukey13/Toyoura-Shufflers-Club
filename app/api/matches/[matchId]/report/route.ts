// app/api/matches/[matchId]/report/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// service ロールでバックエンド専用クライアント
const supabaseAdmin =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      })
    : null;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

function isUuidLike(v: string) {
  // 厳密でなくてOK（最小の弾き）
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
}

async function safeJson(req: NextRequest) {
  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return {};
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// GET は動作確認用
export async function GET(
  _req: NextRequest,
  { params }: { params: { matchId: string } },
) {
  if (!supabaseAdmin) {
    return json(
      {
        ok: false,
        error: 'Supabase admin client not configured',
        debug: {
          hasUrl: !!supabaseUrl,
          hasServiceRoleKey: !!serviceRoleKey,
        },
      },
      500,
    );
  }

  const { matchId } = params;

  if (!isUuidLike(matchId)) {
    return json(
      { ok: false, error: 'Invalid matchId format', matchId },
      400,
    );
  }

  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('id, status, winner_score, loser_score, winner_id, loser_id')
    .eq('id', matchId)
    .maybeSingle();

  if (error) {
    return json(
      {
        ok: false,
        error: error.message,
        hint: 'Supabase select failed',
      },
      500,
    );
  }

  if (!data) {
    return json({ ok: false, error: 'Match not found', matchId }, 404);
  }

  return json({
    ok: true,
    matchId,
    match: data,
  });
}

// POST: リーグの試合結果を登録する本体
export async function POST(
  req: NextRequest,
  { params }: { params: { matchId: string } },
) {
  if (!supabaseAdmin) {
    return json(
      {
        ok: false,
        error: 'Supabase admin client not configured',
        debug: {
          hasUrl: !!supabaseUrl,
          hasServiceRoleKey: !!serviceRoleKey,
        },
      },
      500,
    );
  }

  const { matchId } = params;

  if (!isUuidLike(matchId)) {
    return json(
      { ok: false, error: 'Invalid matchId format', matchId },
      400,
    );
  }

  const body = (await safeJson(req)) as Partial<{
    winner_id: string;
    loser_id: string;
    winner_score: number;
    loser_score: number;
  }>;

  const winner_id = body.winner_id;
  const loser_id = body.loser_id;

  // winner_score はデフォルト 15（現状の仕様を壊さない）
  const winner_score =
    typeof body.winner_score === 'number' ? body.winner_score : 15;

  const loser_score = body.loser_score;

  if (!winner_id || !loser_id || typeof loser_score !== 'number') {
    return json(
      {
        ok: false,
        error:
          'winner_id, loser_id, loser_score は必須です（フロントからの送信内容を確認してください）',
        received: {
          winner_id: !!winner_id,
          loser_id: !!loser_id,
          loser_score_type: typeof loser_score,
          winner_score,
        },
      },
      400,
    );
  }

  // すでに存在するか・状態確認
  const { data: match, error: matchError } = await supabaseAdmin
    .from('matches')
    .select('id, status')
    .eq('id', matchId)
    .maybeSingle();

  if (matchError) {
    return json(
      { ok: false, error: matchError.message, hint: 'match lookup failed' },
      500,
    );
  }

  if (!match) {
    return json({ ok: false, error: 'Match not found', matchId }, 404);
  }

  // 二重登録防止
  if (match.status === 'finalized') {
    return json(
      { ok: false, error: 'Match is already finalized', matchId },
      400,
    );
  }

  // 更新（ランキング変動は一旦ナシの最小実装）
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('matches')
    .update({
      status: 'finalized',
      winner_id,
      loser_id,
      winner_score,
      loser_score,
    })
    .eq('id', matchId)
    .select('id, status, winner_id, loser_id, winner_score, loser_score')
    .maybeSingle();

  if (updateError) {
    // ここで check constraint（winner_score制約など）に引っかかると message が出る
    return json(
      {
        ok: false,
        error: updateError.message,
        hint: 'match update failed (constraint / RLS / column mismatch etc.)',
        payload: { winner_id, loser_id, winner_score, loser_score },
      },
      500,
    );
  }

  return json({
    ok: true,
    match_id: matchId,
    match: updated ?? {
      id: matchId,
      status: 'finalized',
      winner_id,
      loser_id,
      winner_score,
      loser_score,
    },
  });
}
