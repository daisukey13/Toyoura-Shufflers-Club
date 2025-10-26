// app/api/admin/ranking-config/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULTS = {
  k_factor: 32,
  score_diff_multiplier: 1,
  handicap_diff_multiplier: 1,
  win_threshold_handicap_change: 0,
  handicap_change_amount: 0,
};

async function isAdmin(userId: string | null): Promise<boolean> {
  if (!userId) return false;

  // players.is_admin または app_admins に存在すればOK
  const [p, a] = await Promise.all([
    supabaseAdmin
      .from("players")
      .select("is_admin")
      .eq("id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("app_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const pOk = !!(p.data as any)?.is_admin;
  const aOk = !!(a.data as any)?.user_id;
  return pOk || aOk;
}

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("ranking_config")
      .select(
        "k_factor, score_diff_multiplier, handicap_diff_multiplier, win_threshold_handicap_change, handicap_change_amount",
      )
      .eq("id", "global")
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ ok: true, config: data ?? DEFAULTS });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message || "failed" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const uid = req.headers.get("x-user-id") || null;
    if (!(await isAdmin(uid))) {
      return NextResponse.json(
        { ok: false, message: "forbidden" },
        { status: 403 },
      );
    }

    const body = await req.json();
    const payload = {
      k_factor: Number(body?.k_factor) || DEFAULTS.k_factor,
      score_diff_multiplier:
        Number(body?.score_diff_multiplier) || DEFAULTS.score_diff_multiplier,
      handicap_diff_multiplier:
        Number(body?.handicap_diff_multiplier) ||
        DEFAULTS.handicap_diff_multiplier,
      win_threshold_handicap_change:
        Number(body?.win_threshold_handicap_change) ||
        DEFAULTS.win_threshold_handicap_change,
      handicap_change_amount:
        Number(body?.handicap_change_amount) || DEFAULTS.handicap_change_amount,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from("ranking_config")
      .upsert({ id: "global", ...payload }, { onConflict: "id" });

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message || "failed" },
      { status: 500 },
    );
  }
}
