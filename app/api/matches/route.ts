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
const toInt = (v: unknown, fb = 0) => {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fb;
};
const hasSrv = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

function calcDelta(
  wPts: number, lPts: number, wH: number, lH: number, scoreDiff: number
) {
  const K = 32;
  const expW = 1 / (1 + Math.pow(10, (lPts - wPts) / 400));
  const diffMul = 1 + scoreDiff / 30;
  const hcMul = 1 + (wH - lH) / 50;
  const wChange = K * (1 - expW) * diffMul * hcMul;
  const lChange = -K * expW * diffMul;
  const wHc = scoreDiff >= 10 ? -1 : 0;
  const lHc = scoreDiff >= 10 ? 1 : 0;
  return {
    winnerPointsChange: Math.round(wChange),
    loserPointsChange: Math.round(lChange),
    winnerHandicapChange: wHc,
    loserHandicapChange: lHc,
  };
}

async function ensureReporterPlayerIfAdmin(reporterId: string, displayName: string | null) {
  if (!hasSrv) return;
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

async function isAdminPlayer(playerId: string): Promise<boolean> {
  if (!hasSrv) return false;
  const { data } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', playerId)
    .maybeSingle();
  return Boolean(data?.is_admin);
}

async function isMemberOfTeam(playerId: string, teamId: string): Promise<boolean> {
  if (!hasSrv) return false;
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

/** スキーマ差異に強い “スマート挿入”（列欠如・NOT NULL・enum 違反に順次フォールバック） */
async function smartInsertMatches(
  client: any,
  initialRow: Record<string, any>,
  modeAlternatives: string[],   // 例: ['player','singles','single']
): Promise<{ id: string }> {
  // 挿入試行のたびに row をコピーして改変
  let row = { ...initialRow };
  let modeIdx = 0;
  const triedDrop = new Set<string>();
  let safety = 0;

  // 最多 12 回程度で打ち切り（無限ループ防止）
  while (safety++ < 12) {
    const { data, error } = await client.from('matches').insert(row).select('id').single();

    if (!error && data) return { id: data.id as string };

    const msg = String(error?.message || '').toLowerCase();

    // 1) enum/チェック制約: mode 値の不一致
    if ((/invalid input value for enum/i.test(error?.message || '') || /violates check constraint/i.test(error?.message || ''))
        && 'mode' in row
        && modeIdx + 1 < modeAlternatives.length) {
      modeIdx += 1;
      row = { ...row, mode: modeAlternatives[modeIdx] };
      continue;
    }

    // 2) 未定義列 → その列を落として再試行
    //    例: column "status" of relation "matches" does not exist
    const colNotExist = /column "([^"]+)" .* does not exist/i.exec(error?.message || '');
    if (colNotExist) {
      const bad = colNotExist[1];
      if (bad in row && !triedDrop.has(bad)) {
        triedDrop.add(bad);
        const { [bad]: _, ...rest } = row;
        row = rest;
        continue;
      }
    }

    // 3) NOT NULL 制約 → 推測できる既定値があれば埋めて再試行
    //    例: null value in column "winner_team_no" violates not-null constraint
    const notNull = /null value in column "([^"]+)"/i.exec(error?.message || '');
    if (notNull) {
      const col = notNull[1];
      // 既に値があるなら推測不能 → 次へ
      if (!(col in row) || row[col] == null) {
        if (col === 'status') { row = { ...row, status: 'finalized' }; continue; }
        if (col === 'winner_team_no') { row = { ...row, winner_team_no: 1 }; continue; }
        if (col === 'loser_team_no')  { row = { ...row, loser_team_no: 2 }; continue; }
        if (col === 'winner_score')   { row = { ...row, winner_score: 15 }; continue; }
        if (col === 'loser_score')    { row = { ...row, loser_score: 0 }; continue; }
        // reporter_id / created_by / author_id 系は reporter_id を流用できることが多い
        if (/(reporter|created|author)_?id/i.test(col) && initialRow.reporter_id) {
          row = { ...row, [col]: initialRow.reporter_id };
          continue;
        }
      }
    }

    // 4) その他のエラーはそのまま投げる
    throw error;
  }

  throw new Error('insert failed after multiple fallbacks');
}

