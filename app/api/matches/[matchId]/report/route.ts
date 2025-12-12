// app/api/matches/[matchId]/report/route.ts

import { NextResponse } from 'next/server';

type RouteParams = {
  params: {
    matchId: string;
  };
};

// 動作確認用 GET: ブラウザで叩く用
export async function GET(
  _req: Request,
  { params }: RouteParams
) {
  return NextResponse.json({
    ok: true,
    route: '/api/matches/[matchId]/report',
    matchId: params.matchId,
    note: 'GET handler is alive on production.',
  });
}

// とりあえず POST も仮で 200 を返す
export async function POST(
  req: Request,
  { params }: RouteParams
) {
  const body = await req.json().catch(() => null);

  return NextResponse.json({
    ok: true,
    route: '/api/matches/[matchId]/report',
    matchId: params.matchId,
    receivedBody: body,
    note: 'Temporary POST handler for wiring test.',
  });
}
