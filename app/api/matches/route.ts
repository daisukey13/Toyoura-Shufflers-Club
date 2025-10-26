// app/api/matches/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ===================== Feature Flags ===================== */
const PREFER_RPC = process.env.NEXT_PUBLIC_PREFER_MATCH_RPC !== "false";
const hasSrv = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/* ===================== Types ===================== */
type SinglesPayload = {
  mode?: "singles" | "single" | "player" | string;
  match_date: string; // 'YYYY-MM-DD' or ISO
  winner_id: string;
  loser_id: string;
  winner_score?: number; // 既定 15
  loser_score: number; // 0..14
  venue?: string | null;
  notes?: string | null;
  apply_rating?: boolean; // default: true
};

type TeamsPayload_WinLose = {
  mode?: "teams" | "team" | string;
  match_date: string; // 'YYYY-MM-DD' or ISO
  winner_team_id: string;
  loser_team_id: string;
  winner_score?: number; // default: 15
  loser_score: number; // 0..14
  venue?: string | null;
  notes?: string | null;
};

// フロントの別系統で送られることがある“スコアから勝敗判定”型
type TeamsPayload_Scored = {
  mode?: "teams" | "team" | string;
  match_date: string; // 'YYYY-MM-DD' or ISO
  team1_id: string;
  team2_id: string;
  team1_score: number;
  team2_score: number;
  venue?: string | null;
  notes?: string | null;
};

type Body = SinglesPayload | TeamsPayload_WinLose | TeamsPayload_Scored;

/* ===================== Utils ===================== */
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
const toInt = (v: unknown, fb = 0) => {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fb;
};
const isDateYYYYMMDD = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** 受け取った日時（YYYY-MM-DD / ISO / datetime-local）を ISO8601 文字列へ正規化 */
function normalizeToISO(input: unknown): string {
  if (!input) return new Date().toISOString();
  const s = String(input).trim();
  if (!s) return new Date().toISOString();
  if (isDateYYYYMMDD(s)) return new Date(`${s}T00:00:00`).toISOString();
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return new Date().toISOString();
}
/** RPC が YYYY-MM-DD を要求する場合に切り出し */
function isoToYYYYMMDD(iso: string) {
  return iso.slice(0, 10);
}

/** ELO ライク（勝者 15 固定、敗者 0..14 の点差を利用、HC差も微調整） */
function calcDelta(
  wPts: number,
  lPts: number,
  wH: number,
  lH: number,
  scoreDiff: number,
) {
  const K = 32;
  const expW = 1 / (1 + Math.pow(10, (lPts - wPts) / 400));
  const diffMul = 1 + scoreDiff / 30; // 点差係数
  const hcMul = 1 + (wH - lH) / 50; // HC差係数（控えめ）

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

/* ===================== Admin/DB helpers ===================== */
async function ensureReporterPlayerIfAdmin(
  reporterId: string,
  displayName: string | null,
) {
  if (!hasSrv) return;
  const { data } = await supabaseAdmin
    .from("players")
    .select("id")
    .eq("id", reporterId)
    .maybeSingle();
  if (data) return;

  const baseName = (displayName || "").trim();
  const handle_name = baseName || `user_${reporterId.slice(0, 8)}`;
  const { error } = await supabaseAdmin.from("players").upsert(
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
    { onConflict: "id" },
  );
  if (error)
    throw new Error(`reporter の players 作成に失敗: ${error.message}`);
}

async function isAdminPlayer(playerId: string): Promise<boolean> {
  if (!hasSrv) return false;
  const { data } = await supabaseAdmin
    .from("players")
    .select("is_admin")
    .eq("id", playerId)
    .maybeSingle();
  return Boolean(data?.is_admin);
}

async function isMemberOfTeam(
  playerId: string,
  teamId: string,
): Promise<boolean> {
  if (!hasSrv) return false;
  const candidates = [
    { table: "team_members", playerCol: "player_id", teamCol: "team_id" },
    { table: "players_teams", playerCol: "player_id", teamCol: "team_id" },
    { table: "team_players", playerCol: "player_id", teamCol: "team_id" },
    { table: "memberships", playerCol: "player_id", teamCol: "team_id" },
  ] as const;
  for (const c of candidates) {
    const { data, error } = await supabaseAdmin
      .from(c.table)
      .select("team_id")
      .eq(c.playerCol, playerId)
      .eq(c.teamCol, teamId)
      .limit(1);
    if (!error && data && data.length > 0) return true;
  }
  return false;
}

/** 未知カラムを落としつつ UPDATE */
async function softUpdate(
  client: any,
  table: string,
  patch: Record<string, any>,
  filters: Array<{ col: string; val: any }>,
) {
  let body = { ...patch };
  let guard = 0;

  while (Object.keys(body).length > 0 && guard++ < 16) {
    let q = client.from(table).update(body);
    for (const f of filters) q = q.eq(f.col, f.val);
    const { error } = await q;
    if (!error) return true;

    const m = String(error?.message || "");
    const colNotExist = /column "([^"]+)" .* does not exist/i.exec(m);
    if (colNotExist) {
      delete body[colNotExist[1]];
      continue;
    }
    break;
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

  while (guard++ < 16) {
    const { data, error } = await client
      .from("matches")
      .insert(row)
      .select("id")
      .single();
    if (!error && data) return { id: data.id as string };

    const m = String(error?.message || "");

    if (
      /invalid input value for enum|violates check constraint/i.test(m) &&
      "mode" in row &&
      modeIdx + 1 < modeAlternatives.length
    ) {
      modeIdx += 1;
      row = { ...row, mode: modeAlternatives[modeIdx] };
      continue;
    }

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

    const notNull = /null value in column "([^"]+)"/i.exec(m);
    if (notNull) {
      const col = notNull[1];
      if (!(col in row) || row[col] == null) {
        if (col === "status") {
          row = { ...row, status: "finalized" };
          continue;
        }
        if (col === "winner_team_no") {
          row = { ...row, winner_team_no: 1 };
          continue;
        }
        if (col === "loser_team_no") {
          row = { ...row, loser_team_no: 2 };
          continue;
        }
        if (col === "winner_score") {
          row = { ...row, winner_score: 15 };
          continue;
        }
        if (col === "loser_score") {
          row = { ...row, loser_score: 0 };
          continue;
        }
      }
    }

    throw error;
  }
  throw new Error("insert failed after multiple fallbacks");
}