/** match_teams が無い/列が無い場合のフォールバック（matches に直置き） */
async function fallbackWriteTeamsIntoMatches(
  client: any,
  matchId: string,
  winner_team_id: string,
  loser_team_id: string
) {
  let u = await client.from('matches').update({ winner_team_id, loser_team_id } as any).eq('id', matchId);
  if (!u.error) return true;
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
        get: (n: string) => cookieStore.get(n)?.value,
        set: (n: string, v: string, o?: any) => cookieStore.set({ name: n, value: v, ...(o || {}) } as any),
        remove: (n: string, o?: any) => cookieStore.set({ name: n, value: '', ...(o || {}) } as any),
      },
    } as any);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, message: '認証が必要です。' }, { status: 401 });
    }
    const reporter_id = userData.user.id;

    // players レコードは service-role がある時だけ補完
    await ensureReporterPlayerIfAdmin(
      reporter_id,
      (userData.user.user_metadata?.name as string | undefined) ||
      (userData.user.email as string | undefined) ||
      null
    );

    const admin = await isAdminPlayer(reporter_id);
    const db = hasSrv ? supabaseAdmin : (userClient as any);

    // 入力取得
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

      if (!admin && reporter_id !== winner_id && reporter_id !== loser_id) {
        return NextResponse.json(
          { ok: false, message: '自分が出場した試合のみ登録できます（管理者は除外）。' },
          { status: 403 }
        );
      }

      // レーティング更新用の現値（service-role が無くても SELECT は通ることが多い）
      let w: any = null, l: any = null;
      try {
        const { data: players } = await db
          .from('players')
          .select('id, ranking_points, handicap, matches_played, wins, losses')
          .in('id', [winner_id, loser_id]);
        w = players?.find((p: any) => p.id === winner_id);
        l = players?.find((p: any) => p.id === loser_id);
      } catch { /* noop */ }

      const initialRow = {
        mode: 'player',         // enum NG の場合は 'singles' → 'single' へ自動で切替
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

      try {
        const ins = await smartInsertMatches(db, initialRow, ['player', 'singles', 'single']);

        // レーティング反映（service-role がある時のみ）
        const apply = (body as SinglesPayload).apply_rating ?? true;
        if (apply && hasSrv && w && l) {
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

        return NextResponse.json({ ok: true, match_id: ins.id }, { status: 201 });
      } catch (e: any) {
        const msg = String(e?.message || e || '');
        // RLS
        if (/row-level security|rls/i.test(msg)) {
          return NextResponse.json({ ok: false, message: 'DB 権限（RLS）で拒否されました。INSERT ポリシーをご確認ください。' }, { status: 403 });
        }
        // 典型的なスキーマ系メッセージをそのまま提示
        if (/relation .* does not exist|column .* does not exist|undefined column|invalid input value for enum|violates check constraint|null value in column/i.test(msg)) {
          return NextResponse.json({ ok: false, message: `スキーマ差異の可能性: ${msg}` }, { status: 400 });
        }
        console.error('[matches API] singles insert error:', e);
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

      if (hasSrv && !admin) {
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

      const initialRow = {
        mode: 'teams',          // enum NG の場合は 'team' に自動切替
        status: 'finalized',
        match_date,
        reporter_id,
        winner_score,
        loser_score,
        winner_team_no: 1,
        loser_team_no: 2,
        // “matches に team_id カラムがある” スキーマ向け冗長カラム（無ければ落とされる）
        winner_team_id,
        loser_team_id,
        venue,
        notes,
      };

      try {
        const ins = await smartInsertMatches(db, initialRow, ['teams', 'team']);

        // match_teams がある場合は 2 行 INSERT（service-role が無ければスキップ）
        if (hasSrv) {
          const mt = await supabaseAdmin.from('match_teams').insert([
            { match_id: ins.id, team_id: winner_team_id, team_no: 1 } as any,
            { match_id: ins.id, team_id: loser_team_id,  team_no: 2 } as any,
          ]);
          if (mt.error) {
            // テーブル/列が無い → matches 側に直置き（ユーザークライアントで）
            if (/42P01|42703/.test(String(mt.error.code)) || /does not exist|undefined column/i.test(mt.error.message)) {
              await fallbackWriteTeamsIntoMatches(db, ins.id, winner_team_id, loser_team_id);
            } else {
              await supabaseAdmin.from('matches').delete().eq('id', ins.id);
              return NextResponse.json(
                { ok: false, message: `チーム割当の登録に失敗しました: ${mt.error.message}` },
                { status: 500 }
              );
            }
          }
        } else {
          // 管理鍵が無い環境は matches に直置きをベストエフォート（失敗しても致命ではない）
          await fallbackWriteTeamsIntoMatches(db, ins.id, winner_team_id, loser_team_id);
        }

        return NextResponse.json({ ok: true, match_id: ins.id }, { status: 201 });
      } catch (e: any) {
        const msg = String(e?.message || e || '');
        if (/row-level security|rls/i.test(msg)) {
          return NextResponse.json({ ok: false, message: 'DB 権限（RLS）で拒否されました。INSERT ポリシーをご確認ください。' }, { status: 403 });
        }
        if (/relation .* does not exist|column .* does not exist|undefined column|invalid input value for enum|violates check constraint|null value in column/i.test(msg)) {
          return NextResponse.json({ ok: false, message: `スキーマ差異の可能性: ${msg}` }, { status: 400 });
        }
        console.error('[matches API] teams insert error:', e);
        return NextResponse.json({ ok: false, message: `登録に失敗しました: ${msg || '不明なエラー'}` }, { status: 400 });
      }
    }
  } catch (e: any) {
    console.error('[api/matches] fatal:', e);
    return NextResponse.json({ ok: false, message: 'サーバエラーが発生しました。' }, { status: 500 });
  }
}
