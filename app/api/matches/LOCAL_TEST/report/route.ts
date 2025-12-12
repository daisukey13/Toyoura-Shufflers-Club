// app/api/matches/LOCAL_TEST/report/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'LOCAL_TEST from production',
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    timestamp: new Date().toISOString(),
  });
}
