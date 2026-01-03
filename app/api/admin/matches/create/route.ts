// app/api/admin/matches/create/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";
  return { url, serviceKey };
}

function getBearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

export async function POST(req: Request) {
  const { url, serviceKey } = getEnv();
  if (!url || !serviceKey) {
    return NextResponse.json(
      { ok: false, message: "Supabase env が不足しています（URL / SERVICE_ROLE_KEY）" },
      { status: 500 }
    );
  }

  const token = getBearer(req);
  if (!token) {
    return NextResponse.json(
      { ok: false, message: "認証トークンがありません（Authorization: Bearer ...）" },
      { status: 401 }
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  // 1) token からユーザー特定
  const { data: ures, error: uerr } = await admin.auth.getUser(token);
  if (uerr || !ures?.user) {
    return NextResponse.json(
      { ok: false, message: "認証に失敗しました" },
      { status: 401 }
    );
  }
  const adminUserId = ures.user.id;

  // 2) 管理者判定（players.is_admin）
  const { data: p, error: perr } = await admin
    .from("players")
    .select("is_admin")
    .eq("id", adminUserId)
    .maybeSingle();

  if (perr) {
    return NextResponse.json(
      { ok: false, message: `管理者判定に失敗しました: ${perr.message}` },
      { status: 500 }
    );
  }
  if (!p?.is_admin) {
    return NextResponse.json(
      { ok: false, message: "管理者のみ実行できます" },
      { status: 403 }
    );
  }

  // 3) 入力
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const winner_id = String(body?.winner_id || "");
  const loser_id = String(body?.loser_id || "");
  const winner_score = Number(body?.winner_score);
  const loser_score = Number(body?.loser_score);
  const match_date = body?.match_date ? String(body.match_date) : new Date().toISOString();

  if (!winner_id || !loser_id || winner_id === loser_id) {
    return NextResponse.json(
      { ok: false, message: "勝者と敗者を正しく選択してください" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(winner_score) || !Number.isFinite(loser_score)) {
    return NextResponse.json(
      { ok: false, message: "スコアを正しく入力してください" },
      { status: 400 }
    );
  }

  // 4) matches 作成 → match_players 2行
  const { data: m, error: merr } = await admin
    .from("matches")
    .insert([
      {
        mode: "singles",
        status: "completed",
        match_date,
        winner_score,
        loser_score,
      },
    ])
    .select("id")
    .single();

  if (merr || !m?.id) {
    return NextResponse.json(
      { ok: false, message: `matches 作成に失敗しました: ${merr?.message || "unknown"}` },
      { status: 500 }
    );
  }

  const match_id = m.id as string;

  const { error: mpErr } = await admin.from("match_players").insert([
    { match_id, player_id: winner_id, side_no: 1 },
    { match_id, player_id: loser_id, side_no: 2 },
  ]);

  if (mpErr) {
    // 片方だけ入った状態を避けるため、失敗時は matches を消す（ベストエフォート）
    try {
      await admin.from("matches").delete().eq("id", match_id);
    } catch {}
    return NextResponse.json(
      { ok: false, message: `match_players 作成に失敗しました: ${mpErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, match_id });
}
