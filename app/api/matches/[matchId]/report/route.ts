// app/api/matches/[matchId]/report/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AnyBody = Record<string, any>;
type EndReason = 'normal' | 'time_limit' | 'walkover' | 'forfeit';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const toInt = (v: unknown, fallback = 0) => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
};
const toBool = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return null;
};

function normalizeEndReason(v: unknown): EndReason {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'time_limit' || s === 'walkover' || s === 'forfeit') return s;
  return 'normal';
}

// ★要件：通常以外は RP/HC 変化なし
function shouldAffectRating(end_reason: EndReason) {
  return end_reason === 'normal';
}

/** ELO 風の変動（個人戦のみ） */
function calcDelta(
  winnerPoints: number,
  loserPoints: number,
  winnerHandicap: number,
  loserHandicap: number,
  scoreDifference: number
) {
  const K = 32;
  const expectedWinner = 1 / (1 + Math.pow(10, (loserPoints - winnerPoints) / 400));
  const scoreDiffMultiplier = 1 + scoreDifference / 30;

  const handicapDiff = winnerHandicap - loserHandicap;
  const handicapMultiplier = 1 + handicapDiff / 50;

  const baseWinnerChange = K * (1 - expectedWinner) * scoreDiffMultiplier * handicapMultiplier;
  const baseLoserChange = -K * expectedWinner * scoreDiffMultiplier;

  const winnerHandicapChange = scoreDifference >= 10 ? -1 : 0;
  const loserHandicapChange = scoreDifference >= 10 ? 1 : 0;

  return {
    winnerPointsChange: Math.round(baseWinnerChange),
    loserPointsChange: Math.round(baseLoserChange),
    winnerHandicapChange,
    loserHandicapChange,
  };
}

async function isAdminPlayer(playerId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('players').select('is_admin').eq('id', playerId).maybeSingle();
  return Boolean(data?.is_admin);
}

function uniq(xs: (string | null | undefined)[]) {
  return Array.from(new Set(xs.filter(Boolean))) as string[];
}

// ★列名が delta / change どっちでも動くように「存在しない列は落として再試行」
function isMissingColumnErrorMessage(msg: string, col: string) {
  const m = String(msg || '').toLowerCase();
  const c = col.toLowerCase();
  return (
    (m.includes('schema cache') && m.includes(`'${c}'`)) ||
    (m.includes('does not exist') && m.includes('column') && m.includes(c))
  );
}

async function safeUpdateMatches(matchId: string, patch: AnyBody) {
  let current = { ...patch };

  for (let i = 0; i < 12; i++) {
    const { error } = await supabaseAdmin.from('matches').update(current).eq('id', matchId);
    if (!error) return { ok: true as const };

    const msg = String(error.message || '');

    const candidates = [
      'winner_points_delta',
      'loser_points_delta',
      'winner_handicap_delta',
      'loser_handicap_delta',
      'winner_points_change',
      'loser_points_change',
      'winner_handicap_change',
      'loser_handicap_change',
      'end_reason',
      'finish_reason',
      'affects_rating',
      'time_limit_seconds',
    ];

    const missing = candidates.find((c) => c in current && isMissingColumnErrorMessage(msg, c));
    if (!missing) return { ok: false as const, message: msg };

    const { [missing]: _, ...rest } = current;
    current = rest;
  }

  return { ok: false as const, message: 'update retry exceeded' };
}

