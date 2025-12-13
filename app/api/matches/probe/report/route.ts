import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/matches/_probe/report",
    timestamp: new Date().toISOString(),
  });
}