/** match_players の2行（勝者/敗者）を“必要なら”作成（未知列は捨てる） */
async function ensureMatchPlayersRows(
  client: any,
  params: {
    match_id: string;
    winner_id: string;
    loser_id: string;
    winner_score: number;
    loser_score: number;
  },
) {
  const { match_id, winner_id, loser_id, winner_score, loser_score } = params;

  try {
    const { data } = await client
      .from("match_players")
      .select("match_id, player_id")
      .eq("match_id", match_id)
      .limit(2);
    if (Array.isArray(data) && data.length >= 2) return;
  } catch {
    /* noop */
  }

  const looseInsert = async (row: Record<string, any>) => {
    let body = { ...row };
    let guard = 0;
    while (guard++ < 8) {
      const { error } = await client
        .from("match_players")
        .insert(body)
        .single();
      if (!error) return true;
      const msg = String(error?.message || "");
      if (/relation .* does not exist/i.test(msg)) return false;
      if (/duplicate key value|already exists|23505/i.test(msg)) return true;
      const m1 = /column "([^"]+)" .* does not exist/i.exec(msg);
      if (m1) {
        delete body[m1[1]];
        continue;
      }
      const m3 = /null value in column "([^"]+)"/i.exec(msg);
      if (m3 && /(created|updated)_at/i.test(m3[1])) {
        body[m3[1]] = new Date().toISOString();
        continue;
      }
      return false;
    }
    return false;
  };

  await looseInsert({
    match_id,
    player_id: winner_id,
    side_no: 1,
    team_no: 1,
    result: "win",
    is_winner: true,
    score: winner_score,
  });
  await looseInsert({
    match_id,
    player_id: loser_id,
    side_no: 2,
    team_no: 2,
    result: "loss",
    is_winner: false,
    score: loser_score,
  });
}

