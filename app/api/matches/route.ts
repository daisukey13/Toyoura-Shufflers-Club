// app/api/matches/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AnyBody = Record<string, any>;

// ★walkover を追加（不戦勝）
type FinishReason = 'normal' | 'time_limit' | 'walkover' | 'forfeit' | string;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const toInt = (v: unknown, fallback = 0) => {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
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

function inferMode(body: AnyBody): 'singles' | 'teams' | null {
  const raw = String(body?.mode ?? '').trim().toLowerCase();
  if (raw) {
    if (raw.startsWith('team')) return 'teams';
    if (raw.startsWith('sing') || raw === 'single' || raw === 'player') return 'singles';
  }
  if (body?.winner_team_id || body?.loser_team_id) return 'teams';
  if (body?.winner_id || body?.loser_id) return 'singles';
  if (body?.opponent_id != null || body?.i_won != null) return 'singles';
  return null;
}

// ★finish_reason / end_reason を受け、DBに両方入れても壊れないようにする
function normalizeFinishReason(body: AnyBody): FinishReason {
  const r = String(body?.finish_reason ?? body?.end_reason ?? 'normal').trim().toLowerCase();
  return r || 'normal';
}

function normalizeApplyRating(body: AnyBody, finishReason: FinishReason): boolean {
  const direct = toBool(body?.apply_rating);
  if (direct != null) return direct;

  const affects = toBool(body?.affects_rating);
  if (affects != null) return affects;

  // 既存仕様：time_limit / walkover / forfeit はレート反映しない
  if (['time_limit', 'walkover', 'forfeit'].includes(String(finishReason).toLowerCase())) return false;

  return true;
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

async function ensureReporterPlayer(reporterId: string, displayName: string | null) {
  const { data } = await supabaseAdmin.from('players').select('id').eq('id', reporterId).maybeSingle();
  if (data) return;

  const baseName = (displayName || '').trim();
  const handle_name = baseName || `user_${reporterId.slice(0, 8)}`;
  const { error } = await supabaseAdmin.from('players').upsert(
    {
      id: reporterId,
      handle_name,
      ranking_points: 1000,
      handicap: 0,
      matches_played: 0,
      wins: 0,
      losses: 0,
    },
    { onConflict: 'id' }
  );
  if (error) throw new Error(`reporter の players 作成に失敗: ${error.message}`);
}

async function isAdminPlayer(playerId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('players').select('is_admin').eq('id', playerId).maybeSingle();
  return Boolean(data?.is_admin);
}

async function isMemberOfTeam(playerId: string, teamId: string): Promise<boolean> {
  const candidates = [
    { table: 'team_members', playerCol: 'player_id', teamCol: 'team_id' },
    { table: 'players_teams', playerCol: 'player_id', teamCol: 'team_id' },
    { table: 'team_players', playerCol: 'player_id', teamCol: 'team_id' },
    { table: 'memberships', playerCol: 'player_id', teamCol: 'team_id' },
  ] as const;

  for (const c of candidates) {
    const { data, error } = await supabaseAdmin
      .from(c.table)
      .select('team_id')
      .eq(c.playerCol, playerId)
      .eq(c.teamCol, teamId)
      .limit(1);
    if (!error && data && data.length > 0) return true;
  }
  return false;
}

/**
 * ★end_reason / time_limit_seconds / tournament_id が無いスキーマでも落ちないようにする
 */
function isMissingColumnErrorMessage(msg: string, col: string) {
  const m = msg.toLowerCase();
  const c = col.toLowerCase();
  return (
    (m.includes('schema cache') && m.includes(`'${c}'`)) ||
    (m.includes('does not exist') && m.includes(c) && m.includes('column'))
  );
}

function omitField(row: AnyBody, key: string): AnyBody {
  const next = { ...row };
  delete next[key];
  return next;
}

async function insertMatchWithOptionalFields(row: AnyBody) {
  const tryInsert = async (r: AnyBody) => await supabaseAdmin.from('matches').insert(r).select('id').single();

  let current: AnyBody = { ...row };
  let first = await tryInsert(current);
  if (!first.error) return first;

  const msg1 = String(first.error.message || '');

  if (isMissingColumnErrorMessage(msg1, 'tournament_id')) {
    current = omitField(current, 'tournament_id');
    first = await tryInsert(current);
    if (!first.error) return first;
  }

  const msg2 = String(first.error?.message || '');

  if (isMissingColumnErrorMessage(msg2, 'end_reason')) {
    current = omitField(current, 'end_reason');
    first = await tryInsert(current);
    if (!first.error) return first;
  }

  const msg3 = String(first.error?.message || '');

  if (isMissingColumnErrorMessage(msg3, 'time_limit_seconds')) {
    current = omitField(current, 'time_limit_seconds');
    first = await tryInsert(current);
    if (!first.error) return first;
  }

  return first;
}

/** mode の CHECK 制約に当たった時だけ、別候補でリトライする */
async function insertMatchWithModeFallback(baseRow: AnyBody, modeCandidates: string[]) {
  let last: any = null;

  for (const m of modeCandidates) {
    const { data, error } = await insertMatchWithOptionalFields({ ...baseRow, mode: m });
    if (!error) return { data, error: null, used_mode: m };

    last = error;
    const msg = String(error.message || '');
    if (msg.includes('matches_mode_check')) continue;
    break;
  }
  return { data: null, error: last, used_mode: null };
}

export async function POST(req: NextRequest) {
  try {
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
            cookieStore.set({
              name,
              value,
              ...(options || {}),
              path: options?.path ?? '/',
            } as any);
          },
          remove(name: string, options?: any) {
            cookieStore.set({
              name,
              value: '',
              ...(options || {}),
              path: options?.path ?? '/',
              maxAge: 0,
            } as any);
          },
        },
      } as any
    );

    const { data: userData, error: userErr } = await supa.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, message: '認証が必要です。' }, { status: 401 });
    }

    const reporter_id = userData.user.id;
    await ensureReporterPlayer(
      reporter_id,
      (userData.user.user_metadata?.name as string | undefined) ||
        (userData.user.email as string | undefined) ||
        null
    );

    const admin = await isAdminPlayer(reporter_id);

    const body = (await req.json().catch(() => null)) as AnyBody | null;
    if (!body) {
      return NextResponse.json({ ok: false, message: '不正なリクエストです。' }, { status: 400 });
    }

    const inferred = inferMode(body);
    if (!inferred) {
      return NextResponse.json({ ok: false, message: '不正なリクエストです。' }, { status: 400 });
    }

    const match_date = String(body.match_date || '').trim();
    if (!match_date) {
      return NextResponse.json({ ok: false, message: '試合日時が未指定です。' }, { status: 400 });
    }

    const winner_score = clamp(toInt(body.winner_score, 15) || 15, 0, 99);
    const loser_score = clamp(toInt(body.loser_score, 0), 0, 99);
    if (winner_score <= loser_score) {
      return NextResponse.json({ ok: false, message: 'スコアが不正です。' }, { status: 400 });
    }

    const finish_reason = normalizeFinishReason(body);
    const apply_rating = normalizeApplyRating(body, finish_reason);
    const tournament_id = body.tournament_id ? String(body.tournament_id) : null;

    const time_limit_seconds =
      body.time_limit_seconds != null && String(finish_reason).toLowerCase() === 'time_limit'
        ? clamp(toInt(body.time_limit_seconds, 0), 0, 24 * 60 * 60)
        : null;

    // ===================== Singles =====================
    if (inferred === 'singles') {
      let winner_id = body.winner_id ? String(body.winner_id) : '';
      let loser_id = body.loser_id ? String(body.loser_id) : '';

      if ((!winner_id || !loser_id) && body.opponent_id != null && body.i_won != null) {
        const opp = String(body.opponent_id);
        const iWon = Boolean(body.i_won);
        winner_id = iWon ? reporter_id : opp;
        loser_id = iWon ? opp : reporter_id;
      }

      if (!winner_id || !loser_id) {
        return NextResponse.json({ ok: false, message: '勝者/敗者を選択してください。' }, { status: 400 });
      }
      if (winner_id === loser_id) {
        return NextResponse.json({ ok: false, message: '同一プレイヤーは選べません。' }, { status: 400 });
      }

      if (!admin && reporter_id !== winner_id && reporter_id !== loser_id) {
        return NextResponse.json(
          { ok: false, message: '自分が出場した試合のみ登録できます（管理者は除外）。' },
          { status: 403 }
        );
      }

      const { data: players, error: pErr } = await supabaseAdmin
        .from('players')
        .select('id, ranking_points, handicap, matches_played, wins, losses')
        .in('id', [winner_id, loser_id]);

      if (pErr) {
        return NextResponse.json({ ok: false, message: `プレイヤー取得に失敗しました: ${pErr.message}` }, { status: 500 });
      }

      const w = players?.find((p) => p.id === winner_id);
      const l = players?.find((p) => p.id === loser_id);
      if (!w || !l) {
        return NextResponse.json({ ok: false, message: 'プレイヤーが見つかりません。' }, { status: 400 });
      }

      const scoreDiff = Math.max(1, winner_score - loser_score);
      const delta = apply_rating
        ? calcDelta(
            toInt(w.ranking_points, 0),
            toInt(l.ranking_points, 0),
            toInt(w.handicap, 0),
            toInt(l.handicap, 0),
            scoreDiff
          )
        : { winnerPointsChange: 0, loserPointsChange: 0, winnerHandicapChange: 0, loserHandicapChange: 0 };

      const baseRow: AnyBody = {
        status: 'finalized',
        match_date,
        reporter_id,
        winner_id,
        loser_id,
        winner_score,
        loser_score,

        winner_team_no: 0,
        loser_team_no: 0,

        winner_points_delta: delta.winnerPointsChange,
        loser_points_delta: delta.loserPointsChange,
        winner_handicap_delta: delta.winnerHandicapChange,
        loser_handicap_delta: delta.loserHandicapChange,

        finish_reason,
        end_reason: finish_reason,
        time_limit_seconds,

        affects_rating: apply_rating,
      };
      if (tournament_id) baseRow.tournament_id = tournament_id;

      const modeCandidates = ['singles', 'single', 'player'];
      const { data: ins, error: mErr, used_mode } = await insertMatchWithModeFallback(baseRow, modeCandidates);

      if (mErr || !ins?.id) {
        return NextResponse.json(
          { ok: false, message: `登録に失敗しました: ${mErr?.message || 'match_id 不明'}` },
          { status: 500 }
        );
      }

      const wRP0 = toInt(w.ranking_points, 0);
      const lRP0 = toInt(l.ranking_points, 0);
      const wHC0 = toInt(w.handicap, 0);
      const lHC0 = toInt(l.handicap, 0);

      const nextWRP = apply_rating ? clamp(wRP0 + delta.winnerPointsChange, 0, 99999) : wRP0;
      const nextLRP = apply_rating ? clamp(lRP0 + delta.loserPointsChange, 0, 99999) : lRP0;
      const nextWHC = apply_rating ? clamp(wHC0 + delta.winnerHandicapChange, 0, 50) : wHC0;
      const nextLHC = apply_rating ? clamp(lHC0 + delta.loserHandicapChange, 0, 50) : lHC0;

      const [uw, ul] = await Promise.all([
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

      if (uw.error) console.warn('[matches API] winner update warning:', uw.error);
      if (ul.error) console.warn('[matches API] loser  update warning:', ul.error);

      return NextResponse.json(
        {
          ok: true,
          match_id: ins.id,
          db_mode: used_mode,
          winner_points_delta: delta.winnerPointsChange,
          loser_points_delta: delta.loserPointsChange,
          winner_handicap_delta: delta.winnerHandicapChange,
          loser_handicap_delta: delta.loserHandicapChange,
          affects_rating: apply_rating,
          finish_reason,
          end_reason: finish_reason,
          time_limit_seconds,
        },
        { status: 201 }
      );
    }

    // ===================== Teams =====================
    {
      const winner_team_id = String(body.winner_team_id || '');
      const loser_team_id = String(body.loser_team_id || '');
      if (!winner_team_id || !loser_team_id) {
        return NextResponse.json({ ok: false, message: '勝利チーム/敗北チームを選択してください。' }, { status: 400 });
      }
      if (winner_team_id === loser_team_id) {
        return NextResponse.json({ ok: false, message: '同一チームは選べません。' }, { status: 400 });
      }

      if (!admin) {
        const ok =
          (await isMemberOfTeam(reporter_id, winner_team_id)) || (await isMemberOfTeam(reporter_id, loser_team_id));
        if (!ok) {
          return NextResponse.json(
            { ok: false, message: '所属チームの試合のみ登録できます（管理者は除外）。' },
            { status: 403 }
          );
        }
      }

      const baseRow: AnyBody = {
        status: 'finalized',
        match_date,
        reporter_id,
        winner_score,
        loser_score,
        winner_team_no: 1,
        loser_team_no: 2,

        finish_reason,
        end_reason: finish_reason,
        time_limit_seconds,

        affects_rating: apply_rating,
      };
      if (tournament_id) baseRow.tournament_id = tournament_id;

      const modeCandidates = ['teams', 'team'];
      const { data: ins, error: mErr, used_mode } = await insertMatchWithModeFallback(baseRow, modeCandidates);

      if (mErr || !ins?.id) {
        return NextResponse.json(
          { ok: false, message: `登録に失敗しました: ${mErr?.message || 'match_id 不明'}` },
          { status: 500 }
        );
      }

      const { error: mtErr } = await supabaseAdmin.from('match_teams').insert([
        { match_id: ins.id, team_id: winner_team_id, team_no: 1 },
        { match_id: ins.id, team_id: loser_team_id, team_no: 2 },
      ]);

      if (mtErr) {
        await supabaseAdmin.from('matches').delete().eq('id', ins.id);
        return NextResponse.json({ ok: false, message: `チーム割当の登録に失敗しました: ${mtErr.message}` }, { status: 500 });
      }

      return NextResponse.json(
        { ok: true, match_id: ins.id, db_mode: used_mode, finish_reason, end_reason: finish_reason, time_limit_seconds },
        { status: 201 }
      );
    }
  } catch (e: any) {
    console.error('[api/matches] fatal:', e);
    return NextResponse.json({ ok: false, message: 'サーバエラーが発生しました。' }, { status: 500 });
  }
}

/**
 * NOTE:
 * あなたの「結果入力」画面は /api/matches/[id]/report に POST しています。
 * そこ（route.ts）側でも body.end_reason を受け、matches を update するときに
 * end_reason（と必要なら time_limit_seconds）を保存する必要があります。
 */
