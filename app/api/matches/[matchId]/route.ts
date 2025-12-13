import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/matches/:matchId
export async function GET(
  _req: Request,
  { params }: { params: { matchId: string } }
) {
  const matchId = params?.matchId;

  if (!matchId) {
    return NextResponse.json(
      { ok: false, error: "missing matchId" },
      { status: 400 }
    );
  }

  // まずは「ルートが生きてる」ことを最優先で返す（DBは失敗してもOK）
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("matches")
      .select("*")
      .eq("id", matchId)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      route: "/api/matches/[matchId]",
      matchId,
      found: !!data,
      data: data ?? null,
      supabaseQueryOk: !error,
      supabaseQueryError: error ? { message: error.message, code: (error as any).code } : null,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: true,
      route: "/api/matches/[matchId]",
      matchId,
      found: false,
      data: null,
      supabaseQueryOk: false,
      supabaseQueryError: { message: String(e?.message ?? e) },
      timestamp: new Date().toISOString(),
    });
  }
}
