// app/api/matches/[matchId]/report/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: { matchId: string } }) {
  return NextResponse.json({
    ok: true,
    route: '/api/matches/[matchId]/report',
    matchId: String(ctx?.params?.matchId ?? ''),
  });
}

type AnyBody = Record<string, any>;
type EndReason = 'normal' | 'time_limit' | 'walkover' | 'forfeit';

type CookieToSet = { name: string; value: string; options?: any };

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
  scoreDifference: number,
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
  const { data, error } = await supabaseAdmin.from('players').select('is_admin').eq('id', playerId).maybeSingle();
  if (error) return false;
  return Boolean(data?.is_admin);
}

function uniq(xs: (string | null | undefined)[]) {
  return Array.from(new Set(xs.filter(Boolean))) as string[];
}

// ─────────────────────────────────────────────────────────────
// 「存在しない列」で落ちないようにするヘルパ
// ─────────────────────────────────────────────────────────────
function isMissingColumnErrorMessage(msg: string, col: string) {
  const m = String(msg || '').toLowerCase();
  const c = col.toLowerCase();
  return (
    (m.includes('schema cache') && m.includes(`'${c}'`)) ||
    (m.includes('does not exist') && m.includes('column') && m.includes(c))
  );
}

// ★列が無い場合は落として select を再試行
async function safeSelectMatch(matchId: string) {
  let cols = [
    'id',
    'mode',
    'status',
    'player_a_id',
    'player_b_id',
    'winner_id',
    'loser_id',
    'winner_player_id',
    'loser_player_id',
    'winner_points_delta',
    'loser_points_delta',
    'winner_handicap_delta',
    'loser_handicap_delta',
    'winner_points_change',
    'loser_points_change',
    'winner_handicap_change',
    'loser_handicap_change',
    'affects_rating',
    'end_reason',
    'finish_reason',
  ];

  for (let i = 0; i < 24; i++) {
    const { data, error } = await supabaseAdmin.from('matches').select(cols.join(',')).eq('id', matchId).maybeSingle();
    if (!error) return { ok: true as const, data: data as any };

    const msg = String(error.message || '');
    const missing = cols.find((c) => isMissingColumnErrorMessage(msg, c));
    if (!missing) return { ok: false as const, message: msg };

    cols = cols.filter((c) => c !== missing);
  }

  return { ok: false as const, message: 'select retry exceeded' };
}

