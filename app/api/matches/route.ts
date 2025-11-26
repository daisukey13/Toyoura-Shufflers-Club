// app/api/matches/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ===================== Types ===================== */

type SinglesPayload = {
  match_date: string;
  winner_id?: string;
  loser_id?: string;
  winner_score?: number;
  loser_score?: number; // 0〜14
  tournament_id?: string | null;
  venue?: string | null;
  notes?: string | null;
  apply_rating?: boolean; // 省略時 true
};

type TeamsPayload = {
  match_date: string;
  winner_team_id?: string;
  loser_team_id?: string;
  winner_score?: number;
  loser_score?: number; // 0〜14
  tournament_id?: string | null;
  venue?: string | null;
  notes?: string | null;
};

type Body = SinglesPayload & TeamsPayload;

/* ===================== Helpers ===================== */

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

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
  const expectedWinner =
    1 / (1 + Math.pow(10, (loserPoints - winnerPoints) / 400));
  const scoreDiffMultiplier = 1 + scoreDifference / 30;
  const handicapDiff = winnerHandicap - loserHandicap;
  const handicapMultiplier = 1 + handicapDiff / 50;

  const baseWinnerChange =
    K * (1 - expectedWinner) * scoreDiffMultiplier * handicapMultiplier;
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

/** reporter がそのチームのメンバーかどうか */
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
      .eq(c.teamCol, teamId);

    if (!error && data && data.length > 0) return true;
  }
  return false;
}

/**
 * 大会 + 2プレーヤー から、該当するリーグブロックがあればその id を返す。
 */
async function findLeagueBlockIdForPlayers(
  tournamentId: string,
  playerA: string,
  playerB: string
): Promise<string | null> {
  const { data: blocks, error: bErr } = await supabaseAdmin
    .from('league_blocks')
    .select('id')
    .eq('tournament_id', tournamentId);

  if (bErr || !blocks || blocks.length === 0) return null;

  const blockIds = blocks
    .map((b: any) => String(b.id))
    .filter((id) => !!id && id !== 'null');

  if (blockIds.length === 0) return null;

  const { data: members, error: mErr } = await supabaseAdmin
    .from('league_block_members')
    .select('league_block_id, player_id')
    .in('league_block_id', blockIds)
    .in('player_id', [playerA, playerB]);

  if (mErr || !members || members.length === 0) return null;

  const map = new Map<string, Set<string>>();
  for (const row of members as any[]) {
    const bid = String(row.league_block_id);
    const pid = String(row.player_id);
    if (!map.has(bid)) map.set(bid, new Set());
    map.get(bid)!.add(pid);
  }

  for (const [bid, set] of map) {
    if (set.has(playerA) && set.has(playerB)) return bid;
  }
  return null;
}

/**
 * league_block_id + 2プレーヤーで既存の試合カードを探す（順序不問）
 * ※ limit を使うので order を明示
 */
async function findExistingLeagueMatch(
  leagueBlockId: string,
  playerA: string,
  playerB: string
): Promise<
  | {
      id: string;
      player_a_id: string | null;
      player_b_id: string | null;
      winner_id: string | null;
      loser_id: string | null;
      winner_score: number | null;
      loser_score: number | null;
      status: string | null;
    }
  | null
> {
  const a = playerA;
  const b = playerB;
  const orExpr = `and(player_a_id.eq.${a},player_b_id.eq.${b}),and(player_a_id.eq.${b},player_b_id.eq.${a})`;

  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('id,player_a_id,player_b_id,winner_id,loser_id,winner_score,loser_score,status')
    .eq('league_block_id', leagueBlockId)
    .or(orExpr)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: String((data as any).id),
    player_a_id: (data as any).player_a_id ? String((data as any).player_a_id) : null,
    player_b_id: (data as any).player_b_id ? String((data as any).player_b_id) : null,
    winner_id: (data as any).winner_id ? String((data as any).winner_id) : null,
    loser_id: (data as any).loser_id ? String((data as any).loser_id) : null,
    winner_score: typeof (data as any).winner_score === 'number' ? (data as any).winner_score : null,
    loser_score: typeof (data as any).loser_score === 'number' ? (data as any).loser_score : null,
    status: (data as any).status ?? null,
  };
}

/**
 * match_entries を side/team_no/score まで揃えて2行作る
 */
async function ensureSinglesMatchEntries(
  matchId: string,
  playerA: string,
  playerB: string,
  winnerId: string,
  loserId: string,
  winnerScore: number,
  loserScore: number
) {
  const scoreA = winnerId === playerA ? winnerScore : loserScore;
  const scoreB = winnerId === playerB ? winnerScore : loserScore;

  await upsertEntry(matchId, playerA, 'a', 1, scoreA);
  await upsertEntry(matchId, playerB, 'b', 2, scoreB);
}

