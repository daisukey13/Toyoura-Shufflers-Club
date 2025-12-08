// app/api/finals/report/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

type SetScore = { a: number; b: number };

function toInt(v: any, fb = 0) {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fb;
}

function normalizeSets(raw: any): SetScore[] {
  if (!raw) return [];
  let v: any = raw;

  // 文字列JSONでもOK
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];

  const out: SetScore[] = [];
  for (const s of v.slice(0, 5)) {
    const a = toInt(s?.a ?? s?.score_a ?? s?.p1 ?? s?.player1, -1);
    const b = toInt(s?.b ?? s?.score_b ?? s?.p2 ?? s?.player2, -1);
    if (a < 0 || b < 0) continue;
    out.push({ a, b });
  }
  return out;
}

function calcSetWins(sets: SetScore[]) {
  let aWins = 0;
  let bWins = 0;
  for (const s of sets.slice(0, 5)) {
    if (s.a === s.b) continue;
    if (s.a > s.b) aWins++;
    else bWins++;
  }
  return { aWins, bWins };
}

function pickAdminKey() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();

  // ★新キー優先：SUPABASE_SECRET_KEY（sb_secret_...）
  // 互換：SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_KEY
  const key = (
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    ''
  ).trim();

  // 省略表示や改行混入を弾く（40文字台の sb_secret_ は正常なので length では弾かない）
  const looksBroken =
    !url ||
    !key ||
    /\s/.test(key) ||
    key.includes('...') ||
    key.includes('…');

  return { url, key, looksBroken };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // ✅ snake/camel 両対応
    const matchId = String(body?.match_id ?? body?.matchId ?? '').trim();
    if (!matchId) {
      return NextResponse.json({ ok: false, error: 'match_id is required' }, { status: 400 });
    }

    // ✅ sets_json / sets どっちで来てもOK
    const sets = normalizeSets(body?.sets_json ?? body?.sets);

    // 理由（両方カラムがある前提なら両方更新してOK）
    const finish_reason = body?.finish_reason != null ? String(body.finish_reason) : null;
    const end_reason = body?.end_reason != null ? String(body.end_reason) : null;

    // supabase（server/admin key 推奨：RLSに阻まれない）
    const { url, key, looksBroken } = pickAdminKey();
    if (looksBroken) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Supabase env is missing or invalid (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY)',
        },
        { status: 500 }
      );
    }

    const supabase = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });

    // 既存行を読んで player_a_id/player_b_id を掴む（winner_score計算に使う）
    const { data: existing, error: exErr } = await supabase
      .from('final_matches')
      .select('id, player_a_id, player_b_id, winner_id, loser_id, winner_score, loser_score')
      .eq('id', matchId)
      .maybeSingle();

    if (exErr) {
      return NextResponse.json({ ok: false, error: exErr.message }, { status: 400 });
    }
    if (!existing) {
      return NextResponse.json({ ok: false, error: 'final_matches row not found' }, { status: 404 });
    }

    // winner/loser は送られてきたら採用、なければ既存維持（必須にしない）
    const winner_id = body?.winner_id ? String(body.winner_id) : existing.winner_id;
    const loser_id = body?.loser_id ? String(body.loser_id) : existing.loser_id;

    // setsが入っているならセット勝数を計算して winner_score/loser_score を更新
    let winner_score = existing.winner_score;
    let loser_score = existing.loser_score;

    if (sets.length > 0 && existing.player_a_id && existing.player_b_id && winner_id) {
      const { aWins, bWins } = calcSetWins(sets);
      const winnerIsA = String(winner_id) === String(existing.player_a_id);
      winner_score = winnerIsA ? aWins : bWins;
      loser_score = winnerIsA ? bWins : aWins;
    }

    const updatePayload: any = {
      sets_json: sets.length ? sets : null,
      winner_id: winner_id ?? null,
      loser_id: loser_id ?? null,
      winner_score: winner_score ?? null,
      loser_score: loser_score ?? null,
      updated_at: new Date().toISOString(),
    };

    // ✅ カラムがあるなら更新（無い環境でも落ちないように null のときは入れない）
    if (finish_reason !== null) updatePayload.finish_reason = finish_reason;
    if (end_reason !== null) updatePayload.end_reason = end_reason;

    const { error: upErr } = await supabase.from('final_matches').update(updatePayload).eq('id', matchId);
    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, match_id: matchId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
