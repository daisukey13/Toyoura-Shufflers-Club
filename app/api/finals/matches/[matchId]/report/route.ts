// app/api/finals/matches/[matchId]/report/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AnyBody = Record<string, any>;

async function isAdminPlayer(playerId: string): Promise<boolean> {
  const { data: p, error: pErr } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', playerId)
    .maybeSingle();
  if (!pErr && p?.is_admin === true) return true;

  const { data: a, error: aErr } = await supabaseAdmin
    .from('app_admins')
    .select('user_id')
    .eq('user_id', playerId)
    .maybeSingle();
  if (!aErr && a?.user_id) return true;

  return false;
}

function isMissingColumnErr(err: any, col: string) {
  const msg = String(err?.message ?? err ?? '');
  return msg.includes(`Could not find the '${col}' column`) || msg.includes(`column "${col}" does not exist`);
}

async function updateFinalMatchWithReasonFallback(matchId: string, base: AnyBody) {
  // end_reason / finish_reason どちらでも動くように（列が無い環境に強い）
  const candidates: AnyBody[] = [
    { ...base, end_reason: base.reason, finish_reason: base.reason },
    { ...base, end_reason: base.reason },
    { ...base, finish_reason: base.reason },
    { ...base },
  ];

  let lastErr: any = null;

  for (const c of candidates) {
    const payload: AnyBody = { ...c };
    delete payload.reason;

    const { error } = await supabaseAdmin.from('final_matches').update(payload).eq('id', matchId);

    if (!error) return;
    lastErr = error;

    // 列無しは継続
    if (isMissingColumnErr(error, 'end_reason') || isMissingColumnErr(error, 'finish_reason')) continue;

    break;
  }

  throw new Error(String(lastErr?.message || 'final_matches update failed'));
}

async function getDefPlayerId(): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('players')
    .select('id')
    .or('is_dummy.eq.true,handle_name.eq.def')
    .order('is_dummy', { ascending: false })
    .limit(1);

  if (error || !data?.length) throw new Error('def プレイヤーが存在しません（players.is_dummy / handle_name=def）');
  return String(data[0].id);
}

