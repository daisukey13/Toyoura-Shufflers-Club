// app/api/matches/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ===================== Types ===================== */
type SinglesPayload = {
  mode: string; // 'singles' | 'single' | 'player' など
  match_date: string;
  winner_id: string;
  loser_id: string;
  winner_score?: number; // 省略時 15 固定
  loser_score: number;   // 0〜14
  venue?: string | null;
  notes?: string | null;
  apply_rating?: boolean; // 省略時 true
};

type TeamsPayload = {
  mode: string; // 'teams' | 'team' 等
  match_date: string;
  winner_team_id: string;
  loser_team_id: string;
  winner_score?: number; // 省略時 15 固定
  loser_score: number;   // 0〜14
  venue?: string | null;
  notes?: string | null;
};

type Body = SinglesPayload | TeamsPayload;

/* ===================== Helpers ===================== */
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const toInt = (v: unknown, fallback = 0) => {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
};

function isPgCode(err: unknown, code: string) {
  const msg = String((err as any)?.message ?? (err as any)?.code ?? err ?? '');
  return msg.includes(code);
}

/** ELO 風の変動（個人戦のみ） */
function calcDelta(
  winnerPoints: number,
  loserPoints: number,
  winnerHandicap: number,
  loserHandicap: number,
  scoreDifference: number // 15 - loser_score
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

/** reporter の FK を満たすため、players に無ければ最小の行を作る */
async function ensureReporterPlayer(reporterId: string, displayName: string | null) {
  const { data } = await supabaseAdmin
    .from('players')
    .select('id')
    .eq('id', reporterId)
    .maybeSingle();
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
      is_active: true,
      is_admin: false,
    },
    { onConflict: 'id' }
  );
  if (error) throw new Error(`reporter の players 作成に失敗: ${error.message}`);
}

/** reporter が admin かどうか（無ければ false 扱い） */
async function isAdminPlayer(playerId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', playerId)
    .maybeSingle();
  return Boolean(data?.is_admin);
}

