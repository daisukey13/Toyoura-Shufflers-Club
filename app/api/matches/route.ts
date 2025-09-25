// app/api/matches/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ===================== Types ===================== */
type SinglesPayload = {
  mode: string;
  match_date: string;
  winner_id: string;
  loser_id: string;
  winner_score?: number;
  loser_score: number;
  venue?: string | null;
  notes?: string | null;
  apply_rating?: boolean;
};
type TeamsPayload = {
  mode: string;
  match_date: string;
  winner_team_id: string;
  loser_team_id: string;
  winner_score?: number;
  loser_score: number;
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

/** ELO ライク（勝者 15 固定、敗者 0..14 の点差を利用） */
function calcDelta(
  wPts: number, lPts: number, wH: number, lH: number, scoreDiff: number
) {
  const K = 32;
  const expW = 1 / (1 + Math.pow(10, (lPts - wPts) / 400));
  const diffMul = 1 + scoreDiff / 30;
  const hcMul   = 1 + (wH - lH) / 50;

  const wChange = K * (1 - expW) * diffMul * hcMul;
  const lChange = -K * expW * diffMul;

  const wHc = scoreDiff >= 10 ? -1 : 0;
  const lHc = scoreDiff >= 10 ?  1 : 0;

  return {
    winnerPointsChange: Math.round(wChange),
    loserPointsChange : Math.round(lChange),
    winnerHandicapChange: wHc,
    loserHandicapChange : lHc,
  };
}

/** reporter 補完（service-role のときのみ） */
async function ensureReporterPlayerIfAdmin(reporterId: string, displayName: string | null) {
  if (!hasSrv) return;
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
      is_active: true,
      is_admin: false,
    } as any,
    { onConflict: 'id' }
  );
  if (error) throw new Error(`reporter の players 作成に失敗: ${error.message}`);
}

async function isAdminPlayer(playerId: string): Promise<boolean> {
  if (!hasSrv) return false;
  const { data } = await supabaseAdmin.from('players').select('is_admin').eq('id', playerId).maybeSingle();
  return Boolean(data?.is_admin);
}

async function isMemberOfTeam(playerId: string, teamId: string): Promise<boolean> {
  if (!hasSrv) return false;
  const candidates = [
    { table: 'team_members',  playerCol: 'player_id', teamCol: 'team_id' },
    { table: 'players_teams', playerCol: 'player_id', teamCol: 'team_id' },
    { table: 'team_players',  playerCol: 'player_id', teamCol: 'team_id' },
    { table: 'memberships',   playerCol: 'player_id', teamCol: 'team_id' },
  ] as const;
  for (const c of candidates) {
    const { data, error } = await supabaseAdmin
      .from(c.table)
      .select('team_id').eq(c.playerCol, playerId).eq(c.teamCol, teamId).limit(1);
    if (!error && data && data.length > 0) return true;
  }
  return false;
}

/** 未知カラムを自動で落としながら INSERT する（matches 用） */
async function smartInsertMatches(
  client: any,
  initialRow: Record<string, any>,
  modeAlternatives: string[],
): Promise<{ id: string }> {
  let row = { ...initialRow };
  let modeIdx = 0;
  const triedDrop = new Set<string>();
  let guard = 0;

  while (guard++ < 12) {
    const { data, error } = await client.from('matches').insert(row).select('id').single();
    if (!error && data) return { id: data.id as string };

    const m = String(error?.message || '');

    // enum/チェック
    if ((/invalid input value for enum|violates check constraint/i.test(m))
      && 'mode' in row && modeIdx + 1 < modeAlternatives.length) {
      modeIdx += 1;
      row = { ...row, mode: modeAlternatives[modeIdx] };
      continue;
    }

    // 未定義列 → 除去
    const colNotExist = /column "([^"]+)" .* does not exist/i.exec(m);
    if (colNotExist) {
      const bad = colNotExist[1];
      if (bad in row && !triedDrop.has(bad)) {
        triedDrop.add(bad);
        const { [bad]: _, ...rest } = row;
        row = rest;
        continue;
      }
    }

    // NOT NULL
    const notNull = /null value in column "([^"]+)"/i.exec(m);
    if (notNull) {
      const col = notNull[1];
      if (!(col in row) || row[col] == null) {
        if (col === 'status')        { row = { ...row, status: 'finalized' }; continue; }
        if (col === 'winner_team_no'){ row = { ...row, winner_team_no: 1 };  continue; }
        if (col === 'loser_team_no') { row = { ...row, loser_team_no: 2 };   continue; }
        if (col === 'winner_score')  { row = { ...row, winner_score: 15 };   continue; }
        if (col === 'loser_score')   { row = { ...row, loser_score: 0 };     continue; }
        if (/(reporter|created|author)_?id/i.test(col) && initialRow.reporter_id) {
          row = { ...row, [col]: initialRow.reporter_id }; continue;
        }
      }
    }

    throw error;
  }
  throw new Error('insert failed after multiple fallbacks');
}

