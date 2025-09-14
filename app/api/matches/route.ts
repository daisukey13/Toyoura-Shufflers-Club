// app/api/matches/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ===================== Types ===================== */
type SinglesPayload = {
  mode: 'singles' | 'single' | string;
  match_date: string;
  winner_id: string;
  loser_id: string;
  loser_score: number; // 0〜14
  venue?: string | null;
  notes?: string | null;
  apply_rating?: boolean; // 省略時 true
};

type TeamsPayload = {
  mode: 'teams' | 'team' | string;
  match_date: string;
  winner_team_id: string;
  loser_team_id: string;
  loser_score: number; // 0〜14
  venue?: string | null;
  notes?: string | null;
};

type Body = SinglesPayload | TeamsPayload;

/* ===================== Helpers ===================== */
const uniq = <T,>(arr: T[]) => Array.from(new Set(arr));

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const toInt = (v: unknown, fallback = 0) => {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
};

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

/** 既存の singles 行から mode ラベルを推定（fallback に 'player' も追加） */
async function detectSinglesModeLabels() {
  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('mode')
    .not('winner_id', 'is', null)
    .limit(20);
  if (error) return ['player', 'singles', 'single', 'SINGLES', 'SINGLE'];
  const labels = uniq((data ?? []).map((r: any) => String(r.mode)).filter(Boolean));
  return labels.length ? labels : ['player', 'singles', 'single', 'SINGLES', 'SINGLE'];
}

/** 既存の行から status ラベルを推定 */
async function detectStatusLabels() {
  const { data, error } = await supabaseAdmin.from('matches').select('status').limit(20);
  if (error) return ['finalized', 'finished', 'completed', 'FINALIZED', 'FINISHED', 'COMPLETED'];
  const labels = uniq((data ?? []).map((r: any) => String(r.status)).filter(Boolean));
  return labels.length ? labels : ['finalized', 'finished', 'completed', 'FINALIZED', 'FINISHED', 'COMPLETED'];
}

/** 既存の行から team 系の mode ラベルを推定（安全に全体から拾い、/team|double/ を優先） */
async function detectTeamsModeLabels() {
  const { data, error } = await supabaseAdmin.from('matches').select('mode').limit(50);
  if (error) return ['teams', 'team', 'TEAMS', 'TEAM', 'doubles', 'DOUBLES'];
  const all = uniq((data ?? []).map((r: any) => String(r.mode)).filter(Boolean));
  const teamish = all.filter((m) => /team|double/i.test(m));
  return teamish.length ? teamish : ['teams', 'team', 'TEAMS', 'TEAM', 'doubles', 'DOUBLES'];
}

/** mode 候補 × status 候補で順に insert を試す（未知カラムは一切含めない） */
async function tryInsertFlexible(
  rowBase: Record<string, any>,
  modeCandidates: string[],
  statusCandidates: string[]
) {
  let lastErr: any = null;
  for (const mode of modeCandidates) {
    for (const status of statusCandidates) {
      const { data, error } = await supabaseAdmin
        .from('matches')
        .insert({ ...rowBase, mode, status })
        .select('id')
        .single();
      if (!error) return { data, error: null as any, used: { mode, status } };
      lastErr = error;
    }
  }
  return { data: null as any, error: lastErr, used: null as any };
}