/** reporter がそのチームのメンバーか */
async function isMemberOfTeam(playerId: string, teamId: string): Promise<boolean> {
  const candidates = [
    { table: 'team_members', playerCol: 'player_id', teamCol: 'team_id' },
    { table: 'players_teams', playerCol: 'player_id', teamCol: 'team_id' },
    { table: 'team_players', playerCol: 'player_id', teamCol: 'team_id' },
    { table: 'memberships',  playerCol: 'player_id', teamCol: 'team_id' },
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

/** matches.insert を venue / notes あり→ダメなら無しでフォールバック */
async function insertMatchWithFallback(
  row: Record<string, any>
): Promise<{ id: string }> {
  // 1st trial: そのまま
  let q = supabaseAdmin.from('matches').insert(row).select('id').single();
  let r = await q;
  if (!r.error && r.data) return { id: r.data.id as string };

  // venue / notes が無いスキーマなどのため再試行（フィールド削除）
  const trimmed = { ...row };
  delete trimmed.venue;
  delete trimmed.notes;

  q = supabaseAdmin.from('matches').insert(trimmed).select('id').single();
  r = await q;
  if (!r.error && r.data) return { id: r.data.id as string };

  // それでもダメなら元エラーをそのまま投げる
  throw new Error(r.error?.message || 'matches への INSERT に失敗しました');
}

/** match_teams が無いスキーマ向けフォールバック（matches にチームIDを直置き） */
async function fallbackWriteTeamsIntoMatches(
  matchId: string,
  winner_team_id: string,
  loser_team_id: string
) {
  // まずは素直に両カラムを UPDATE 試行
  let u = await supabaseAdmin
    .from('matches')
    .update({ winner_team_id, loser_team_id })
    .eq('id', matchId);
  if (!u.error) return true;

  // 片側ずつ入るケースにも念のため対応
  await supabaseAdmin.from('matches').update({ winner_team_id }).eq('id', matchId);
  await supabaseAdmin.from('matches').update({ loser_team_id }).eq('id', matchId);

  // ここでエラーが出ても致命ではないので true を返す（ビュー側で join が組める場合が多いため）
  return true;
}

/* ===================== Handler ===================== */
export async function POST(req: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json({ ok: false, message: 'Supabase 環境変数が未設定です。' }, { status: 500 });
    }

    // 1) 認証（reporter_id をサーバ側で確定）
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
            // API Route なら書き込みOK（Set-Cookie 付与）
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
    await ensureReporterPlayer(
      reporter_id,
      (userData.user.user_metadata?.name as string | undefined) ||
        (userData.user.email as string | undefined) ||
        null
    );

    const admin = await isAdminPlayer(reporter_id);

    // 2) 入力
    const body = (await req.json().catch(() => null)) as Partial<Body> | null;
    if (!body || !body.mode) {
      return NextResponse.json({ ok: false, message: '不正なリクエストです。' }, { status: 400 });
    }

    const rawMode = String(body.mode).trim();
    const match_date = String(body.match_date || '').trim();
    if (!match_date) {
      return NextResponse.json({ ok: false, message: '試合日時が未指定です。' }, { status: 400 });
    }
    const winner_score = clamp(toInt((body as any).winner_score, 15) || 15, 0, 99);
    const loser_score  = clamp(toInt((body as any).loser_score, 0), 0, 14);
    const venue = (body as any).venue ?? null;
    const notes = (body as any).notes ?? null;

    /* ======================================================================
     * シングル戦（DBの mode は固定で 'player'）
     * ==================================================================== */
    if (/^sing/i.test(rawMode) || /^single$/i.test(rawMode) || /^player$/i.test(rawMode)) {
      const winner_id = String((body as SinglesPayload).winner_id || '');
      const loser_id  = String((body as SinglesPayload).loser_id  || '');
      if (!winner_id || !loser_id) {
        return NextResponse.json({ ok: false, message: '勝者/敗者を選択してください。' }, { status: 400 });
      }
      if (winner_id === loser_id) {
        return NextResponse.json({ ok: false, message: '同一プレイヤーは選べません。' }, { status: 400 });
      }

      // 一般ユーザーは自分が出場した試合のみ登録可（管理者は除外）
      if (!admin && reporter_id !== winner_id && reporter_id !== loser_id) {
        return NextResponse.json(
          { ok: false, message: '自分が出場した試合のみ登録できます（管理者は除外）。' },
          { status: 403 }
        );
      }

      // レーティング計算のために現在値を取得
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

      // INSERT（venue / notes は存在しない場合もあるのでフォールバック内で調整）
      let matchId: string;
      try {
        const row = {
          mode: 'player',
          status: 'finalized',
          match_date,
          reporter_id,
          winner_id,
          loser_id,
          winner_score,
          loser_score,
          winner_team_no: 0,
          loser_team_no: 0,
          venue,
          notes,
        };
        const ins = await insertMatchWithFallback(row);
        matchId = ins.id;
      } catch (e: any) {
        return NextResponse.json({ ok: false, message: `登録に失敗しました: ${e.message || e}` }, { status: 500 });
      }

      // レーティング反映（省略時 true）
      const apply = (body as SinglesPayload).apply_rating ?? true;
      if (apply) {
        const diff = 15 - loser_score;
        const delta = calcDelta(
          toInt(w.ranking_points, 0),
          toInt(l.ranking_points, 0),
          toInt(w.handicap, 0),
          toInt(l.handicap, 0),
          diff
        );

        const [uw, ul] = await Promise.all([
          supabaseAdmin
            .from('players')
            .update({
              ranking_points: clamp(toInt(w.ranking_points, 0) + delta.winnerPointsChange, 0, 99999),
              handicap: clamp(toInt(w.handicap, 0) + delta.winnerHandicapChange, 0, 50),
              matches_played: toInt(w.matches_played, 0) + 1,
              wins: toInt(w.wins, 0) + 1,
            })
            .eq('id', winner_id),
          supabaseAdmin
            .from('players')
            .update({
              ranking_points: clamp(toInt(l.ranking_points, 0) + delta.loserPointsChange, 0, 99999),
              handicap: clamp(toInt(l.handicap, 0) + delta.loserHandicapChange, 0, 50),
              matches_played: toInt(l.matches_played, 0) + 1,
              losses: toInt(l.losses, 0) + 1,
            })
            .eq('id', loser_id),
        ]);
        if (uw.error) console.warn('[matches API] winner update warning:', uw.error);
        if (ul.error) console.warn('[matches API] loser  update warning:', ul.error);
      }

      return NextResponse.json({ ok: true, match_id: matchId }, { status: 201 });
    }

    /* ======================================================================
     * チーム戦（DBの mode は固定で 'teams'）
     * ==================================================================== */
    {
      const winner_team_id = String((body as TeamsPayload).winner_team_id || '');
      const loser_team_id  = String((body as TeamsPayload).loser_team_id  || '');
      if (!winner_team_id || !loser_team_id) {
        return NextResponse.json({ ok: false, message: '勝利チーム/敗北チームを選択してください。' }, { status: 400 });
      }
      if (winner_team_id === loser_team_id) {
        return NextResponse.json({ ok: false, message: '同一チームは選べません。' }, { status: 400 });
      }

      // 一般ユーザーは所属チームの試合のみ登録可（管理者は除外）
      if (!admin) {
        const ok =
          (await isMemberOfTeam(reporter_id, winner_team_id)) ||
          (await isMemberOfTeam(reporter_id, loser_team_id));
        if (!ok) {
          return NextResponse.json(
            { ok: false, message: '所属チームの試合のみ登録できます（管理者は除外）。' },
            { status: 403 }
          );
        }
      }

      // 1) matches にレコード作成（venue / notes はフォールバック対応）
      let matchId: string;
      try {
        const row = {
          mode: 'teams',
          status: 'finalized',
          match_date,
          reporter_id,
          winner_score,
          loser_score,
          winner_team_no: 1,
          loser_team_no: 2,
          venue,
          notes,
        };
        const ins = await insertMatchWithFallback(row);
        matchId = ins.id;
      } catch (e: any) {
        return NextResponse.json({ ok: false, message: `登録に失敗しました: ${e.message || e}` }, { status: 500 });
      }

      // 2) match_teams があるスキーマ：2行 INSERT
      //    無いスキーマ：matches に team_id 直置きでフォールバック
      const mtInsert = await supabaseAdmin.from('match_teams').insert([
        { match_id: matchId, team_id: winner_team_id, team_no: 1 },
        { match_id: matchId, team_id: loser_team_id,  team_no: 2 },
      ]);
      if (mtInsert.error) {
        // テーブルが無い / 列が無い → フォールバック UPDATE
        if (isPgCode(mtInsert.error, '42P01') /* relation does not exist */ ||
            isPgCode(mtInsert.error, '42703') /* undefined column */) {
          await fallbackWriteTeamsIntoMatches(matchId, winner_team_id, loser_team_id);
        } else {
          // それ以外のエラーは整合性重視でロールバック
          await supabaseAdmin.from('matches').delete().eq('id', matchId);
          return NextResponse.json(
            { ok: false, message: `チーム割当の登録に失敗しました: ${mtInsert.error.message}` },
            { status: 500 }
          );
        }
      }

      return NextResponse.json({ ok: true, match_id: matchId }, { status: 201 });
    }
  } catch (e: any) {
    console.error('[api/matches] fatal:', e);
    return NextResponse.json({ ok: false, message: 'サーバエラーが発生しました。' }, { status: 500 });
  }
}