function clampInt(v: unknown, min: number, max: number, fallback: number) {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

async function propagateWinnerToNextRound(bracketId: string, roundNo: number, matchNo: number, winnerId: string | null) {
  if (!winnerId) return;
  const nextRound = roundNo + 1;
  const nextSlot = matchNo; // ★標準：RのM#勝者は、R+1のslot_no=match_no に入れる

  const { data: found, error: fErr } = await supabaseAdmin
    .from('final_round_entries')
    .select('id')
    .eq('bracket_id', bracketId)
    .eq('round_no', nextRound)
    .eq('slot_no', nextSlot)
    .maybeSingle();

  if (fErr) {
    console.warn('[finals] propagate lookup failed:', fErr);
    return;
  }

  if (found?.id) {
    const { error } = await supabaseAdmin
      .from('final_round_entries')
      .update({ player_id: winnerId })
      .eq('id', found.id);
    if (error) console.warn('[finals] propagate update failed:', error);
  } else {
    const { error } = await supabaseAdmin
      .from('final_round_entries')
      .insert({ bracket_id: bracketId, round_no: nextRound, slot_no: nextSlot, player_id: winnerId });
    if (error) console.warn('[finals] propagate insert failed:', error);
  }
}

async function recomputeChampionInFinalBrackets(bracketId: string) {
  const { data, error } = await supabaseAdmin
    .from('final_matches')
    .select('round_no,match_no,winner_id')
    .eq('bracket_id', bracketId)
    .not('winner_id', 'is', null)
    .limit(2000);

  if (error) return;

  const ms = (data ?? []) as any[];
  if (!ms.length) return;

  const maxRound = ms.reduce((mx, m) => Math.max(mx, Number(m.round_no ?? 0)), 0);
  const last = ms.filter((m) => Number(m.round_no ?? 0) === maxRound);

  last.sort((a, b) => Number(a.match_no ?? 9999) - Number(b.match_no ?? 9999));
  const championId = last?.[0]?.winner_id ? String(last[0].winner_id) : null;
  if (!championId) return;

  await supabaseAdmin.from('final_brackets').update({ champion_player_id: championId }).eq('id', bracketId);
}

export async function POST(req: NextRequest, ctx: { params: { matchId: string } }) {
  try {
    const matchId = String(ctx?.params?.matchId || '').trim();
    if (!matchId) {
      return NextResponse.json({ ok: false, message: 'match_id が未指定です。' }, { status: 400 });
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json({ ok: false, message: 'Supabase 環境変数が未設定です。' }, { status: 500 });
    }

    // ✅ Next.js 15+: cookies() は await が必要
    const cookieStore = await cookies();

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
    const okAdmin = await isAdminPlayer(userId);
    if (!okAdmin) {
      return NextResponse.json({ ok: false, message: '管理者権限が必要です。' }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as AnyBody | null;
    if (!body) {
      return NextResponse.json({ ok: false, message: '不正なリクエストです。' }, { status: 400 });
    }

    const { data: mRow, error: mErr } = await supabaseAdmin
      .from('final_matches')
      .select('id,bracket_id,round_no,match_no,player_a_id,player_b_id,winner_id,loser_id')
      .eq('id', matchId)
      .maybeSingle();

    if (mErr || !mRow) {
      return NextResponse.json({ ok: false, message: 'final_match が見つかりません。' }, { status: 404 });
    }

    const bracketId = String(mRow.bracket_id);
    const roundNo = Number(mRow.round_no ?? 0);
    const matchNo = Number(mRow.match_no ?? 0);

    if (!bracketId || !roundNo || !matchNo) {
      return NextResponse.json({ ok: false, message: 'final_match のキー情報が不足しています。' }, { status: 500 });
    }

    const defId = await getDefPlayerId();

    let playerA = mRow.player_a_id ? String(mRow.player_a_id) : null;
    let playerB = mRow.player_b_id ? String(mRow.player_b_id) : null;

    if (!playerA || !playerB) {
      const slotA = matchNo * 2 - 1;
      const slotB = matchNo * 2;

      const { data: eRows } = await supabaseAdmin
        .from('final_round_entries')
        .select('slot_no,player_id')
        .eq('bracket_id', bracketId)
        .eq('round_no', roundNo)
        .in('slot_no', [slotA, slotB]);

      const map = new Map<number, string>();
      (eRows ?? []).forEach((r: any) => {
        if (r?.slot_no && r?.player_id) map.set(Number(r.slot_no), String(r.player_id));
      });

      playerA = playerA ?? map.get(slotA) ?? null;
      playerB = playerB ?? map.get(slotB) ?? null;
    }

    if (!playerA || !playerB) {
      return NextResponse.json({ ok: false, message: '参加者が未設定です（枠が埋まっていません）。' }, { status: 400 });
    }

    const aIsDef = playerA === defId;
    const bIsDef = playerB === defId;

    let winnerId = String(body.winner_id || '').trim() || null;
    let loserId = String(body.loser_id || '').trim() || null;

    const reason = String(body.end_reason ?? body.finish_reason ?? body.reason ?? 'normal').trim().toLowerCase();

    let winnerScore = clampInt(body.winner_score, 0, 99, 15);
    let loserScore = clampInt(body.loser_score, 0, 99, 0);

    let affects_rating: boolean | null = null;
    let forcedReason: string | null = null;

    if (aIsDef || bIsDef) {
      affects_rating = false;
      forcedReason = 'bye';

      if (aIsDef && bIsDef) {
        winnerId = defId;
        loserId = null;
        winnerScore = 0;
        loserScore = 0;
      } else if (aIsDef && !bIsDef) {
        winnerId = playerB;
        loserId = defId;
        winnerScore = 1;
        loserScore = 0;
      } else if (!aIsDef && bIsDef) {
        winnerId = playerA;
        loserId = defId;
        winnerScore = 1;
        loserScore = 0;
      }
    } else {
      if (!winnerId || !loserId || winnerId === loserId) {
        return NextResponse.json({ ok: false, message: '勝者/敗者が不正です。' }, { status: 400 });
      }
      if ((winnerId !== playerA && winnerId !== playerB) || (loserId !== playerA && loserId !== playerB)) {
        return NextResponse.json({ ok: false, message: '勝者/敗者が枠の参加者と一致しません。' }, { status: 400 });
      }
      if (winnerScore <= loserScore) {
        return NextResponse.json({ ok: false, message: 'スコアが不正です（勝者 > 敗者）。' }, { status: 400 });
      }
    }

    const updateRow: AnyBody = {
      winner_id: winnerId,
      loser_id: loserId,
      winner_score: winnerScore,
      loser_score: loserScore,
      reason: forcedReason ?? reason,
    };

    {
      const { error } = await supabaseAdmin.from('final_matches').select('id,affects_rating').limit(1);
      if (!error) updateRow.affects_rating = affects_rating ?? true;
    }

    updateRow.winner_points_change = 0;
    updateRow.loser_points_change = 0;
    updateRow.winner_handicap_change = 0;
    updateRow.loser_handicap_change = 0;

    await updateFinalMatchWithReasonFallback(matchId, updateRow);

    await propagateWinnerToNextRound(bracketId, roundNo, matchNo, winnerId);
    await recomputeChampionInFinalBrackets(bracketId);

    return NextResponse.json(
      { ok: true, bye: aIsDef || bIsDef, bracket_id: bracketId, round_no: roundNo, match_no: matchNo },
      { status: 200 }
    );
  } catch (e: any) {
    console.error('[api/finals/matches/[id]/report] fatal:', e);
    return NextResponse.json({ ok: false, message: e?.message || 'サーバエラーが発生しました。' }, { status: 500 });
  }
}
