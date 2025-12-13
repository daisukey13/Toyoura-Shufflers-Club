import { NextResponse } from "next/server";

export const runtime = "nodejs"; // 念のため（Supabase触らなくてもOK）

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/matches/_probe",
    timestamp: new Date().toISOString(),
  });
}