/** 未定義列を自動で落としながら UPDATE する */
async function softUpdate(
  client: any,
  table: string,
  patch: Record<string, any>,
  filters: Array<{ col: string, val: any }>
) {
  let body = { ...patch };
  let guard = 0;

  while (Object.keys(body).length > 0 && guard++ < 12) {
    let q = client.from(table).update(body);
    for (const f of filters) q = q.eq(f.col, f.val);
    const { error } = await q;
    if (!error) return true;

    const m = String(error?.message || '');
    const colNotExist = /column "([^"]+)" .* does not exist/i.exec(m);
    if (colNotExist) {
      delete body[colNotExist[1]];
      continue;
    }
    // 列が全滅するまで繰り返し、他のエラーは伝播させない
    break;
  }
  return false;
}

/** 未知カラムを落としつつ、重複なら成功扱いで INSERT する（レコードが無い場合の match_players 作成に使用） */
async function looseInsert(
  client: any,
  table: string,
  row: Record<string, any>
): Promise<boolean> {
  let body = { ...row };
  let guard = 0;
  while (guard++ < 12) {
    const { error } = await client.from(table).insert(body).single();
    if (!error) return true;

    const msg = String(error?.message || '');
    // テーブルなし
    if (/relation .* does not exist/i.test(msg)) return false;
    // 重複 → 既にあるとみなし成功
    if (/duplicate key value|already exists|23505/i.test(msg)) return true;

    // 未定義列 → 落とす
    const m1 = /column "([^"]+)" .* does not exist/i.exec(msg);
    if (m1) {
      delete body[m1[1]];
      continue;
    }
    // enum/チェック → その列を落とす
    const m2 = /invalid input value for enum|violates check constraint/i.test(msg);
    if (m2) {
      // result など列名が取れない場合もあるため、よくある候補を順次落とす
      for (const k of ['result', 'is_winner', 'created_at', 'updated_at']) {
        if (k in body) { delete body[k]; break; }
      }
      continue;
    }
    // NOT NULL → 時刻系だけ埋める
    const m3 = /null value in column "([^"]+)"/i.exec(msg);
    if (m3) {
      const col = m3[1];
      if (/(created|updated)_at/i.test(col)) {
        body[col] = new Date().toISOString();
        continue;
      }
    }
    // どうしてもダメなら諦める（失敗を返す）
    return false;
  }
  return false;
}

/** match_players の2行（勝者/敗者）を“必要なら”作成 */
async function ensureMatchPlayersRows(
  client: any,
  params: {
    match_id: string;
    winner_id: string;
    loser_id: string;
    winner_score: number;
    loser_score: number;
  }
) {
  const { match_id, winner_id, loser_id, winner_score, loser_score } = params;

  // 既存確認（失敗したらスキップ）
  try {
    const { data } = await client
      .from('match_players')
      .select('match_id, player_id')
      .eq('match_id', match_id)
      .limit(2);
    if (Array.isArray(data) && data.length >= 2) return; // 既にある
  } catch { /* noop */ }

  // 代表的なカラムで挿入（未知列は looseInsert が落としてくれる）
  await looseInsert(client, 'match_players', {
    match_id, player_id: winner_id, side_no: 1, team_no: 1,
    result: 'win', is_winner: true, score: winner_score,
  });
  await looseInsert(client, 'match_players', {
    match_id, player_id: loser_id, side_no: 2, team_no: 2,
    result: 'loss', is_winner: false, score: loser_score,
  });
}

