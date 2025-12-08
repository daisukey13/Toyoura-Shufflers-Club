// app/auth/callback/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

type Body = {
  event: 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';
  session: any | null;
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  const { event, session } = (await req.json()) as Body;

  // ✅ Next.js 15+: cookies() は await が必要
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({
            name,
            value,
            ...options,
            path: options?.path ?? '/',
          });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({
            name,
            value: '',
            ...options,
            path: options?.path ?? '/',
            maxAge: 0,
          });
        },
      },
    }
  );

  try {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      if (session) {
        await supabase.auth.setSession(session);
      }
    } else if (event === 'SIGNED_OUT') {
      await supabase.auth.signOut();
    }

    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: String(e?.message || e) }, { status: 500 });
  }
}
