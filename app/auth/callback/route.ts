// app/auth/callback/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerSupabaseClient } from '@/lib/supabase/serverClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const event = String(body?.event ?? '');
  const session = body?.session ?? null;

  // まず「この res」に cookie を積ませて返す
  const res = NextResponse.json({ ok: true });
  const supabase = createRouteHandlerSupabaseClient(req, res);

  // SIGNED_OUT or session無し → cookie クリア
  if (event === 'SIGNED_OUT' || !session?.access_token || !session?.refresh_token) {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    // action を追記（bodyは最初の json のままなので、別レスポンスにしない）
    // そのまま res を返す（cookieが反映される）
    return res;
  }

  // セッションを cookie に反映
  const { error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });

  if (error) {
    // エラー時は cookie を返す必要がないので、新しいレスポンスでOK
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return res;
}
