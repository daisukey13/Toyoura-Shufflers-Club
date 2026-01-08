// app/auth/whoami/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/serverClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getBearerToken(req: NextRequest) {
  const h = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  // ① Bearer があればそれで判定（cookie同期が壊れていてもOK）
  const bearer = getBearerToken(req);
  if (bearer) {
    const { data, error } = await supabase.auth.getUser(bearer);
    if (!error && data.user) {
      return NextResponse.json({
        authenticated: true,
        via: 'bearer',
        userId: data.user.id,
      });
    }
  }

  // ② cookie で判定（従来通り）
  const { data, error } = await supabase.auth.getUser();
  if (!error && data.user) {
    return NextResponse.json({
      authenticated: true,
      via: 'cookie',
      userId: data.user.id,
    });
  }

  return NextResponse.json({
    authenticated: false,
    via: null,
    userId: null,
  });
}