async function persistDeltas(
  client: any,
  params: {
    match_id: string;
    winner_id: string;
    loser_id: string;
    winnerSide?: number;
    loserSide?: number;
    winner: { points: number; handicap: number };
    loser: { points: number; handicap: number };
    ratingApplied: boolean;
  },
) {
  const { match_id, winner_id, loser_id, winner, loser, ratingApplied } =
    params;
  const side1 = params.winnerSide ?? 1;
  const side2 = params.loserSide ?? 2;

  const triedChange = await softUpdate(
    client,
    "matches",
    {
      winner_points_change: winner.points,
      loser_points_change: loser.points,
      winner_handicap_change: winner.handicap,
      loser_handicap_change: loser.handicap,
      rating_applied: ratingApplied,
    },
    [{ col: "id", val: match_id }],
  );

  if (!triedChange) {
    await softUpdate(
      client,
      "matches",
      {
        winner_points_delta: winner.points,
        loser_points_delta: loser.points,
        winner_handicap_delta: winner.handicap,
        loser_handicap_delta: loser.handicap,
        rating_applied: ratingApplied,
      },
      [{ col: "id", val: match_id }],
    );
  }

  await softUpdate(
    client,
    "matches",
    {
      winner_rp_delta: winner.points,
      loser_rp_delta: loser.points,
      winner_hc_delta: winner.handicap,
      loser_hc_delta: loser.handicap,
    },
    [{ col: "id", val: match_id }],
  );

  await softUpdate(
    client,
    "match_players",
    { rp_delta: winner.points, hc_delta: winner.handicap },
    [
      { col: "match_id", val: match_id },
      { col: "player_id", val: winner_id },
    ],
  );
  await softUpdate(
    client,
    "match_players",
    { rp_delta: loser.points, hc_delta: loser.handicap },
    [
      { col: "match_id", val: match_id },
      { col: "player_id", val: loser_id },
    ],
  );
  await softUpdate(
    client,
    "match_players",
    { rp_delta: winner.points, hc_delta: winner.handicap },
    [
      { col: "match_id", val: match_id },
      { col: "side_no", val: side1 },
    ],
  );
  await softUpdate(
    client,
    "match_players",
    { rp_delta: loser.points, hc_delta: loser.handicap },
    [
      { col: "match_id", val: match_id },
      { col: "side_no", val: side2 },
    ],
  );
}

/** match_teams が無い/列が無い場合のフォールバック（matches に直置き） */
async function fallbackWriteTeamsIntoMatches(
  client: any,
  matchId: string,
  winner_team_id: string,
  loser_team_id: string,
) {
  let u = await client
    .from("matches")
    .update({ winner_team_id, loser_team_id } as any)
    .eq("id", matchId);
  if (!u.error) return true;
  await client
    .from("matches")
    .update({ winner_team_id } as any)
    .eq("id", matchId);
  await client
    .from("matches")
    .update({ loser_team_id } as any)
    .eq("id", matchId);
  return true;
}

/* ===================== RPC helper ===================== */
async function tryRpcRecordSinglesMatch(
  supa: any,
  args: {
    match_date: string;
    winner_id: string;
    loser_id: string;
    loser_score: number;
    venue: string | null;
    notes: string | null;
    apply_rating: boolean;
  },
): Promise<
  { ok: true; row: any } | { ok: false; error: string; retryable: boolean }
> {
  try {
    const { data, error } = await supa.rpc("record_singles_match", {
      p_match_date: args.match_date,
      p_winner_id: args.winner_id,
      p_loser_id: args.loser_id,
      p_loser_score: args.loser_score,
      p_venue: args.venue,
      p_notes: args.notes,
      p_apply_rating: args.apply_rating,
    });
    if (error) {
      const msg = String(error.message || "");
      const code = (error as any).code as string | undefined;
      const retryable =
        /undefined function|does not exist|42P01|42883|permission denied/i.test(
          msg,
        ) ||
        code === "42P01" ||
        code === "42883";
      return { ok: false, error: msg, retryable };
    }
    return { ok: true, row: data };
  } catch (e: any) {
    const msg = String(e?.message || e);
    const retryable =
      /undefined function|does not exist|42P01|42883|permission denied/i.test(
        msg,
      );
    return { ok: false, error: msg, retryable };
  }
}

