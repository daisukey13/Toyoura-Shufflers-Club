import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ matchId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { matchId } = await params;
  return NextResponse.json({ ok: true, route: "/api/matches/[matchId]", matchId });
}
