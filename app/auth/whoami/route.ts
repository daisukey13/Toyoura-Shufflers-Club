// app/auth/whoami/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export const dynamic = 'force-dynamic'; // 常に最新の判定
export const revalidate = 0;

export async function GET() {
  try {
    const cookieStore = cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options: CookieOptions) {
            // site-wide で確実に適用
            cookieStore.set({
              name,
              value,
              ...options,
              path: options?.path ?? '/',
            });
          },
          remove(name: string, options: CookieOptions) {
            // 削除は maxAge=0 / path=/ を明示
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

    const {
      data: { user },
    } = await supabase.auth.getUser();

    return NextResponse.json(
      { authenticated: !!user, userId: user?.id ?? null },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { authenticated: false, userId: null, error: String(e?.message || e) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