// ★patch update も列が無ければ落として再試行
async function safeUpdateMatches(matchId: string, patch: AnyBody) {
  let current = { ...patch };

  // ※ ここが重要：status / winner / loser / score など「本体列」も候補に入れる
  const candidates = [
    'status',
    'winner_id',
    'loser_id',
    'winner_player_id',
    'loser_player_id',
    'winner_score',
    'loser_score',
    'reported_at',
    'finished_at',
    'ended_at',

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

  for (let i = 0; i < 24; i++) {
    const { error } = await supabaseAdmin.from('matches').update(current).eq('id', matchId);
    if (!error) return { ok: true as const };

    const msg = String(error.message || '');
    const missing = candidates.find((c) => c in current && isMissingColumnErrorMessage(msg, c));
    if (!missing) return { ok: false as const, message: msg };

    const { [missing]: _, ...rest } = current;
    current = rest;
  }

  return { ok: false as const, message: 'update retry exceeded' };
}

// ★対戦者の取得（matches に a/b が無ければ match_entries で拾う）
async function getParticipants(matchRow: any, matchId: string) {
  const aId = (matchRow?.player_a_id ?? null) as string | null;
  const bId = (matchRow?.player_b_id ?? null) as string | null;
  if (aId && bId) return { ok: true as const, aId, bId };

  // フォールバック：match_entries から2人取得
  const { data, error } = await supabaseAdmin.from('match_entries').select('player_id').eq('match_id', matchId);
  if (error) return { ok: false as const, message: `match_entries 取得に失敗しました: ${error.message}` };

  const ids = uniq((data ?? []).map((r: any) => r.player_id as string | null));
  if (ids.length < 2) return { ok: false as const, message: '対戦者を特定できません（match_entries が不足）' };

  return { ok: true as const, aId: ids[0], bId: ids[1] };
}

export async function POST(req: NextRequest, ctx: { params: { matchId: string } }) {
  const cookiesToSet: CookieToSet[] = [];

  const respond = (payload: any, init?: ResponseInit) => {
    const res = NextResponse.json(payload, init);
    // Supabase SSR が要求する cookie 書き戻しを Response に確実に反映
    for (const c of cookiesToSet) {
      res.cookies.set(c.name, c.value, c.options);
    }
    return res;
  };

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return respond({ ok: false, message: 'Supabase 環境変数が未設定です。' }, { status: 500 });
    }

    const matchId = String(ctx?.params?.matchId ?? '').trim();
    if (!matchId) return respond({ ok: false, message: 'matchId が不正です。' }, { status: 400 });

    const cookieStore = await cookies();

    // ★ setAll は cookieStore.set ではなく Response に集約（Route Handler で一番安定）
    const supa = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cs) {
          cookiesToSet.push(...cs);
        },
      },
    });

    const { data: userData, error: userErr } = await supa.auth.getUser();
    if (userErr || !userData?.user) {
      return respond({ ok: false, message: '認証が必要です。' }, { status: 401 });
    }
    const reporter_id = userData.user.id;

    // 管理画面想定：管理者のみ
    const admin = await isAdminPlayer(reporter_id);
    if (!admin) {
      return respond({ ok: false, message: '管理者のみ実行できます。' }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as AnyBody | null;
    if (!body) return respond({ ok: false, message: '不正なリクエストです。' }, { status: 400 });

    const winner_id = String(body.winner_id ?? '').trim();
    if (!winner_id) return respond({ ok: false, message: '勝者を選択してください。' }, { status: 400 });

    const winner_score = clamp(toInt(body.winner_score, 15), 0, 99);
    const loser_score = clamp(toInt(body.loser_score, 0), 0, 99);
    if (winner_score <= loser_score) {
      return respond({ ok: false, message: 'スコアが不正です（勝者 > 敗者）。' }, { status: 400 });
    }

    const end_reason = normalizeEndReason(body.end_reason ?? body.finish_reason ?? 'normal');
    const affects_rating = (() => {
      const direct = toBool(body.apply_rating ?? body.affects_rating);
      if (direct != null) return direct;
      return shouldAffectRating(end_reason);
    })();

    // ── 試合を取得（列が無くても落ちない） ──
    const sel = await safeSelectMatch(matchId);
    if (!sel.ok) return respond({ ok: false, message: `試合取得に失敗しました: ${sel.message}` }, { status: 500 });

    const m0 = sel.data;
    if (!m0) return respond({ ok: false, message: '試合が見つかりません。' }, { status: 404 });

    // ── 対戦者特定（a/b が無ければ match_entries） ──
    const part = await getParticipants(m0, matchId);
    if (!part.ok) return respond({ ok: false, message: part.message }, { status: 400 });

    const aId = part.aId;
    const bId = part.bId;

    if (winner_id !== aId && winner_id !== bId) {
      return respond({ ok: false, message: '勝者がこの試合の対戦者に含まれていません。' }, { status: 400 });
    }
    const loser_id = winner_id === aId ? bId : aId;

    const oldWinnerId =
      (m0 as any).winner_id ?? (m0 as any).winner_player_id ?? null;
    const oldLoserId =
      (m0 as any).loser_id ?? (m0 as any).loser_player_id ?? null;

    // ── プレイヤー取得 ──
    const ids = uniq([winner_id, loser_id, oldWinnerId, oldLoserId]);
    const { data: pRows, error: pErr } = await supabaseAdmin
      .from('players')
      .select('id, ranking_points, handicap, matches_played, wins, losses')
      .in('id', ids);

    if (pErr) return respond({ ok: false, message: `プレイヤー取得に失敗しました: ${pErr.message}` }, { status: 500 });

    const pMap = new Map<string, any>();
    (pRows ?? []).forEach((p: any) => pMap.set(p.id, p));

    // ─────────────────────────────────────────────
    // 二重計算防止：前回分を巻き戻す（存在する場合）
    // ─────────────────────────────────────────────
    const hasOld = !!oldWinnerId && !!oldLoserId;
    if (hasOld) {
      const oldAffects = Boolean((m0 as any).affects_rating);

      // delta と change の両対応（片方しか無くても動く）
      const oldWpd = toInt((m0 as any).winner_points_delta ?? (m0 as any).winner_points_change, 0);
      const oldLpd = toInt((m0 as any).loser_points_delta ?? (m0 as any).loser_points_change, 0);
      const oldWhd = toInt((m0 as any).winner_handicap_delta ?? (m0 as any).winner_handicap_change, 0);
      const oldLhd = toInt((m0 as any).loser_handicap_delta ?? (m0 as any).loser_handicap_change, 0);

      const ow = pMap.get(oldWinnerId!);
      const ol = pMap.get(oldLoserId!);

      if (ow) {
        const { error } = await supabaseAdmin
          .from('players')
          .update({
            matches_played: Math.max(0, toInt(ow.matches_played, 0) - 1),
            wins: Math.max(0, toInt(ow.wins, 0) - 1),
            ranking_points: oldAffects
              ? clamp(toInt(ow.ranking_points, 0) - oldWpd, 0, 99999)
              : toInt(ow.ranking_points, 0),
            handicap: oldAffects
              ? clamp(toInt(ow.handicap, 0) - oldWhd, 0, 50)
              : toInt(ow.handicap, 0),
          })
          .eq('id', oldWinnerId);
        if (error) return respond({ ok: false, message: `巻き戻し(勝者)に失敗しました: ${error.message}` }, { status: 500 });
      }

      if (ol) {
        const { error } = await supabaseAdmin
          .from('players')
          .update({
            matches_played: Math.max(0, toInt(ol.matches_played, 0) - 1),
            losses: Math.max(0, toInt(ol.losses, 0) - 1),
            ranking_points: oldAffects
              ? clamp(toInt(ol.ranking_points, 0) - oldLpd, 0, 99999)
              : toInt(ol.ranking_points, 0),
            handicap: oldAffects
              ? clamp(toInt(ol.handicap, 0) - oldLhd, 0, 50)
              : toInt(ol.handicap, 0),
          })
          .eq('id', oldLoserId);
        if (error) return respond({ ok: false, message: `巻き戻し(敗者)に失敗しました: ${error.message}` }, { status: 500 });
      }

      // 取り直し（以降の計算用に最新化）
      const { data: pRows2, error: pErr2 } = await supabaseAdmin
        .from('players')
        .select('id, ranking_points, handicap, matches_played, wins, losses')
        .in('id', ids);
      if (pErr2) return respond({ ok: false, message: `巻き戻し後の再取得に失敗しました: ${pErr2.message}` }, { status: 500 });

      pMap.clear();
      (pRows2 ?? []).forEach((p: any) => pMap.set(p.id, p));
    }

    // ─────────────────────────────────────────────
    // 今回分を計算
    // ─────────────────────────────────────────────
    const w = pMap.get(winner_id);
    const l = pMap.get(loser_id);
    if (!w || !l) return respond({ ok: false, message: 'プレイヤーが見つかりません。' }, { status: 400 });

    const scoreDiff = Math.max(1, winner_score - loser_score);

    const delta = affects_rating
      ? calcDelta(
          toInt(w.ranking_points, 0),
          toInt(l.ranking_points, 0),
          toInt(w.handicap, 0),
          toInt(l.handicap, 0),
          scoreDiff,
        )
      : { winnerPointsChange: 0, loserPointsChange: 0, winnerHandicapChange: 0, loserHandicapChange: 0 };

    const nextWRP = affects_rating
      ? clamp(toInt(w.ranking_points, 0) + delta.winnerPointsChange, 0, 99999)
      : toInt(w.ranking_points, 0);
    const nextLRP = affects_rating
      ? clamp(toInt(l.ranking_points, 0) + delta.loserPointsChange, 0, 99999)
      : toInt(l.ranking_points, 0);
    const nextWHC = affects_rating
      ? clamp(toInt(w.handicap, 0) + delta.winnerHandicapChange, 0, 50)
      : toInt(w.handicap, 0);
    const nextLHC = affects_rating
      ? clamp(toInt(l.handicap, 0) + delta.loserHandicapChange, 0, 50)
      : toInt(l.handicap, 0);

    const [upW, upL] = await Promise.all([
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

    if (upW.error) return respond({ ok: false, message: `勝者更新に失敗しました: ${upW.error.message}` }, { status: 500 });
    if (upL.error) return respond({ ok: false, message: `敗者更新に失敗しました: ${upL.error.message}` }, { status: 500 });

    // ─────────────────────────────────────────────
    // matches に「結果 + 変化量」を保存
    // ─────────────────────────────────────────────
    const basePatch: AnyBody = {
      // status は制約があり得るので後で候補を回す
      winner_id,
      loser_id,
      winner_player_id: winner_id, // 別名列がある環境に対応（safeUpdate が無い列は落とす）
      loser_player_id: loser_id,
      winner_score,
      loser_score,

      // delta / change 両対応で書く（どちらかが無くても safeUpdate で落とす）
      winner_points_delta: delta.winnerPointsChange,
      loser_points_delta: delta.loserPointsChange,
      winner_handicap_delta: delta.winnerHandicapChange,
      loser_handicap_delta: delta.loserHandicapChange,

      winner_points_change: delta.winnerPointsChange,
      loser_points_change: delta.loserPointsChange,
      winner_handicap_change: delta.winnerHandicapChange,
      loser_handicap_change: delta.loserHandicapChange,

      affects_rating,

      // end_reason / finish_reason 両対応
      end_reason,
      finish_reason: end_reason,
    };

    // status が enum/制約で弾かれるケースに備えて候補で回す
    const statusCandidates = ['finalized', 'finished', 'done', 'complete'];

    let lastUpdateError: string | null = null;
    for (const st of statusCandidates) {
      const patch = { ...basePatch, status: st };
      const up = await safeUpdateMatches(matchId, patch);
      if (up.ok) {
        return respond(
          {
            ok: true,
            match_id: matchId,
            end_reason,
            affects_rating,
            status: st,
            winner_points_change: delta.winnerPointsChange,
            loser_points_change: delta.loserPointsChange,
            winner_handicap_change: delta.winnerHandicapChange,
            loser_handicap_change: delta.loserHandicapChange,
          },
          { status: 200 },
        );
      }
      lastUpdateError = up.message;
    }

    return respond({ ok: false, message: `試合更新に失敗しました: ${lastUpdateError ?? 'unknown'}` }, { status: 500 });
  } catch (e: any) {
    console.error('[api/matches/[matchId]/report] fatal:', e);
    return NextResponse.json({ ok: false, message: e?.message || 'サーバエラーが発生しました。' }, { status: 500 });
  }
}