/** match_players の delta を優先保存、ダメなら matches 側に保存 */
async function persistDeltas(
  client: any,
  params: {
    match_id: string;
    winner_id: string;
    loser_id: string;
    winnerSide?: number; // 既定: 1
    loserSide?: number;  // 既定: 2
    winner: { points: number; handicap: number };
    loser:  { points: number; handicap: number };
    ratingApplied: boolean;
  }
) {
  const { match_id, winner_id, loser_id, winner, loser, ratingApplied } = params;
  const side1 = params.winnerSide ?? 1;
  const side2 = params.loserSide  ?? 2;

  // 1) match_players に対して（存在しない列は自動的に落とす）
  const tried1 = await softUpdate(client, 'match_players',
    { rp_delta: winner.points, hc_delta: winner.handicap },
    [{ col: 'match_id', val: match_id }, { col: 'player_id', val: winner_id }]
  );
  const tried2 = await softUpdate(client, 'match_players',
    { rp_delta: loser.points, hc_delta: loser.handicap },
    [{ col: 'match_id', val: match_id }, { col: 'player_id', val: loser_id }]
  );

  if (!tried1) {
    await softUpdate(client, 'match_players',
      { ranking_points_delta: winner.points, handicap_delta: winner.handicap },
      [{ col: 'match_id', val: match_id }, { col: 'player_id', val: winner_id }]
    );
  }
  if (!tried2) {
    await softUpdate(client, 'match_players',
      { ranking_points_delta: loser.points, handicap_delta: loser.handicap },
      [{ col: 'match_id', val: match_id }, { col: 'player_id', val: loser_id }]
    );
  }

  // side_no 主キー系
  await softUpdate(client, 'match_players',
    { rp_delta: winner.points, hc_delta: winner.handicap },
    [{ col: 'match_id', val: match_id }, { col: 'side_no', val: side1 }]
  );
  await softUpdate(client, 'match_players',
    { rp_delta: loser.points, hc_delta: loser.handicap },
    [{ col: 'match_id', val: match_id }, { col: 'side_no', val: side2 }]
  );

  // 2) matches 側にも冗長保存（ビューがこちらを見る構成向け）
  await softUpdate(client, 'matches', {
    winner_points_delta: winner.points,
    loser_points_delta : loser.points,
    winner_handicap_delta: winner.handicap,
    loser_handicap_delta : loser.handicap,
    rating_applied: ratingApplied,
  }, [{ col: 'id', val: match_id }]);

  // 別名: *_rp_delta / *_hc_delta
  await softUpdate(client, 'matches', {
    winner_rp_delta: winner.points,
    loser_rp_delta : loser.points,
    winner_hc_delta: winner.handicap,
    loser_hc_delta : loser.handicap,
  }, [{ col: 'id', val: match_id }]);
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

    await ensureReporterPlayerIfAdmin(
      reporter_id,
      (userData.user.user_metadata?.name as string | undefined) ||
      (userData.user.email as string | undefined) ||
      null
    );

    const admin = await isAdminPlayer(reporter_id);
    const db = hasSrv ? supabaseAdmin : (userClient as any);

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

      if (!admin && reporter_id !== winner_id && reporter_id !== loser_id) {
        return NextResponse.json(
          { ok: false, message: '自分が出場した試合のみ登録できます（管理者は除外）。' },
          { status: 403 }
        );
      }

      // レーティング計算用の現値（取れなければ後で delta=null を返すだけ）
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

      try {
        const ins = await smartInsertMatches(db, initialRow, ['player', 'singles', 'single']);

        // delta 計算
        let deltas:
          | { winner: { points: number; handicap: number }, loser: { points: number; handicap: number } }
          | null = null;

        if (w && l) {
          const diff = 15 - loser_score;
          const d = calcDelta(
            toInt(w.ranking_points, 0),
            toInt(l.ranking_points, 0),
            toInt(w.handicap, 0),
            toInt(l.handicap, 0),
            diff
          );
          deltas = {
            winner: { points: d.winnerPointsChange, handicap: d.winnerHandicapChange },
            loser : { points: d.loserPointsChange , handicap: d.loserHandicapChange  },
          };
        }

        // match_players 行が無ければ作っておく（あればスキップ）
        await ensureMatchPlayersRows(db, {
          match_id: ins.id,
          winner_id,
          loser_id,
          winner_score,
          loser_score,
        });

        // 反映（service-role のときのみ）
        const applyReq = (body as SinglesPayload).apply_rating ?? true;
        let applied = false;
        if (hasSrv && applyReq && w && l && deltas) {
          const d = deltas;
          const [uw, ul] = await Promise.all([
            supabaseAdmin.from('players').update({
              ranking_points: clamp(toInt(w.ranking_points, 0) + d.winner.points, 0, 99999),
              handicap:       clamp(toInt(w.handicap, 0) + d.winner.handicap, 0, 50),
              matches_played: toInt(w.matches_played, 0) + 1,
              wins:           toInt(w.wins, 0) + 1,
            }).eq('id', winner_id),
            supabaseAdmin.from('players').update({
              ranking_points: clamp(toInt(l.ranking_points, 0) + d.loser.points, 0, 99999),
              handicap:       clamp(toInt(l.handicap, 0) + d.loser.handicap, 0, 50),
              matches_played: toInt(l.matches_played, 0) + 1,
              losses:         toInt(l.losses, 0) + 1,
            }).eq('id', loser_id),
          ]);
          if (uw.error) console.warn('[matches API] winner update warning:', uw.error);
          if (ul.error) console.warn('[matches API] loser  update warning:', ul.error);
          applied = !uw.error && !ul.error;
        }

        // ★ 変化量を DB に保存（どこかには必ず残す）
        if (deltas) {
          await persistDeltas(
            hasSrv ? supabaseAdmin : db,
            {
              match_id: ins.id,
              winner_id,
              loser_id,
              winner: deltas.winner,
              loser:  deltas.loser,
              ratingApplied: applied,
            }
          );
        } else {
          // 元値が取れず delta 不明でも、rating_applied=false 等だけ matches に残せるなら残す
          await softUpdate(hasSrv ? supabaseAdmin : db, 'matches',
            { rating_applied: false },
            [{ col: 'id', val: ins.id }]
          );
        }

        return NextResponse.json(
          {
            ok: true,
            match_id: ins.id,
            winner_id,
            loser_id,
            apply_rating: hasSrv ? applied : false,
            deltas: deltas ?? null,
          },
          { status: 201 }
        );
      } catch (e: any) {
        const msg = String(e?.message || e || '');
        if (/row-level security|rls/i.test(msg)) {
          return NextResponse.json({ ok: false, message: 'DB 権限（RLS）で拒否されました。INSERT ポリシーをご確認ください。' }, { status: 403 });
        }
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

      if (hasSrv && !await isMemberOfTeam(reporter_id, winner_team_id) && !await isMemberOfTeam(reporter_id, loser_team_id) && !(await isAdminPlayer(reporter_id))) {
        return NextResponse.json(
          { ok: false, message: '所属チームの試合のみ登録できます（管理者は除外）。' },
          { status: 403 }
        );
      }

      const initialRow = {
        mode: 'teams',
        status: 'finalized',
        match_date,
        reporter_id,
        winner_score,
        loser_score,
        winner_team_no: 1,
        loser_team_no: 2,
        winner_team_id,
        loser_team_id,
        venue,
        notes,
      };

      try {
        const ins = await smartInsertMatches(db, initialRow, ['teams', 'team']);

        if (hasSrv) {
          const mt = await supabaseAdmin.from('match_teams').insert([
            { match_id: ins.id, team_id: winner_team_id, team_no: 1 } as any,
            { match_id: ins.id, team_id: loser_team_id,  team_no: 2 } as any,
          ]);
          if (mt.error) {
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
          await fallbackWriteTeamsIntoMatches(db, ins.id, winner_team_id, loser_team_id);
        }

        return NextResponse.json({ ok: true, match_id: ins.id, deltas: null }, { status: 201 });
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
