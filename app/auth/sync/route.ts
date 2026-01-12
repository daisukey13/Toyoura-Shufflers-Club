// app/auth/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export const runtime = 'nodejs';

function noStore(res: NextResponse) {
  res.headers.set('cache-control', 'no-store');
  return res;
}

function serverSupabase(req: NextRequest, res: NextResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const c of cookiesToSet) {
          res.cookies.set(c.name, c.value, c.options);
        }
      },
    },
  });
}

type Payload =
  | { action: 'set'; access_token: string; refresh_token: string }
  | { action: 'signout' };

export async function POST(req: NextRequest) {
  const res = noStore(NextResponse.json({ ok: false }, { status: 200 }));

  try {
    const supabase = serverSupabase(req, res);

    const body = (await req.json().catch(() => ({}))) as Partial<Payload>;

    // signout: サーバー側Cookieを確実に消す
    if (body?.action === 'signout') {
      const { error } = await supabase.auth.signOut();
      if (error) {
        return noStore(NextResponse.json({ ok: false, message: error.message }, { status: 400 }));
      }
      return noStore(NextResponse.json({ ok: true, action: 'signout' }));
    }

    // set: client session → server cookie へ反映
    const access_token = (body as any)?.access_token;
    const refresh_token = (body as any)?.refresh_token;

    if (!access_token || !refresh_token) {
      return noStore(
        NextResponse.json({ ok: false, message: 'missing tokens' }, { status: 400 })
      );
    }

    const { data, error } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });

    if (error) {
      return noStore(NextResponse.json({ ok: false, message: error.message }, { status: 400 }));
    }

    return noStore(
      NextResponse.json({
        ok: true,
        action: 'set',
        user_id: data?.user?.id ?? null,
      })
    );
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, message: e?.message ?? 'failed' }, { status: 500 }));
  }
}
