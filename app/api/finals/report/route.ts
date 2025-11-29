// app/api/finals/report/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export async function GET() {
  return NextResponse.json({ ok: true, route: '/api/finals/report', methods: ['POST'] });
}

export async function POST(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
    if (!url || !key) {
      return jsonError('Supabase env is missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)', 500);
    }

    const supabase = createClient(url, key, { auth: { persistSession: false } });

    const body = await req.json().catch(() => null);
    if (!body) return jsonError('Invalid JSON');

    const bracket_id = String(body.bracket_id ?? '').trim();
    const round_no = Number(body.round_no ?? NaN);
    const match_no = Number(body.match_no ?? body.matchNo ?? NaN);

    if (!bracket_id) return jsonError('bracket_id is required');
    if (!isUuidLike(bracket_id)) return jsonError('bracket_id must be uuid');
    if (!Number.isFinite(round_no) || round_no <= 0) return jsonError('round_no is invalid');
    if (!Number.isFinite(match_no) || match_no <= 0) return jsonError('match_no is invalid');

    const payload: any = {
      bracket_id,
      round_no,
      match_no,
      winner_id: body.winner_id ?? null,
      loser_id: body.loser_id ?? null,
      winner_score: body.winner_score ?? null,
      loser_score: body.loser_score ?? null,
      end_reason: body.end_reason ?? body.finish_reason ?? null,
      sets_json: body.sets ?? body.sets_json ?? null,
      winner_sets: body.winner_sets ?? null,
      loser_sets: body.loser_sets ?? null,
      updated_at: new Date().toISOString(),
    };

    // 既存検索
    const { data: found, error: fErr } = await supabase
      .from('final_matches')
      .select('id')
      .eq('bracket_id', bracket_id)
      .eq('round_no', round_no)
      .eq('match_no', match_no)
      .maybeSingle();

    if (fErr) return jsonError(fErr.message, 500, { hint: 'finder failed' });

    let savedId: string | null = null;

    if (found?.id) {
      const { error: uErr } = await supabase.from('final_matches').update(payload).eq('id', found.id);
      if (uErr) return jsonError(uErr.message, 500, { hint: 'update failed' });
      savedId = found.id;
    } else {
      const { data: ins, error: iErr } = await supabase.from('final_matches').insert(payload).select('id').single();
      if (iErr) return jsonError(iErr.message, 500, { hint: 'insert failed' });
      savedId = ins?.id ?? null;
    }

    // ✅ 決勝なら champion_player_id を更新
    // bracket.max_round を見て、round_no==max_round && match_no==1 の winner_id を採用
    const { data: b, error: bErr } = await supabase
      .from('final_brackets')
      .select('id,max_round')
      .eq('id', bracket_id)
      .maybeSingle();

    if (!bErr && b?.id) {
      const isFinal = Number(round_no) === Number(b.max_round) && Number(match_no) === 1;
      if (isFinal) {
        await supabase
          .from('final_brackets')
          .update({ champion_player_id: payload.winner_id ?? null, updated_at: new Date().toISOString() })
          .eq('id', b.id);
      }
    }

    return NextResponse.json({ ok: true, id: savedId });
  } catch (e: any) {
    return jsonError(e?.message ?? 'Unknown error', 500);
  }
}
