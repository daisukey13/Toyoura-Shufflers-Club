// app/api/admin/matches/teams/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: Request) {
  try {
    const supabaseAdmin = adminClient();

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return NextResponse.json({ ok: false, message: "Missing Authorization token" }, { status: 401 });
    }

    const { data: ures, error: uerr } = await supabaseAdmin.auth.getUser(token);
    if (uerr || !ures?.user) {
      return NextResponse.json({ ok: false, message: "Invalid token" }, { status: 401 });
    }

    const adminUserId = ures.user.id;

    // 管理者判定（players.is_admin）
    const { data: me, error: meErr } = await supabaseAdmin
      .from("players")
      .select("id, is_admin")
      .eq("id", adminUserId)
      .maybeSingle();

    if (meErr) throw meErr;
    if (!me?.is_admin) {
      return NextResponse.json({ ok: false, message: "Admin only" }, { status: 403 });
    }

    const body = await req.json();
    const winner_team_id = String(body?.winner_team_id || "");
    const loser_team_id = String(body?.loser_team_id || "");
    const winner_score = Number(body?.winner_score ?? 0);
    const loser_score = Number(body?.loser_score ?? 0);
    const match_date = body?.match_date ? String(body.match_date) : new Date().toISOString();

    if (!winner_team_id || !loser_team_id || winner_team_id === loser_team_id) {
      return NextResponse.json({ ok: false, message: "winner_team_id / loser_team_id is invalid" }, { status: 400 });
    }

    // 1) matches 作成（チーム戦）
    const { data: m, error: mErr } = await supabaseAdmin
      .from("matches")
      .insert([
        {
          mode: "team",
          status: "completed",
          match_date,
          winner_score,
          loser_score,
        } as any,
      ])
      .select("id")
      .single();

    if (mErr) throw mErr;
    const matchId = String(m.id);

    // 2) match_teams 作成
    const { error: mtErr } = await supabaseAdmin.from("match_teams").insert([
      { match_id: matchId, team_id: winner_team_id, side_no: 1 },
      { match_id: matchId, team_id: loser_team_id, side_no: 2 },
    ] as any);

    if (mtErr) throw mtErr;

    // 3) teams の勝敗/試合数を更新（原子的）
    const { error: rpcErr } = await supabaseAdmin.rpc("admin_apply_team_match_result", {
      winner_team_id,
      loser_team_id,
    });

    if (rpcErr) throw rpcErr;

    return NextResponse.json({ ok: true, match_id: matchId });
  } catch (e: any) {
    console.error("[admin team match] error:", e);
    return NextResponse.json(
      { ok: false, message: e?.message ?? "Failed" },
      { status: 500 }
    );
  }
}
