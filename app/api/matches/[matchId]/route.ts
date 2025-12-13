// app/api/matches/[matchId]/route.ts
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) return null;

  return createSupabaseClient(url, anon, {
    auth: { persistSession: false },
  });
}

// GET /api/matches/:matchId
export async function GET(
  _req: Request,
  { params }: { params: { matchId: string } }
) {
  const matchId = params?.matchId;
  if (!matchId) {
    return NextResponse.json({ ok: false, error: "missing matchId" }, { status: 400 });
  }

  const sb = supabase();
  if (!sb) {
    return NextResponse.json(
      {
        ok: true,
        route: "/api/matches/[matchId]",
        matchId,
        supabaseConfigured: false,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  }

  try {
    const { data, error } = await sb
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
