// app/auth/callback/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const { event, session } = await req.json().catch(() => ({ event: 'UNKNOWN', session: null }));

  // このレスポンスに Cookie を積む
  const res = NextResponse.json({ ok: true });

  const supabase = createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        res.cookies.set(name, value, options);
      },
      remove(name: string, options: CookieOptions) {
        res.cookies.set(name, '', { ...options, maxAge: 0 });
      },
    },
  });

  try {
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
      // クッキーへセッションを反映
      await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
    } else if (event === 'SIGNED_OUT') {
      await supabase.auth.signOut();
    }
  } catch (e) {
    // 失敗しても 200 を返す（クライアント側でリトライ可）
  }

  return res;
}
