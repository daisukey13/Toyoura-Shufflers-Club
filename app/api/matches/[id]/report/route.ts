// app/api/matches/[id]/report/route.ts
import { NextRequest } from 'next/server';
import { createClient as createServerSupabase } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/server';

/* ========= JSON ヘルパー ========= */
type Json = Record<string, any>;
const json = (obj: Json, init?: number | ResponseInit) =>
  new Response(JSON.stringify(obj), {
    status: typeof init === 'number' ? init : (init as ResponseInit | undefined)?.status ?? 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...(typeof init === 'object' ? (init as ResponseInit) : {}),
  });

/* ========= メイン処理 ========= */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  /* --- Reporter 判定（SSR Auth or SYSTEM_REPORTER_ID） --- */
  const supaSSR = createServerSupabase();
  const {
    data: { user },
  } = await supaSSR.auth.getUser();

  const reporterId = user?.id ?? process.env.SYSTEM_REPORTER_ID ?? null;
  if (!reporterId) {
    return json(
      {
        error: 'missing reporter_id',
        detail:
          'ログインユーザーがいないため reporter_id を決定できません。環境変数 SYSTEM_REPORTER_ID に既存ユーザーのUUIDを設定してください。',
      },
      401
    );
  }

  /* --- DB操作は Service Role で（RLS回避） --- */
  const db = createServiceClient();

  /* --- 入力チェック --- */
  let body: { winner_id?: string; loser_id?: string; loser_score?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request', detail: 'JSON body required' }, 400);
  }
  const { winner_id, loser_id, loser_score } = body ?? {};
  if (!winner_id || !loser_id || typeof loser_score !== 'number') {
    return json(
      { error: 'bad request', detail: 'winner_id, loser_id, loser_score は必須です' },
      400
    );
  }

  const matchId = params.id;
  const nowIso = new Date().toISOString();

  /* --- 試合取得 --- */
  const { data: match, error: matchErr } = await db
    .from('matches')
    .select(
      `
      id, tournament_id, tournament_name,
      round, match_no,
      status, mode, is_tournament,
      a_id, b_id,
      player_a_id, player_b_id
    `
    )
    .eq('id', matchId)
    .maybeSingle();

  if (matchErr) return json({ error: 'fetch failed', detail: matchErr.message }, 500);
  if (!match) return json({ error: 'not found', detail: 'match not found' }, 404);
  if (match.status === 'finalized') return json({ ok: true, message: 'already finalized' }, 200);
  if (!match.a_id || !match.b_id) {
    return json(
      { error: 'missing sides', detail: `a_id/b_id が未設定です（match_id=${match.id}）` },
      409
    );
  }

  /* --- 大会情報（point_cap / name） --- */
  let pointCap = 15;
  let tournamentName: string | null = match.tournament_name ?? null;
  if (match.tournament_id) {
    const { data: t, error: tErr } = await db
      .from('tournaments')
      .select('id, name, point_cap, size')
      .eq('id', match.tournament_id)
      .maybeSingle();
    if (tErr) return json({ error: 'fetch failed', detail: tErr.message }, 500);
    if (t) {
      pointCap = Number.isFinite(t.point_cap) ? Number(t.point_cap) : 15;
      tournamentName ??= t.name ?? null;
    }
  }

  /* --- match_entries 補完 --- */
  const { data: entries, error: entErr } = await db
    .from('match_entries')
    .select('id, match_id, side, player_id')
    .eq('match_id', matchId);

  if (entErr)
    return json({ error: 'update failed', detail: `entries fetch failed: ${entErr.message}` }, 500);

  const needA = !(entries ?? []).some((e) => e.side === 'a');
  const needB = !(entries ?? []).some((e) => e.side === 'b');
  if (needA || needB) {
    const rows: Array<{ match_id: string; side: 'a' | 'b'; player_id: string }> = [];
    if (needA) rows.push({ match_id: matchId, side: 'a', player_id: match.a_id });
    if (needB) rows.push({ match_id: matchId, side: 'b', player_id: match.b_id });
    const { error: insErr } = await db.from('match_entries').insert(rows);
    if (insErr)
      return json(
        { error: 'update failed', detail: `match_entries の補完に失敗: ${insErr.message}` },
        500
      );
  }

  /* --- 試合確定 --- */
  const patch = {
    winner_id,
    loser_id,
    winner_score: pointCap,
    loser_score: Math.max(0, Math.floor(loser_score)),
    status: 'finalized' as const,
    updated_at: nowIso,
    player_a_id: match.a_id,
    player_b_id: match.b_id,
    is_tournament: true,
    tournament_name: tournamentName,
    reporter_id: reporterId,
    ...(match.tournament_id ? { tournament_id: match.tournament_id } : {}),
  };
  const { error: updErr } = await db.from('matches').update(patch).eq('id', matchId);
  if (updErr) return json({ error: 'update failed', detail: updErr.message, patch, matchId }, 500);

  /* --- R1 → R2 Final 自動生成（型ゆれ対応・安全版） --- */
  const roundStr = String(match.round ?? '').trim().toLowerCase();
  const matchStr = String(match.match_no ?? '').trim().toLowerCase();
  const isRound1 = ['1', 'r1'].includes(roundStr);
  const isMatch1 = ['1', 'm1'].includes(matchStr);

  if (isRound1 && match.tournament_id) {
    const slotSide: 'a_id' | 'b_id' = isMatch1 ? 'a_id' : 'b_id';
    const { data: final, error: finalSelErr } = await db
      .from('matches')
      .select('id, a_id, b_id')
      .eq('tournament_id', match.tournament_id)
      .in('round', [2, '2'])
      .in('match_no', [1, '1'])
      .maybeSingle();

    if (finalSelErr)
      return json({
        ok: true,
        match_id: matchId,
        warning: 'final select failed',
        detail: finalSelErr.message,
      });

    if (!final) {
      const newFinal = {
        mode: match.mode ?? 'singles',
        tournament_id: match.tournament_id,
        tournament_name: tournamentName,
        is_tournament: true,
        status: 'scheduled' as const,
        round: '2',
        match_no: '1',
        a_id: slotSide === 'a_id' ? winner_id : null,
        b_id: slotSide === 'b_id' ? winner_id : null,
        winner_type: 'player',
        winner_score: pointCap,
        loser_score: null,
        reporter_id: reporterId,
        played_at: nowIso,
        match_date: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      };
      const { error: insFinalErr } = await db.from('matches').insert([newFinal]);
      if (insFinalErr)
        return json({
          ok: true,
          match_id: matchId,
          warning: 'final create failed',
          detail: insFinalErr.message,
        });
    } else {
      const set: Record<'a_id' | 'b_id', string | null> = { a_id: final.a_id, b_id: final.b_id };
      set[slotSide] = winner_id;
      const { error: updFinalErr } = await db
        .from('matches')
        .update({
          ...set,
          is_tournament: true,
          tournament_name: tournamentName,
          reporter_id: reporterId,
          updated_at: nowIso,
        })
        .eq('id', final.id);
      if (updFinalErr)
        return json({
          ok: true,
          match_id: matchId,
          warning: 'final update failed',
          detail: updFinalErr.message,
        });
    }
  }

  /* --- 完了 --- */
  return json({ ok: true, match_id: matchId });
}