async function upsertEntry(
  matchId: string,
  playerId: string,
  side: 'a' | 'b',
  teamNo: number,
  score: number
) {
  const { data: upd1, error: upErr1 } = await supabaseAdmin
    .from('match_entries')
    .update({ side, team_no: teamNo, score })
    .eq('match_id', matchId)
    .eq('player_id', playerId)
    .select('match_id');

  if (upErr1) throw new Error(upErr1.message);
  if (upd1 && (upd1 as any[]).length > 0) return;

  const { error: insErr } = await supabaseAdmin.from('match_entries').insert({
    match_id: matchId,
    player_id: playerId,
    side,
    team_no: teamNo,
    score,
  });

  if (!insErr) return;

  if ((insErr as any).code === '23505') {
    const { error: upErr2 } = await supabaseAdmin
      .from('match_entries')
      .update({ player_id: playerId, team_no: teamNo, score })
      .eq('match_id', matchId)
      .eq('side', side);

    if (upErr2) throw new Error(upErr2.message);
    return;
  }

  throw new Error(insErr.message);
}

/** ★追加：リーグブロックの順位を再計算（失敗しても試合登録は成功扱い） */
async function tryFinalizeLeagueBlock(blockId: string | null) {
  if (!blockId) return;
  const { error } = await supabaseAdmin.rpc('finalize_league_block', {
    p_block_id: blockId,
  });
  if (error) console.warn('[matches API] finalize_league_block warning:', error);
}

/** ★追加：新規作成途中で失敗したら match を掃除（pending/ゴミを残さない） */
async function cleanupCreatedMatch(matchId: string) {
  try {
    // FK cascade があっても無害。無ければ手動で消す。
    await supabaseAdmin.from('match_entries').delete().eq('match_id', matchId);
    await supabaseAdmin.from('match_teams').delete().eq('match_id', matchId);
    await supabaseAdmin.from('matches').delete().eq('id', matchId);
  } catch (e) {
    console.warn('[matches API] cleanup warning:', e);
  }
}

/* ===================== Handler ===================== */

