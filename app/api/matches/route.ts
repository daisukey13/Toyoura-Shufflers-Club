// app/api/matches/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ===================== Types ===================== */
type SinglesPayload = {
  mode: string;              // 'singles' | 'single' | 'player' など
  match_date: string;
  winner_id: string;
  loser_id: string;
  winner_score?: number;     // 省略時 15
  loser_score: number;       // 0..14
  venue?: string | null;
  notes?: string | null;
  apply_rating?: boolean;    // 省略時 true
};

type TeamsPayload = {
  mode: string;              // 'teams' | 'team' など
  match_date: string;
  winner_team_id: string;
  loser_team_id: string;
  winner_score?: number;     // 省略時 15
  loser_score: number;       // 0..14
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
const isPgCode = (err: unknown, code: string) =>
  String((err as any)?.message ?? (err as any)?.code ?? err ?? '').includes(code);

/** ELO風の変動（個人戦のみ） */
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

/** service-role がある時だけ reporter の players を用意 */
async function ensureReporterPlayerIfAdmin(reporterId: string, displayName: string | null) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
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
    } as any,
    { onConflict: 'id' }
  );
  if (error) throw new Error(`reporter の players 作成に失敗: ${error.message}`);
}

/** reporter が admin か（service-role が無ければ false） */
async function isAdminPlayer(reporterId: string): Promise<boolean> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  const { data } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', reporterId)
    .maybeSingle();
  return Boolean(data?.is_admin);
}

/** service-role ありの時だけ厳密にチェック（無ければ false のままでもOK） */
async function isMemberOfTeam(reporterId: string, teamId: string): Promise<boolean> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
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
      .eq(c.playerCol, reporterId)
      .eq(c.teamCol, teamId)
      .limit(1);
    if (!error && data && data.length > 0) return true;
  }
  return false;
}

/** 列不一致に強い INSERT（指定カラムを順に落として再試行） */
async function tryInsertWithFallback(
  client: any,               // supabase client（admin でも user でも可）
  table: string,
  values: Record<string, any>,
  dropCandidatesInOrder: string[],
  selectCols = 'id'
): Promise<{ id: string }> {
  const tried: string[] = [];
  let payload = { ...values };

  for (let i = 0; i <= dropCandidatesInOrder.length; i++) {
    const { data, error } = await client.from(table).insert(payload).select(selectCols).single();
    if (!error && data) return data as any;

    const msg = String(error?.message || '').toLowerCase();
    const cant = dropCandidatesInOrder.find(
      (c) => !tried.includes(c) && (msg.includes(`column "${c}"`) || msg.includes(`"${c}"`))
    );
    if (cant) {
      tried.push(cant);
      delete (payload as any)[cant];
      continue;
    }
    throw error ?? new Error('insert failed');
  }
  throw new Error('insert failed after fallback');
}

/** match_teams が無い場合のフォールバック（matches に直置き） */
async function fallbackWriteTeamsIntoMatches(
  client: any,
  matchId: string,
  winner_team_id: string,
  loser_team_id: string
) {
  // 両方まとめて
  let u = await client.from('matches')
    .update({ winner_team_id, loser_team_id } as any)
    .eq('id', matchId);
  if (!u.error) return true;

  // 片側ずつ
  await client.from('matches').update({ winner_team_id } as any).eq('id', matchId);
  await client.from('matches').update({ loser_team_id } as any).eq('id', matchId);
  return true;
}

