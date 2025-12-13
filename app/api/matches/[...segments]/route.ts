// app/api/matches/[...segments]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

// service ロールでバックエンド専用クライアント
const supabaseAdmin =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      })
    : null;

// GET: /api/matches/:matchId/report をここで受ける（最短確実）
export async function GET(
  _req: NextRequest,
  { params }: { params: { segments: string[] } },
) {
  const seg = params?.segments ?? [];

  // ✅ /api/matches/{matchId}/report
  if (seg.length === 2 && seg[1] === 'report') {
    if (!supabaseAdmin) {
      return json(
        { ok: false, error: 'Supabase admin client not configured' },
        500,
      );
    }

    const matchId = seg[0];

    const { data, error } = await supabaseAdmin
      .from('matches')
      .select('id, status, winner_score, loser_score, winner_id, loser_id')
      .eq('id', matchId)
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: false, error: 'Match not found' }, 404);

    return json({ ok: true, matchId, match: data });
  }

  // それ以外は従来どおり Not Found（最小）
  return json({ ok: false, error: 'Not found', segments: seg }, 404);
}

// POST: /api/matches/:matchId/report をここで受ける（最短確実）
export async function POST(
  req: NextRequest,
  { params }: { params: { segments: string[] } },
) {
  const seg = params?.segments ?? [];

  if (seg.length === 2 && seg[1] === 'report') {
    if (!supabaseAdmin) {
      return json(
        { ok: false, error: 'Supabase admin client not configured' },
        500,
      );
    }

    const matchId = seg[0];
    const body = await req.json().catch(() => ({}));

    const {
      winner_id,
      loser_id,
      winner_score = 15,
      loser_score,
    } = body as {
      winner_id?: string;
      loser_id?: string;
      winner_score?: number;
      loser_score?: number;
    };

    if (!winner_id || !loser_id || loser_score == null) {
      return json(
        {
          ok: false,
          error:
            'winner_id, loser_id, loser_score は必須です（フロントからの送信内容を確認してください）',
        },
        400,
      );
    }

    const { data: match, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('id, status')
      .eq('id', matchId)
      .maybeSingle();

    if (matchError) return json({ ok: false, error: matchError.message }, 500);
    if (!match) return json({ ok: false, error: 'Match not found' }, 404);

    if (match.status === 'finalized') {
      return json({ ok: false, error: 'Match is already finalized' }, 400);
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
      .eq('id', matchId);

    if (updateError) {
      return json({ ok: false, error: updateError.message }, 500);
    }

    return json({
      ok: true,
      match_id: matchId,
      winner_id,
      loser_id,
      winner_score,
      loser_score,
    });
  }

  return json({ ok: false, error: 'Not found', segments: seg }, 404);
}
