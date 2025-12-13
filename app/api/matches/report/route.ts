import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server"; // 使ってる構成に合わせて調整

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const matchId = body?.match_id;

    if (!matchId || typeof matchId !== "string") {
      return NextResponse.json({ ok: false, error: "match_id is required" }, { status: 400 });
    }

    // ここで supabase を使って report 処理を実行（あなたの既存ロジックを移植）
    const supabase = createClient();

    // まず存在確認だけ（例）
    const { data, error } = await supabase
      .from("matches")
      .select("id")
      .eq("id", matchId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: "match not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, matchId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown error" }, { status: 500 });
  }
}