/* ===================== Handler ===================== */
export async function POST(req: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!url || !anon) {
      return NextResponse.json({ ok: false, message: 'Supabase 環境変数が未設定です。' }, { status: 500 });
    }

    // Cookie ベースのユーザークライアント
    const cookieStore = cookies();
    const userClient = createServerClient(url, anon, {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set(name: string, value: string, options?: any) { cookieStore.set({ name, value, ...(options || {}) } as any); },
        remove(name: string, options?: any) { cookieStore.set({ name, value: '', ...(options || {}) } as any); },
      },
    } as any);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, message: '認証が必要です。' }, { status: 401 });
    }
    const reporter_id = userData.user.id;

    const hasAdmin = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    const db = hasAdmin ? supabaseAdmin : (userClient as any);

    // 必要なら reporter の players 行を用意（service-role がある時のみ）
    await ensureReporterPlayerIfAdmin(
      reporter_id,
      (userData.user.user_metadata?.name as string | undefined) ||
      (userData.user.email as string | undefined) ||
      null
    );

    const admin = await isAdminPlayer(reporter_id);

    // 入力
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

    /* ─────────────── 個人戦 ─────────────── */
    if (/^sing/i.test(rawMode) || /^single$/i.test(rawMode) || /^player$/i.test(rawMode)) {
      const winner_id = String((body as SinglesPayload).winner_id || '');
      const loser_id  = String((body as SinglesPayload).loser_id  || '');
      if (!winner_id || !loser_id) {
        return NextResponse.json({ ok: false, message: '勝者/敗者を選択してください。' }, { status: 400 });
      }
      if (winner_id === loser_id) {
        return NextResponse.json({ ok: false, message: '同一プレイヤーは選べません。' }, { status: 400 });
      }

      // 一般ユーザーは自分が出場した試合のみ登録可（admin は除外）
      if (!admin && reporter_id !== winner_id && reporter_id !== loser_id) {
        return NextResponse.json(
          { ok: false, message: '自分が出場した試合のみ登録できます（管理者は除外）。' },
          { status: 403 }
        );
      }

      // レーティング更新用データ（失敗しても試合登録は続行）
      let w: any = null, l: any = null;
      try {
        const { data: players } = await db
          .from('players')
          .select('id, ranking_points, handicap, matches_played, wins, losses')
          .in('id', [winner_id, loser_id]);
        w = players?.find((p: any) => p.id === winner_id);
        l = players?.find((p: any) => p.id === loser_id);
      } catch { /* noop */ }

      const candidate = {
        mode: 'player',
        status: 'finalized',     // 無ければ落とす
        match_date,
        reporter_id,             // 無ければ落とす
        winner_id,
        loser_id,
        winner_score,            // 無ければ落とす
        loser_score,
        winner_team_no: 0,       // 無ければ落とす
        loser_team_no: 0,        // 無ければ落とす
        venue,                   // 無ければ落とす
        notes,                   // 無ければ落とす
      };

      const dropCols = [
        'status',
        'reporter_id',
        'winner_team_no',
        'loser_team_no',
        'winner_score',
        'venue',
        'notes',
      ];

      try {
        const ins = await tryInsertWithFallback(db, 'matches', candidate, dropCols, 'id');

        // レーティング反映（service-role があって players 更新可の時だけ）
        const apply = (body as SinglesPayload).apply_rating ?? true;
        if (apply && hasAdmin && w && l) {
          const diff = 15 - loser_score;
          const delta = calcDelta(
            toInt(w.ranking_points, 0),
            toInt(l.ranking_points, 0),
            toInt(w.handicap, 0),
            toInt(l.handicap, 0),
            diff
          );
          const [uw, ul] = await Promise.all([
            supabaseAdmin.from('players').update({
              ranking_points: clamp(toInt(w.ranking_points, 0) + delta.winnerPointsChange, 0, 99999),
              handicap: clamp(toInt(w.handicap, 0) + delta.winnerHandicapChange, 0, 50),
              matches_played: toInt(w.matches_played, 0) + 1,
              wins: toInt(w.wins, 0) + 1,
            }).eq('id', winner_id),
            supabaseAdmin.from('players').update({
              ranking_points: clamp(toInt(l.ranking_points, 0) + delta.loserPointsChange, 0, 99999),
              handicap: clamp(toInt(l.handicap, 0) + delta.loserHandicapChange, 0, 50),
              matches_played: toInt(l.matches_played, 0) + 1,
              losses: toInt(l.losses, 0) + 1,
            }).eq('id', loser_id),
          ]);
          if (uw.error) console.warn('[matches API] winner update warning:', uw.error);
          if (ul.error) console.warn('[matches API] loser  update warning:', ul.error);
        }

        return NextResponse.json({ ok: true, match_id: ins?.id }, { status: 201 });
      } catch (e: any) {
        const msg = String(e?.message || e || '');
        if (/row-level security|rls/i.test(msg)) {
          return NextResponse.json({ ok: false, message: 'データベースの権限（RLS）で拒否されました。挿入ポリシーをご確認ください。' }, { status: 403 });
        }
        if (/relation .* does not exist|column .* does not exist|undefined column/i.test(msg)) {
          return NextResponse.json({ ok: false, message: `スキーマが一致しません: ${msg}` }, { status: 400 });
        }
        return NextResponse.json({ ok: false, message: `登録に失敗しました: ${msg || '不明なエラー'}` }, { status: 400 });
      }
    }

    /* ─────────────── チーム戦 ─────────────── */
    {
      const winner_team_id = String((body as TeamsPayload).winner_team_id || '');
      const loser_team_id  = String((body as TeamsPayload).loser_team_id  || '');
      if (!winner_team_id || !loser_team_id) {
        return NextResponse.json({ ok: false, message: '勝利チーム/敗北チームを選択してください。' }, { status: 400 });
      }
      if (winner_team_id === loser_team_id) {
        return NextResponse.json({ ok: false, message: '同一チームは選べません。' }, { status: 400 });
      }

      // service-role がある時だけ所属チェックを厳密に
      if (hasAdmin && !admin) {
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

      const candidate = {
        mode: 'teams',
        status: 'finalized',
        match_date,
        reporter_id,
        winner_score,
        loser_score,
        winner_team_no: 1,
        loser_team_no: 2,
        // matches に team_id が存在するスキーマ向けの冗長カラム（無ければ落とす）
        winner_team_id,
        loser_team_id,
        venue,
        notes,
      };

      const dropCols = [
        'status',
        'reporter_id',
        'winner_team_no',
        'loser_team_no',
        'winner_team_id',
        'loser_team_id',
        'venue',
        'notes',
      ];

      try {
        const ins = await tryInsertWithFallback(db, 'matches', candidate, dropCols, 'id');

        // match_teams があるなら 2 行追加（service-role が無い場合はスキップ）
        if (hasAdmin) {
          const mt = await supabaseAdmin.from('match_teams').insert([
            { match_id: ins.id, team_id: winner_team_id, team_no: 1 } as any,
            { match_id: ins.id, team_id: loser_team_id,  team_no: 2 } as any,
          ]);
          if (mt.error) {
            if (isPgCode(mt.error, '42P01') || isPgCode(mt.error, '42703')) {
              // テーブル/列が無い → matches 側に直置き（ユーザークライアントで試す）
              await fallbackWriteTeamsIntoMatches(db, ins.id, winner_team_id, loser_team_id);
            } else {
              // それ以外はロールバック（整合性重視）
              await supabaseAdmin.from('matches').delete().eq('id', ins.id);
              return NextResponse.json(
                { ok: false, message: `チーム割当の登録に失敗しました: ${mt.error.message}` },
                { status: 500 }
              );
            }
          }
        } else {
          // admin 無い環境では、matches に直置きをベストエフォートで試行（失敗しても致命ではない）
          await fallbackWriteTeamsIntoMatches(db, ins.id, winner_team_id, loser_team_id);
        }

        return NextResponse.json({ ok: true, match_id: ins?.id }, { status: 201 });
      } catch (e: any) {
        const msg = String(e?.message || e || '');
        if (/row-level security|rls/i.test(msg)) {
          return NextResponse.json({ ok: false, message: 'データベースの権限（RLS）で拒否されました。挿入ポリシーをご確認ください。' }, { status: 403 });
        }
        if (/relation .* does not exist|column .* does not exist|undefined column/i.test(msg)) {
          return NextResponse.json({ ok: false, message: `スキーマが一致しません: ${msg}` }, { status: 400 });
        }
        return NextResponse.json({ ok: false, message: `登録に失敗しました: ${msg || '不明なエラー'}` }, { status: 400 });
      }
    }
  } catch (e: any) {
    console.error('[api/matches] fatal:', e);
    return NextResponse.json({ ok: false, message: 'サーバエラーが発生しました。' }, { status: 500 });
  }
}
