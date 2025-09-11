// app/api/matches/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ===================== Types ===================== */
type SinglesPayload = {
  mode: 'singles' | 'single';
  match_date: string;
  winner_id: string;
  loser_id: string;
  loser_score: number; // 0〜14
  venue?: string | null;
  notes?: string | null;
  apply_rating?: boolean; // 省略時 true
};

type TeamsPayload = {
  mode: 'teams' | 'team';
  match_date: string;
  winner_team_id: string;
  loser_team_id: string;
  loser_score: number; // 0〜14
  venue?: string | null;
  notes?: string | null;
};

type Body = SinglesPayload | TeamsPayload;

/* ===================== Helpers ===================== */
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function toInt(v: unknown, fallback = 0) {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
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

function normMode(m: string): 'singles' | 'teams' {
  return m.startsWith('team') ? 'teams' : 'singles';
}
const STATUS_CANDIDATES = ['finalized', 'finished'] as const;

async function tryInsert(rows: Record<string, any>[]) {
  let lastErr: any = null;
  for (const row of rows) {
    for (const status of STATUS_CANDIDATES) {
      const { data, error } = await supabaseAdmin
        .from('matches')
        .insert({ ...row, status })
        .select('id')
        .single();
      if (!error) return { data, error: null };
      lastErr = error;
    }
  }
  return { data: null, error: lastErr };
}

/* ===================== Handler ===================== */
export async function POST(req: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json({ ok: false, message: 'Supabase 環境変数が未設定です。' }, { status: 500 });
    }

    // 1) サーバで user を確定（reporter_id を必ず埋める）
    const cookieStore = cookies();
    const supa = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options?: CookieOptions) {
            cookieStore.set({ name, value, ...options });
          },
          remove(name: string, options?: CookieOptions) {
            cookieStore.set({ name, value: '', ...options });
          },
        },
      } as any
    );

    const { data: userData, error: userErr } = await supa.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, message: '認証が必要です。' }, { status: 401 });
    }
    const reporter_id = userData.user.id;

    // 2) 入力
    const body = (await req.json().catch(() => null)) as Partial<Body> | null;
    if (!body || !body.mode) {
      return NextResponse.json({ ok: false, message: '不正なリクエストです。' }, { status: 400 });
    }

    const mode = normMode(String(body.mode));
    const match_date = String(body.match_date || '').trim();
    if (!match_date) {
      return NextResponse.json({ ok: false, message: '試合日時が未指定です。' }, { status: 400 });
    }
    const loser_score = clamp(toInt((body as any).loser_score, 0), 0, 14);

    /* -------------------- 個人戦 -------------------- */
    if (mode === 'singles') {
      const winner_id = String((body as SinglesPayload).winner_id || '');
      const loser_id = String((body as SinglesPayload).loser_id || '');
      if (!winner_id || !loser_id) {
        return NextResponse.json({ ok: false, message: '勝者/敗者を選択してください。' }, { status: 400 });
      }
      if (winner_id === loser_id) {
        return NextResponse.json({ ok: false, message: '同一プレイヤーは選べません。' }, { status: 400 });
      }

      // 現在値（更新用）
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

      // singles: チーム系は NULL 明示
      const { data: inserted, error: mErr } = await tryInsert([
        {
          mode: 'singles',
          match_date,
          reporter_id,
          winner_id,
          loser_id,
          winner_score: 15,
          loser_score,
          winner_team_no: null,
          loser_team_no: null,
          winner_team_id: null,
          loser_team_id: null,
          // venue: (body as SinglesPayload).venue ?? null,
          // notes: (body as SinglesPayload).notes ?? null,
        },
      ]);
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

        const winnerNext = {
          ranking_points: clamp(toInt(w.ranking_points, 0) + delta.winnerPointsChange, 0, 99999),
          handicap: clamp(toInt(w.handicap, 0) + delta.winnerHandicapChange, 0, 50),
          matches_played: toInt(w.matches_played, 0) + 1,
          wins: toInt(w.wins, 0) + 1,
        };
        const loserNext = {
          ranking_points: clamp(toInt(l.ranking_points, 0) + delta.loserPointsChange, 0, 99999),
          handicap: clamp(toInt(l.handicap, 0) + delta.loserHandicapChange, 0, 50),
          matches_played: toInt(l.matches_played, 0) + 1,
          losses: toInt(l.losses, 0) + 1,
        };

        const [uw, ul] = await Promise.all([
          supabaseAdmin.from('players').update(winnerNext).eq('id', winner_id),
          supabaseAdmin.from('players').update(loserNext).eq('id', loser_id),
        ]);
        if (uw.error) console.warn('[matches API] winner update warning:', uw.error);
        if (ul.error) console.warn('[matches API] loser  update warning:', ul.error);
      }

      return NextResponse.json({ ok: true, match_id: inserted?.id }, { status: 201 });
    }

    /* -------------------- 団体戦 -------------------- */
    {
      const winner_team_id = String((body as TeamsPayload).winner_team_id || '');
      const loser_team_id = String((body as TeamsPayload).loser_team_id || '');
      if (!winner_team_id || !loser_team_id) {
        return NextResponse.json({ ok: false, message: '勝利チーム/敗北チームを選択してください。' }, { status: 400 });
      }
      if (winner_team_id === loser_team_id) {
        return NextResponse.json({ ok: false, message: '同一チームは選べません。' }, { status: 400 });
      }

      // まず「matches に team_id を直接持つ」想定で挿入（最近のスキーマ変更に対応）
      const tryTeamIdFirst = [
        {
          mode: 'teams',
          match_date,
          reporter_id,
          winner_score: 15,
          loser_score,
          winner_team_id,
          loser_team_id,
          winner_team_no: null,
          loser_team_no: null,
          winner_id: null,
          loser_id: null,
          // venue: (body as TeamsPayload).venue ?? null,
          // notes: (body as TeamsPayload).notes ?? null,
        },
      ];

      let { data: inserted, error: mErr } = await tryInsert(tryTeamIdFirst);

      // 列が存在しない/別の CHECK にかかった場合は、従来方式（team_no + match_teams）にフォールバック
      if (mErr) {
        const { data, error } = await tryInsert([
          {
            mode: 'teams',
            match_date,
            reporter_id,
            winner_score: 15,
            loser_score,
            winner_team_no: 1,
            loser_team_no: 2,
            winner_id: null,
            loser_id: null,
            winner_team_id: null,
            loser_team_id: null,
          },
        ]);
        inserted = data;
        mErr = error;

        if (!mErr && inserted?.id) {
          const { error: mtErr } = await supabaseAdmin.from('match_teams').insert([
            { match_id: inserted.id, team_id: winner_team_id, team_no: 1 },
            { match_id: inserted.id, team_id: loser_team_id, team_no: 2 },
          ]);
          if (mtErr) {
            await supabaseAdmin.from('matches').delete().eq('id', inserted.id);
            return NextResponse.json(
              { ok: false, message: `チーム割当の登録に失敗しました: ${mtErr.message}` },
              { status: 500 }
            );
          }
        }
      }

      if (mErr || !inserted?.id) {
        return NextResponse.json(
          { ok: false, message: `登録に失敗しました: ${mErr?.message || 'match_id 不明'}` },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, match_id: inserted.id }, { status: 201 });
    }
  } catch (e: any) {
    console.error('[api/matches] fatal:', e);
    return NextResponse.json({ ok: false, message: 'サーバエラーが発生しました。' }, { status: 500 });
  }
}
