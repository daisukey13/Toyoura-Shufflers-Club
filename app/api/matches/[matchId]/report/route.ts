// app/api/matches/[matchId]/report/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// service ロールでバックエンド専用クライアント
const supabaseAdmin =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      })
    : null;

// GET は動作確認用
export async function GET(
  _req: NextRequest,
  { params }: { params: { matchId: string } },
) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { ok: false, error: 'Supabase admin client not configured' },
      { status: 500 },
    );
  }

  const { matchId } = params;

  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('id, status, winner_score, loser_score')
    .eq('id', matchId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { ok: false, error: 'Match not found' },
      { status: 404 },
    );
  }

  return NextResponse.json({
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
    return NextResponse.json(
      { ok: false, error: 'Supabase admin client not configured' },
      { status: 500 },
    );
  }

  const { matchId } = params;
  const body = await req.json().catch(() => ({}));

  const {
    winner_id,
    loser_id,
    winner_score = 15, // ここは必要に応じて変更
    loser_score,
  } = body as {
    winner_id?: string;
    loser_id?: string;
    winner_score?: number;
    loser_score?: number;
  };

  if (!winner_id || !loser_id || loser_score == null) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'winner_id, loser_id, loser_score は必須です（フロントからの送信内容を確認してください）',
      },
      { status: 400 },
    );
  }

  // 試合が存在するかチェック
  const { data: match, error: matchError } = await supabaseAdmin
    .from('matches')
    .select('id, status')
    .eq('id', matchId)
    .maybeSingle();

  if (matchError) {
    return NextResponse.json(
      { ok: false, error: matchError.message },
      { status: 500 },
    );
  }

  if (!match) {
    return NextResponse.json(
      { ok: false, error: 'Match not found' },
      { status: 404 },
    );
  }

  // すでに finalized なら二重登録防止（必要に応じて調整）
  if (match.status === 'finalized') {
    return NextResponse.json(
      { ok: false, error: 'Match is already finalized' },
      { status: 400 },
    );
  }

  // 試合テーブルの更新（ランキング変動は一旦ナシの最小実装）
  const { error: updateError } = await supabaseAdmin
    .from('matches')
    .update({
      status: 'finalized',
      winner_id,
      loser_id,
      winner_score,
      loser_score,
    })
    .eq('id', matchId);

  if (updateError) {
    return NextResponse.json(
      { ok: false, error: updateError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    match_id: matchId,
    winner_id,
    loser_id,
    winner_score,
    loser_score,
  });
}
