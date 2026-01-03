// app/auth/callback/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export const runtime = 'nodejs';

type Payload = {
  event?: string;
  session?: {
    access_token?: string;
    refresh_token?: string;
  } | null;
};

function createSupabaseFromCookies(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: '', ...options, maxAge: 0 });
        },
      },
    }
  );
}

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const supabase = createSupabaseFromCookies(cookieStore);

  const body = (await req.json().catch(() => ({}))) as Payload;
  const s = body.session ?? null;

  try {
    if (s?.access_token && s?.refresh_token) {
      await supabase.auth.setSession({
        access_token: s.access_token,
        refresh_token: s.refresh_token,
      });
    } else {
      await supabase.auth.signOut();
    }
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true });
}