/* ===================== Handler ===================== */
export async function POST(req: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!url || !anon) {
      return NextResponse.json(
        { ok: false, message: "Supabase 環境変数が未設定です。" },
        { status: 500 },
      );
    }

    const cookieStore = cookies();
    const userClient = createServerClient(url, anon, {
      cookies: {
        get: (n: string) => cookieStore.get(n)?.value,
        set: (n: string, v: string, o?: any) =>
          cookieStore.set({ name: n, value: v, ...(o || {}) } as any),
        remove: (n: string, o?: any) =>
          cookieStore.set({ name: n, value: "", ...(o || {}) } as any),
      },
    } as any);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json(
        { ok: false, message: "認証が必要です。" },
        { status: 401 },
      );
    }
    const reporter_id = userData.user.id;

    await ensureReporterPlayerIfAdmin(
      reporter_id,
      (userData.user.user_metadata?.name as string | undefined) ||
        (userData.user.email as string | undefined) ||
        null,
    );

    const admin = await isAdminPlayer(reporter_id);
    const db = hasSrv ? supabaseAdmin : (userClient as any);

    // 入力
    const body = (await req.json().catch(() => null)) as Partial<Body> | null;
    if (!body || !body.mode) {
      return NextResponse.json(
        { ok: false, message: "不正なリクエストです。" },
        { status: 400 },
      );
    }

    const rawMode = String(body.mode).trim();
    // ★ 日付の受理をゆるく：YYYY-MM-DD / ISO / datetime-local をすべて許可
    const match_date_iso = normalizeToISO((body as any).match_date);
    const match_date_ymd = isoToYYYYMMDD(match_date_iso);

    const venue = (body as any).venue ?? null;
    const notes = (body as any).notes ?? null;

    /* ─────────────── 個人戦 ─────────────── */
    if (
      /^sing/i.test(rawMode) ||
      /^single$/i.test(rawMode) ||
      /^player$/i.test(rawMode)
    ) {
      const winner_id = String((body as SinglesPayload).winner_id || "");
      const loser_id = String((body as SinglesPayload).loser_id || "");
      const apply_rating = (body as SinglesPayload).apply_rating ?? true;

      const winner_score = clamp(
        toInt((body as SinglesPayload).winner_score, 15) || 15,
        0,
        99,
      );
      const loser_score = clamp(
        toInt((body as SinglesPayload).loser_score, 0),
        0,
        14,
      );

      if (!winner_id || !loser_id) {
        return NextResponse.json(
          { ok: false, message: "勝者/敗者を選択してください。" },
          { status: 400 },
        );
      }
      if (winner_id === loser_id) {
        return NextResponse.json(
          { ok: false, message: "同一プレイヤーは選べません。" },
          { status: 400 },
        );
      }

      if (!admin && reporter_id !== winner_id && reporter_id !== loser_id) {
        return NextResponse.json(
          {
            ok: false,
            message: "自分が出場した試合のみ登録できます（管理者は除外）。",
          },
          { status: 403 },
        );
      }

      // A) RPC 優先（RPC 側が date 型想定なら YYYY-MM-DD を渡す）
      if (PREFER_RPC) {
        const rpc = await tryRpcRecordSinglesMatch(userClient, {
          match_date: match_date_ymd,
          winner_id,
          loser_id,
          loser_score,
          venue,
          notes,
          apply_rating,
        });

        if (rpc.ok) {
          const row = rpc.row;
          const deltas =
            row &&
            ("winner_points_change" in row || "winner_points_delta" in row)
              ? {
                  winner: {
                    points: toInt(
                      row.winner_points_change ??
                        row.winner_points_delta ??
                        row.winner_rp_delta ??
                        0,
                      0,
                    ),
                    handicap: toInt(
                      row.winner_handicap_change ??
                        row.winner_handicap_delta ??
                        row.winner_hc_delta ??
                        0,
                      0,
                    ),
                  },
                  loser: {
                    points: toInt(
                      row.loser_points_change ??
                        row.loser_points_delta ??
                        row.loser_rp_delta ??
                        0,
                      0,
                    ),
                    handicap: toInt(
                      row.loser_handicap_change ??
                        row.loser_handicap_delta ??
                        row.loser_hc_delta ??
                        0,
                      0,
                    ),
                  },
                }
              : null;

          return NextResponse.json(
            {
              ok: true,
              match_id: row.id,
              winner_id,
              loser_id,
              apply_rating: !!apply_rating,
              deltas,
            },
            { status: 201 },
          );
        }
      }

      // B) フォールバック：従来 INSERT
      // 現在値取得
      let w: any = null,
        l: any = null;
      try {
        const { data: players } = await db
          .from("players")
          .select("id, ranking_points, handicap, matches_played, wins, losses")
          .in("id", [winner_id, loser_id]);
        w = players?.find((p: any) => p.id === winner_id);
        l = players?.find((p: any) => p.id === loser_id);
      } catch {
        /* noop */
      }

      const initialRow = {
        mode: "player",
        status: "finalized",
        match_date: match_date_iso,
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
        const ins = await smartInsertMatches(db, initialRow, [
          "player",
          "singles",
          "single",
        ]);

        let deltas: {
          winner: { points: number; handicap: number };
          loser: { points: number; handicap: number };
        } | null = null;

        if (w && l && apply_rating) {
          const diff = 15 - loser_score;
          const d = calcDelta(
            toInt(w.ranking_points, 0),
            toInt(l.ranking_points, 0),
            toInt(w.handicap, 0),
            toInt(l.handicap, 0),
            diff,
          );
          deltas = {
            winner: {
              points: d.winnerPointsChange,
              handicap: d.winnerHandicapChange,
            },
            loser: {
              points: d.loserPointsChange,
              handicap: d.loserHandicapChange,
            },
          };
        }

        await ensureMatchPlayersRows(db, {
          match_id: ins.id,
          winner_id,
          loser_id,
          winner_score,
          loser_score,
        });

        let applied = false;
        if (hasSrv && deltas && apply_rating && w && l) {
          const d = deltas;
          const [uw, ul] = await Promise.all([
            supabaseAdmin
              .from("players")
              .update({
                ranking_points: clamp(
                  toInt(w.ranking_points, 0) + d.winner.points,
                  0,
                  99999,
                ),
                handicap: clamp(
                  toInt(w.handicap, 0) + d.winner.handicap,
                  0,
                  50,
                ),
                matches_played: toInt(w.matches_played, 0) + 1,
                wins: toInt(w.wins, 0) + 1,
                updated_at: new Date().toISOString(),
              })
              .eq("id", winner_id),
            supabaseAdmin
              .from("players")
              .update({
                ranking_points: clamp(
                  toInt(l.ranking_points, 0) + d.loser.points,
                  0,
                  99999,
                ),
                handicap: clamp(toInt(l.handicap, 0) + d.loser.handicap, 0, 50),
                matches_played: toInt(l.matches_played, 0) + 1,
                losses: toInt(l.losses, 0) + 1,
                updated_at: new Date().toISOString(),
              })
              .eq("id", loser_id),
          ]);
          if (uw.error)
            console.warn("[matches API] winner update warning:", uw.error);
          if (ul.error)
            console.warn("[matches API] loser  update warning:", ul.error);
          applied = !uw.error && !ul.error;
        }

        if (deltas) {
          await persistDeltas(hasSrv ? supabaseAdmin : db, {
            match_id: ins.id,
            winner_id,
            loser_id,
            winner: deltas.winner,
            loser: deltas.loser,
            ratingApplied: hasSrv ? applied : false,
          });
        } else {
          await softUpdate(
            hasSrv ? supabaseAdmin : db,
            "matches",
            { rating_applied: false },
            [{ col: "id", val: ins.id }],
          );
        }

        return NextResponse.json(
          {
            ok: true,
            match_id: ins.id,
            winner_id,
            loser_id,
            apply_rating: hasSrv ? !!apply_rating : false,
            deltas: deltas ?? null,
          },
          { status: 201 },
        );
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        if (/row-level security|rls/i.test(msg)) {
          return NextResponse.json(
            {
              ok: false,
              message:
                "DB 権限（RLS）で拒否されました。INSERT ポリシーをご確認ください。",
            },
            { status: 403 },
          );
        }
        if (
          /relation .* does not exist|column .* does not exist|undefined column|invalid input value for enum|violates check constraint|null value in column/i.test(
            msg,
          )
        ) {
          return NextResponse.json(
            { ok: false, message: `スキーマ差異の可能性: ${msg}` },
            { status: 400 },
          );
        }
        console.error("[matches API] singles insert error:", e);
        return NextResponse.json(
          {
            ok: false,
            message: `登録に失敗しました: ${msg || "不明なエラー"}`,
          },
          { status: 400 },
        );
      }
    }

    /* ─────────────── チーム戦（受け取り型ゆる化 + 日付ゆる化） ─────────────── */
    {
      // ① winner_team_id / loser_team_id 直接指定 ② team1_id / team2_id + score の両対応
      let winner_team_id = String(
        (body as TeamsPayload_WinLose).winner_team_id || "",
      );
      let loser_team_id = String(
        (body as TeamsPayload_WinLose).loser_team_id || "",
      );
      let winner_score = clamp(
        toInt((body as any).winner_score, 15) || 15,
        0,
        99,
      );
      let loser_score = clamp(toInt((body as any).loser_score, 0), 0, 14);

      // ②の形が来たらスコアから勝敗を決める
      if (
        (!winner_team_id || !loser_team_id) &&
        "team1_id" in (body as any) &&
        "team2_id" in (body as any) &&
        "team1_score" in (body as any) &&
        "team2_score" in (body as any)
      ) {
        const t1 = String((body as TeamsPayload_Scored).team1_id || "");
        const t2 = String((body as TeamsPayload_Scored).team2_id || "");
        const s1 = toInt((body as TeamsPayload_Scored).team1_score, 0);
        const s2 = toInt((body as TeamsPayload_Scored).team2_score, 0);
        if (!t1 || !t2 || t1 === t2) {
          return NextResponse.json(
            { ok: false, message: "チーム選択が不正です。" },
            { status: 400 },
          );
        }
        if (s1 === s2) {
          return NextResponse.json(
            { ok: false, message: "引き分けは登録できません。" },
            { status: 400 },
          );
        }
        if (s1 > s2) {
          winner_team_id = t1;
          loser_team_id = t2;
          winner_score = 15;
          loser_score = clamp(s2, 0, 14);
        } else {
          winner_team_id = t2;
          loser_team_id = t1;
          winner_score = 15;
          loser_score = clamp(s1, 0, 14);
        }
      }

      if (!winner_team_id || !loser_team_id) {
        return NextResponse.json(
          { ok: false, message: "勝利チーム/敗北チームを選択してください。" },
          { status: 400 },
        );
      }
      if (winner_team_id === loser_team_id) {
        return NextResponse.json(
          { ok: false, message: "同一チームは選べません。" },
          { status: 400 },
        );
      }

      // 所属チェック（service-role のときのみ有効）
      if (
        hasSrv &&
        !(await isMemberOfTeam(reporter_id, winner_team_id)) &&
        !(await isMemberOfTeam(reporter_id, loser_team_id)) &&
        !(await isAdminPlayer(reporter_id))
      ) {
        return NextResponse.json(
          {
            ok: false,
            message: "所属チームの試合のみ登録できます（管理者は除外）。",
          },
          { status: 403 },
        );
      }

      const initialRow = {
        mode: "teams",
        status: "finalized",
        match_date: match_date_iso, // ★ ISOで投入（DB側が date/timestamp でも自動キャスト）
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
        const ins = await smartInsertMatches(db, initialRow, ["teams", "team"]);

        // match_teams がある場合は割当、なければ matches に直書き
        if (hasSrv) {
          const mt = await supabaseAdmin
            .from("match_teams")
            .insert([
              { match_id: ins.id, team_id: winner_team_id, team_no: 1 } as any,
              { match_id: ins.id, team_id: loser_team_id, team_no: 2 } as any,
            ]);
          if (mt.error) {
            if (
              /42P01|42703/.test(String(mt.error.code)) ||
              /does not exist|undefined column/i.test(mt.error.message)
            ) {
              await fallbackWriteTeamsIntoMatches(
                db,
                ins.id,
                winner_team_id,
                loser_team_id,
              );
            } else {
              await supabaseAdmin.from("matches").delete().eq("id", ins.id);
              return NextResponse.json(
                {
                  ok: false,
                  message: `チーム割当の登録に失敗しました: ${mt.error.message}`,
                },
                { status: 500 },
              );
            }
          }
        } else {
          await fallbackWriteTeamsIntoMatches(
            db,
            ins.id,
            winner_team_id,
            loser_team_id,
          );
        }

        return NextResponse.json(
          { ok: true, match_id: ins.id, deltas: null },
          { status: 201 },
        );
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        if (/row-level security|rls/i.test(msg)) {
          return NextResponse.json(
            {
              ok: false,
              message:
                "DB 権限（RLS）で拒否されました。INSERT ポリシーをご確認ください。",
            },
            { status: 403 },
          );
        }
        if (
          /relation .* does not exist|column .* does not exist|undefined column|invalid input value for enum|violates check constraint|null value in column/i.test(
            msg,
          )
        ) {
          return NextResponse.json(
            { ok: false, message: `スキーマ差異の可能性: ${msg}` },
            { status: 400 },
          );
        }
        console.error("[matches API] teams insert error:", e);
        return NextResponse.json(
          {
            ok: false,
            message: `登録に失敗しました: ${msg || "不明なエラー"}`,
          },
          { status: 400 },
        );
      }
    }
  } catch (e: any) {
    console.error("[api/matches] fatal:", e);
    return NextResponse.json(
      { ok: false, message: "サーバエラーが発生しました。" },
      { status: 500 },
    );
  }
}
