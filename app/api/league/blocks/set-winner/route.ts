import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getServiceKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SECRET
  );
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = getServiceKey();

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Server env is missing. Set NEXT_PUBLIC_SUPABASE_URL and one of SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY.",
        },
        { status: 500 }
      );
    }

    // Bearer token required
    const auth = req.headers.get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return NextResponse.json({ ok: false, message: "Missing Authorization Bearer token" }, { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Verify user
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
    }
    const userId = userData.user.id;

    // Check admin (app_admins OR players.is_admin)
    const [r1, r2] = await Promise.all([
      admin.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle(),
      admin.from("players").select("is_admin").eq("id", userId).maybeSingle(),
    ]);

    const isAdmin = Boolean(r1.data?.user_id) || r2.data?.is_admin === true;
    if (!isAdmin) {
      return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const block_id = String(body?.block_id ?? "").trim();
    const winner_player_id_raw = body?.winner_player_id;
    const winner_player_id =
      winner_player_id_raw == null || String(winner_player_id_raw).trim() === ""
        ? null
        : String(winner_player_id_raw).trim();

    if (!block_id) {
      return NextResponse.json({ ok: false, message: "block_id is required" }, { status: 400 });
    }

    const { error: upErr } = await admin
      .from("league_blocks")
      .update({ winner_player_id } as any)
      .eq("id", block_id);

    if (upErr) {
      return NextResponse.json({ ok: false, message: upErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: e?.message || "Unknown error" }, { status: 500 });
  }
}