export async function POST(req: NextRequest) {
  // ★新規作成した match を catch で掃除するために保持
  let createdMatchId: string | null = null;

  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json({ ok: false, message: 'Supabase 環境変数が未設定です。' }, { status: 500 });
    }

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

    await ensureReporterPlayer(
      reporter_id,
      (userData.user.user_metadata?.name as string | undefined) ||
        (userData.user.email as string | undefined) ||
        null
    );

    const admin = await isAdminPlayer(reporter_id);

    const body = (await req.json().catch(() => null)) as Partial<Body> | null;
    if (!body) {
      return NextResponse.json({ ok: false, message: '不正なリクエストです。' }, { status: 400 });
    }

    const match_date = String(body.match_date || '').trim();
    if (!match_date) {
      return NextResponse.json({ ok: false, message: '試合日時が未指定です。' }, { status: 400 });
    }

    const winner_score = clamp(toInt((body as any).winner_score ?? 15, 15) || 15, 0, 99);
    const loser_score = clamp(toInt((body as any).loser_score ?? 0, 0), 0, 14);

    const rawTournamentId = (body as any).tournament_id;
    const tournament_id =
      typeof rawTournamentId === 'string' && rawTournamentId.trim() !== '' ? rawTournamentId : null;

    const winner_team_id = (body as TeamsPayload).winner_team_id;
    const loser_team_id = (body as TeamsPayload).loser_team_id;
    const winner_id_raw = (body as SinglesPayload).winner_id;
    const loser_id_raw = (body as SinglesPayload).loser_id;

    const inferredMode: 'singles' | 'teams' | null =
      winner_team_id || loser_team_id ? 'teams' : winner_id_raw || loser_id_raw ? 'singles' : null;

    if (!inferredMode) {
      return NextResponse.json({ ok: false, message: '勝者/敗者を選択してください。' }, { status: 400 });
    }

    /* ===================== Singles ===================== */
    if (inferredMode === 'singles') {
      const winner_id = String(winner_id_raw || '');
      const loser_id = String(loser_id_raw || '');

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

      let league_block_id: string | null = null;
      if (tournament_id) {
        league_block_id = await findLeagueBlockIdForPlayers(tournament_id, winner_id, loser_id);
      }

      const apply = (body as SinglesPayload).apply_rating ?? true;

      // 既存のリーグカードに結果を入れる
      if (league_block_id) {
        const existing = await findExistingLeagueMatch(league_block_id, winner_id, loser_id);

        if (existing?.id) {
          const a = existing.player_a_id ?? winner_id;
          const b = existing.player_b_id ?? loser_id;

          await ensureSinglesMatchEntries(existing.id, a, b, winner_id, loser_id, winner_score, loser_score);

          const wasFinalized =
            (existing.winner_id && existing.loser_id) ||
            (existing.winner_score != null && existing.loser_score != null) ||
            existing.status === 'finalized';

          const { error: upErr } = await supabaseAdmin
            .from('matches')
            .update({
              mode: 'singles',
              status: 'finalized',
              match_date,
              reporter_id,
              winner_id,
              loser_id,
              winner_score,
              loser_score,
              winner_team_no: 0,
              loser_team_no: 0,
              tournament_id,
              league_block_id,
              player_a_id: a,
              player_b_id: b,
              is_tournament: tournament_id ? true : undefined,
              venue: (body as any).venue ?? null,
              notes: (body as any).notes ?? null,
            })
            .eq('id', existing.id);

          if (upErr) {
            return NextResponse.json({ ok: false, message: `登録に失敗しました: ${upErr.message}` }, { status: 500 });
          }

          if (apply && !wasFinalized) {
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

          await tryFinalizeLeagueBlock(league_block_id);

          return NextResponse.json({ ok: true, match_id: existing.id }, { status: 201 });
        }
      }

      /**
       * ★重要：フォールバック新規作成は「pending を作らない」
       * - 最初から finalized + winner/loser/score を入れて insert
       * - その後 entries 作成
       * - entries が失敗したら作った match を削除してロールバック
       */
      const { data: ins, error: insErr } = await supabaseAdmin
        .from('matches')
        .insert({
          mode: 'singles',
          status: 'finalized', // ← pending を作らない
          match_date,
          reporter_id,
          tournament_id,
          league_block_id: league_block_id ?? null,
          player_a_id: winner_id,
          player_b_id: loser_id,
          winner_id,
          loser_id,
          winner_score,
          loser_score,
          winner_team_no: 0,
          loser_team_no: 0,
          is_tournament: tournament_id ? true : undefined,
          venue: (body as any).venue ?? null,
          notes: (body as any).notes ?? null,
        })
        .select('id')
        .single();

      if (insErr || !ins?.id) {
        return NextResponse.json(
          { ok: false, message: `登録に失敗しました: ${insErr?.message || 'match_id 不明'}` },
          { status: 500 }
        );
      }

      createdMatchId = String(ins.id);

      // entries 作成（失敗したら createdMatchId を掃除）
      try {
        await ensureSinglesMatchEntries(
          createdMatchId,
          winner_id,
          loser_id,
          winner_id,
          loser_id,
          winner_score,
          loser_score
        );
      } catch (e) {
        await cleanupCreatedMatch(createdMatchId);
        createdMatchId = null;
        throw e;
      }

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

      await tryFinalizeLeagueBlock(league_block_id);

      const okId = createdMatchId;
      createdMatchId = null; // 正常終了なので掃除対象から外す

      return NextResponse.json({ ok: true, match_id: okId }, { status: 201 });
    }

    /* ===================== Teams ===================== */
    const winner_team_id_str = String(winner_team_id || '');
    const loser_team_id_str = String(loser_team_id || '');

    if (!winner_team_id_str || !loser_team_id_str) {
      return NextResponse.json({ ok: false, message: '勝利チーム/敗北チームを選択してください。' }, { status: 400 });
    }
    if (winner_team_id_str === loser_team_id_str) {
      return NextResponse.json({ ok: false, message: '同一チームは選べません。' }, { status: 400 });
    }

    if (!admin) {
      const ok =
        (await isMemberOfTeam(reporter_id, winner_team_id_str)) ||
        (await isMemberOfTeam(reporter_id, loser_team_id_str));
      if (!ok) {
        return NextResponse.json(
          { ok: false, message: '所属チームの試合のみ登録できます（管理者は除外）。' },
          { status: 403 }
        );
      }
    }

    const { data: ins, error: mErr } = await supabaseAdmin
      .from('matches')
      .insert({
        mode: 'teams',
        status: 'finalized',
        match_date,
        reporter_id,
        winner_score,
        loser_score,
        winner_team_no: 1,
        loser_team_no: 2,
        tournament_id,
        is_tournament: tournament_id ? true : undefined,
        venue: (body as any).venue ?? null,
        notes: (body as any).notes ?? null,
      })
      .select('id')
      .single();

    if (mErr || !ins?.id) {
      return NextResponse.json(
        { ok: false, message: `登録に失敗しました: ${mErr?.message || 'match_id 不明'}` },
        { status: 500 }
      );
    }

    createdMatchId = String(ins.id);

    const { error: mtErr } = await supabaseAdmin.from('match_teams').insert([
      { match_id: createdMatchId, team_id: winner_team_id_str, team_no: 1 },
      { match_id: createdMatchId, team_id: loser_team_id_str, team_no: 2 },
    ]);

    if (mtErr) {
      await cleanupCreatedMatch(createdMatchId);
      createdMatchId = null;
      return NextResponse.json(
        { ok: false, message: `チーム割当の登録に失敗しました: ${mtErr.message}` },
        { status: 500 }
      );
    }

    const okId = createdMatchId;
    createdMatchId = null;

    return NextResponse.json({ ok: true, match_id: okId }, { status: 201 });
  } catch (e: any) {
    console.error('[api/matches] fatal:', e);

    // ★新規作成途中で落ちた場合は掃除（pending/不完全データを残さない）
    if (createdMatchId) {
      await cleanupCreatedMatch(createdMatchId);
      createdMatchId = null;
    }

    return NextResponse.json(
      { ok: false, message: `登録に失敗しました: ${e?.message ?? 'サーバエラーが発生しました。'}` },
      { status: 500 }
    );
  }
}
