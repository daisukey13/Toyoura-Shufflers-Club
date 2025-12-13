// app/api/matches/report/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// service role（バックエンド専用）
const supabaseAdmin =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      })
    : null;

/**
 * GET: 動作確認/ヘルスチェック用
 * curl -i "https://toyoura.online/api/matches/report"
 */
export async function GET(_req: NextRequest) {
  if (!supabaseUrl) {
    return NextResponse.json(
      { ok: false, error: 'NEXT_PUBLIC_SUPABASE_URL is missing' },
      { status: 500 },
    );
  }
  if (!supabaseAdmin) {
    return NextResponse.json(
      { ok: false, error: 'Supabase admin client not configured (missing SUPABASE_SERVICE_ROLE_KEY)' },
      { status: 500 },
    );
  }

  // Supabase疎通（軽いクエリ）
  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('id')
    .limit(1);

  return NextResponse.json({
    ok: true,
    message: 'match report route is alive',
    supabaseUrl,
    supabaseQueryOk: !error,
    supabaseQueryError: error?.message ?? null,
    sampleMatchId: data?.[0]?.id ?? null,
    timestamp: new Date().toISOString(),
  });
}

/**
 * POST: match_id を受け取り、必要ならその場でfinalizeまで行う（最小実装）
 * curl -s -X POST "https://toyoura.online/api/matches/report" \
 *  -H "Content-Type: application/json" \
 *  -d '{"match_id":"...","winner_id":"...","loser_id":"...","loser_score":5}' | jq .
 */
export async function POST(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { ok: false, error: 'Supabase admin client not configured' },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => ({}));

  const {
    match_id,
    winner_id,
    loser_id,
    winner_score = 15,
    loser_score,
  } = body as {
    match_id?: string;
    winner_id?: string;
    loser_id?: string;
    winner_score?: number;
    loser_score?: number;
  };

  if (!match_id) {
    return NextResponse.json(
      { ok: false, error: 'match_id is required' },
      { status: 400 },
    );
  }

  // winner/loser/loser_score が無いなら「存在確認だけ」返す（壊さない最小設計）
  if (!winner_id || !loser_id || loser_score == null) {
    const { data: match, error } = await supabaseAdmin
      .from('matches')
      .select('id, status, winner_score, loser_score, winner_id, loser_id')
      .eq('id', match_id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (!match) {
      return NextResponse.json({ ok: false, error: 'Match not found' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      mode: 'inspect',
      match,
      note: 'To finalize, send winner_id, loser_id, loser_score (and optionally winner_score).',
    });
  }

  // 試合存在チェック
  const { data: match, error: matchError } = await supabaseAdmin
    .from('matches')
    .select('id, status')
    .eq('id', match_id)
    .maybeSingle();

  if (matchError) {
    return NextResponse.json({ ok: false, error: matchError.message }, { status: 500 });
  }
  if (!match) {
    return NextResponse.json({ ok: false, error: 'Match not found' }, { status: 404 });
  }
  if (match.status === 'finalized') {
    return NextResponse.json({ ok: false, error: 'Match is already finalized' }, { status: 400 });
  }

  const { error: updateError } = await supabaseAdmin
    .from('matches')
    .update({
      status: 'finalized',
      winner_id,
      loser_id,
      winner_score,
      loser_score,
    })
    .eq('id', match_id);

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    mode: 'finalize',
    match_id,
    winner_id,
    loser_id,
    winner_score,
    loser_score,
  });
}