/** reporter の FK 満たすため、players に無ければ最小の行を作る */
async function ensureReporterPlayer(reporterId: string, displayName: string | null) {
  const { data } = await supabaseAdmin
    .from('players')
    .select('id')
    .eq('id', reporterId)
    .maybeSingle();
  if (data) return;

  const handle_name = (displayName || '').trim() || `user_${reporterId.slice(0, 8)}`;
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
            cookieStore.set(name, value, options as any);
          },
          remove(name: string, options?: any) {
            cookieStore.set(name, '', options as any);
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
    const loser_score = clamp(toInt((body as any).loser_score, 0), 0, 14);

    const statusCandidates = await detectStatusLabels();

    /* -------------------- 個人戦（DB は通常 'player'） -------------------- */
    if (/^sing/i.test(rawMode) || /^single$/i.test(rawMode)) {
      const modeCandidates = await detectSinglesModeLabels();

      const winner_id = String((body as SinglesPayload).winner_id || '');
      const loser_id = String((body as SinglesPayload).loser_id || '');
      if (!winner_id || !loser_id) {
        return NextResponse.json({ ok: false, message: '勝者/敗者を選択してください。' }, { status: 400 });
      }
      if (winner_id === loser_id) {
        return NextResponse.json({ ok: false, message: '同一プレイヤーは選べません。' }, { status: 400 });
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

      // singles: 未知カラムは一切送らない（team系カラムは送信しない）
      const { data: ins, error: mErr } = await tryInsertFlexible(
        {
          match_date,
          reporter_id,
          winner_id,
          loser_id,
          winner_score: 15,
          loser_score,
          // venue: (body as SinglesPayload).venue ?? null,
          // notes: (body as SinglesPayload).notes ?? null,
        },
        modeCandidates, // 例: ['player','singles',...]
        statusCandidates // 例: ['finalized','finished',...]
      );
      if (mErr) {
        return NextResponse.json({ ok: false, message: `登録に失敗しました: ${mErr.message}` }, { status: 500 });
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

      return NextResponse.json({ ok: true, match_id: ins?.id }, { status: 201 });
    }

    /* -------------------- 団体戦（'teams' または 'doubles' 等） -------------------- */
    {
      const modeCandidates = await detectTeamsModeLabels();

      const winner_team_id = String((body as TeamsPayload).winner_team_id || '');
      const loser_team_id = String((body as TeamsPayload).loser_team_id || '');
      if (!winner_team_id || !loser_team_id) {
        return NextResponse.json({ ok: false, message: '勝利チーム/敗北チームを選択してください。' }, { status: 400 });
      }
      if (winner_team_id === loser_team_id) {
        return NextResponse.json({ ok: false, message: '同一チームは選べません。' }, { status: 400 });
      }

      // まず team_no 形状（一般的）で試す
      let stepA = await tryInsertFlexible(
        {
          match_date,
          reporter_id,
          winner_score: 15,
          loser_score,
          winner_team_no: 1,
          loser_team_no: 2,
          // player系カラムは送らない
          // venue: (body as TeamsPayload).venue ?? null,
          // notes: (body as TeamsPayload).notes ?? null,
        },
        modeCandidates,
        statusCandidates
      );

      // 失敗したら team_id 直持ち形状で再試行（テーブルにその列があるケース）
      if (stepA.error || !stepA.data?.id) {
        const stepB = await tryInsertFlexible(
          {
            match_date,
            reporter_id,
            winner_score: 15,
            loser_score,
            winner_team_id,
            loser_team_id,
          },
          modeCandidates,
          statusCandidates
        );

        if (stepB.error || !stepB.data?.id) {
          return NextResponse.json(
            { ok: false, message: `登録に失敗しました: ${stepB.error?.message || stepA.error?.message}` },
            { status: 500 }
          );
        }

        // team_id 直持ちで成功（match_teams 連携不要）
        return NextResponse.json({ ok: true, match_id: stepB.data.id }, { status: 201 });
      }

      // team_no 形状で成功したら、match_teams に 2 行追加
      const { error: mtErr } = await supabaseAdmin.from('match_teams').insert([
        { match_id: stepA.data.id, team_id: winner_team_id, team_no: 1 },
        { match_id: stepA.data.id, team_id: loser_team_id, team_no: 2 },
      ]);
      if (mtErr) {
        // 簡易ロールバック
        await supabaseAdmin.from('matches').delete().eq('id', stepA.data.id);
        return NextResponse.json(
          { ok: false, message: `チーム割当の登録に失敗しました: ${mtErr.message}` },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, match_id: stepA.data.id }, { status: 201 });
    }
  } catch (e: any) {
    console.error('[api/matches] fatal:', e);
    return NextResponse.json({ ok: false, message: 'サーバエラーが発生しました。' }, { status: 500 });
  }
}
