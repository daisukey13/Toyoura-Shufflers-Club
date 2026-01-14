// app/api/matches/report/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// 既存の本体（dynamic 側）を呼び出す
import { POST as ReportPOST } from "../[matchId]/report/route";
// もし dynamic 側に GET もあるなら使う（無ければこの import と GET 関数は消してOK）
import { GET as ReportGET } from "../[matchId]/report/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ matchId: string }> };

function getMatchId(req: Request) {
  const url = new URL(req.url);
  return String(url.searchParams.get("matchId") ?? "").trim();
}

export async function POST(req: NextRequest) {
  const matchId = getMatchId(req);
  if (!matchId) {
    return NextResponse.json({ ok: false, message: "matchId が不正です。" }, { status: 400 });
  }
  return ReportPOST(req as any, { params: Promise.resolve({ matchId }) } as Ctx as any);
}

export async function GET(req: NextRequest) {
  const matchId = getMatchId(req);
  if (!matchId) {
    return NextResponse.json({ ok: false, message: "matchId が不正です。" }, { status: 400 });
  }
  // dynamic 側に GET が無い場合は、この関数ごと削除してください
  return ReportGET(req as any, { params: Promise.resolve({ matchId }) } as Ctx as any);
}