export async function POST(req: NextRequest, ctx: { params: { matchId: string } }) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json({ ok: false, message: 'Supabase 環境変数が未設定です。' }, { status: 500 });
    }

    const matchId = String(ctx?.params?.matchId ?? '').trim();
    if (!matchId) return NextResponse.json({ ok: false, message: 'matchId が不正です。' }, { status: 400 });

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
    const reporter_id = userData.user.id;

    // ここは「管理画面」なので admin 限定でOK（要件に合わせて）
    const admin = await isAdminPlayer(reporter_id);
    if (!admin) {
      return NextResponse.json({ ok: false, message: '管理者のみ実行できます。' }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as AnyBody | null;
    if (!body) return NextResponse.json({ ok: false, message: '不正なリクエストです。' }, { status: 400 });

    const winner_id = String(body.winner_id ?? '').trim();
    if (!winner_id) return NextResponse.json({ ok: false, message: '勝者を選択してください。' }, { status: 400 });

    const winner_score = clamp(toInt(body.winner_score, 15), 0, 99);
    const loser_score = clamp(toInt(body.loser_score, 0), 0, 99);
    if (winner_score <= loser_score) {
      return NextResponse.json({ ok: false, message: 'スコアが不正です（勝者 > 敗者）。' }, { status: 400 });
    }

    const end_reason = normalizeEndReason(body.end_reason ?? body.finish_reason ?? 'normal');
    const affects_rating = (() => {
      const direct = toBool(body.apply_rating ?? body.affects_rating);
      if (direct != null) return direct;
      return shouldAffectRating(end_reason);
    })();

    // 既存 match を取得（前回の変化量を巻き戻すため）
    const { data: m0, error: mErr } = await supabaseAdmin
      .from('matches')
      .select(
        [
          'id',
          'player_a_id',
          'player_b_id',
          'winner_id',
          'loser_id',
          'winner_points_delta',
          'loser_points_delta',
          'winner_handicap_delta',
          'loser_handicap_delta',
          'winner_points_change',
          'loser_points_change',
          'winner_handicap_change',
          'loser_handicap_change',
          'affects_rating',
        ].join(',')
      )
      .eq('id', matchId)
      .maybeSingle();

    if (mErr || !m0) return NextResponse.json({ ok: false, message: '試合が見つかりません。' }, { status: 404 });

    const aId = (m0 as any).player_a_id as string | null;
    const bId = (m0 as any).player_b_id as string | null;
    if (!aId || !bId) {
      return NextResponse.json({ ok: false, message: 'match の player_a_id / player_b_id が未設定です。' }, { status: 400 });
    }
    if (winner_id !== aId && winner_id !== bId) {
      return NextResponse.json({ ok: false, message: '勝者がこの試合の対戦者に含まれていません。' }, { status: 400 });
    }
    const loser_id = winner_id === aId ? bId : aId;

    const oldWinnerId = (m0 as any).winner_id as string | null;
    const oldLoserId = (m0 as any).loser_id as string | null;

    const ids = uniq([winner_id, loser_id, oldWinnerId, oldLoserId]);
    const { data: pRows, error: pErr } = await supabaseAdmin
      .from('players')
      .select('id, ranking_points, handicap, matches_played, wins, losses')
      .in('id', ids);

    if (pErr) return NextResponse.json({ ok: false, message: `プレイヤー取得に失敗しました: ${pErr.message}` }, { status: 500 });

    const pMap = new Map<string, any>();
    (pRows ?? []).forEach((p: any) => pMap.set(p.id, p));

    // ---------- 二重計算防止：前回分を巻き戻す ----------
    const hasOld = !!oldWinnerId && !!oldLoserId;
    if (hasOld) {
      const oldAffects = Boolean((m0 as any).affects_rating);

      // delta と change の両対応（どちらか入っていれば巻き戻す）
      const oldWpd = toInt((m0 as any).winner_points_delta ?? (m0 as any).winner_points_change, 0);
      const oldLpd = toInt((m0 as any).loser_points_delta ?? (m0 as any).loser_points_change, 0);
      const oldWhd = toInt((m0 as any).winner_handicap_delta ?? (m0 as any).winner_handicap_change, 0);
      const oldLhd = toInt((m0 as any).loser_handicap_delta ?? (m0 as any).loser_handicap_change, 0);

      const ow = pMap.get(oldWinnerId!);
      const ol = pMap.get(oldLoserId!);

      if (ow) {
        await supabaseAdmin
          .from('players')
          .update({
            matches_played: Math.max(0, toInt(ow.matches_played, 0) - 1),
            wins: Math.max(0, toInt(ow.wins, 0) - 1),
            ranking_points: oldAffects ? clamp(toInt(ow.ranking_points, 0) - oldWpd, 0, 99999) : toInt(ow.ranking_points, 0),
            handicap: oldAffects ? clamp(toInt(ow.handicap, 0) - oldWhd, 0, 50) : toInt(ow.handicap, 0),
          })
          .eq('id', oldWinnerId);
      }
      if (ol) {
        await supabaseAdmin
          .from('players')
          .update({
            matches_played: Math.max(0, toInt(ol.matches_played, 0) - 1),
            losses: Math.max(0, toInt(ol.losses, 0) - 1),
            ranking_points: oldAffects ? clamp(toInt(ol.ranking_points, 0) - oldLpd, 0, 99999) : toInt(ol.ranking_points, 0),
            handicap: oldAffects ? clamp(toInt(ol.handicap, 0) - oldLhd, 0, 50) : toInt(ol.handicap, 0),
          })
          .eq('id', oldLoserId);
      }

      // 取り直し
      const { data: pRows2 } = await supabaseAdmin
        .from('players')
        .select('id, ranking_points, handicap, matches_played, wins, losses')
        .in('id', ids);
      pMap.clear();
      (pRows2 ?? []).forEach((p: any) => pMap.set(p.id, p));
    }

    // ---------- 今回分を計算 ----------
    const w = pMap.get(winner_id);
    const l = pMap.get(loser_id);
    if (!w || !l) return NextResponse.json({ ok: false, message: 'プレイヤーが見つかりません。' }, { status: 400 });

    const scoreDiff = Math.max(1, winner_score - loser_score);

    const delta = affects_rating
      ? calcDelta(
          toInt(w.ranking_points, 0),
          toInt(l.ranking_points, 0),
          toInt(w.handicap, 0),
          toInt(l.handicap, 0),
          scoreDiff
        )
      : { winnerPointsChange: 0, loserPointsChange: 0, winnerHandicapChange: 0, loserHandicapChange: 0 };

    // RP/HC は affects_rating の時だけ変化、ただし勝敗/試合数は更新する（要件は RP/HCのみ無変化）
    const nextWRP = affects_rating ? clamp(toInt(w.ranking_points, 0) + delta.winnerPointsChange, 0, 99999) : toInt(w.ranking_points, 0);
    const nextLRP = affects_rating ? clamp(toInt(l.ranking_points, 0) + delta.loserPointsChange, 0, 99999) : toInt(l.ranking_points, 0);
    const nextWHC = affects_rating ? clamp(toInt(w.handicap, 0) + delta.winnerHandicapChange, 0, 50) : toInt(w.handicap, 0);
    const nextLHC = affects_rating ? clamp(toInt(l.handicap, 0) + delta.loserHandicapChange, 0, 50) : toInt(l.handicap, 0);

    await Promise.all([
      supabaseAdmin
        .from('players')
        .update({
          ranking_points: nextWRP,
          handicap: nextWHC,
          matches_played: toInt(w.matches_played, 0) + 1,
          wins: toInt(w.wins, 0) + 1,
        })
        .eq('id', winner_id),
      supabaseAdmin
        .from('players')
        .update({
          ranking_points: nextLRP,
          handicap: nextLHC,
          matches_played: toInt(l.matches_played, 0) + 1,
          losses: toInt(l.losses, 0) + 1,
        })
        .eq('id', loser_id),
    ]);

    // ---------- matches に「変化量」を保存（表示はここを読む） ----------
    const patch: AnyBody = {
      status: 'finalized',
      winner_id,
      loser_id,
      winner_score,
      loser_score,

      // ★両方書く：delta 系 / change 系 どちらに統一してても動く
      winner_points_delta: delta.winnerPointsChange,
      loser_points_delta: delta.loserPointsChange,
      winner_handicap_delta: delta.winnerHandicapChange,
      loser_handicap_delta: delta.loserHandicapChange,

      winner_points_change: delta.winnerPointsChange,
      loser_points_change: delta.loserPointsChange,
      winner_handicap_change: delta.winnerHandicapChange,
      loser_handicap_change: delta.loserHandicapChange,

      affects_rating,

      // end_reason / finish_reason も両対応
      end_reason,
      finish_reason: end_reason,
    };

    const up = await safeUpdateMatches(matchId, patch);
    if (!up.ok) {
      return NextResponse.json({ ok: false, message: `試合更新に失敗しました: ${up.message}` }, { status: 500 });
    }

    return NextResponse.json(
      {
        ok: true,
        match_id: matchId,
        end_reason,
        affects_rating,
        winner_points_change: delta.winnerPointsChange,
        loser_points_change: delta.loserPointsChange,
        winner_handicap_change: delta.winnerHandicapChange,
        loser_handicap_change: delta.loserHandicapChange,
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error('[api/matches/[id]/report] fatal:', e);
    return NextResponse.json({ ok: false, message: e?.message || 'サーバエラーが発生しました。' }, { status: 500 });
  }
}
