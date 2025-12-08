// lib/supabase/serverClient.ts
import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
const ANON = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

if ((!URL || !ANON) && process.env.NODE_ENV !== 'production') {
  // eslint-disable-next-line no-console
  console.error('[supabase] Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

/**
 * Next / Supabase cookie options の整形
 */
function toCookieOptions(options: CookieOptions = {}): CookieOptions {
  return {
    domain: options.domain,
    path: options.path,
    sameSite: options.sameSite,
    httpOnly: options.httpOnly,
    secure: options.secure,
    maxAge: options.maxAge,
    expires: options.expires,
  };
}

/**
 * Server Components / Server Actions 用（Next.js 15 互換）
 * - ★重要: token無しで Authorization に ANON/sb_* を入れない
 * - createServerClient(URL, ANON, ...) に渡すだけで apikey は担保される
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(URL!, ANON!, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options?: CookieOptions) {
        try {
          cookieStore.set({
            name,
            value,
            ...toCookieOptions(options),
            path: options?.path ?? '/',
          } as any);
        } catch {
          // RSC など set 禁止文脈では無視
        }
      },
      remove(name: string, options?: CookieOptions) {
        try {
          cookieStore.set({
            name,
            value: '',
            ...toCookieOptions({ ...options, maxAge: 0 }),
            path: options?.path ?? '/',
            maxAge: 0,
          } as any);
        } catch {
          // 同上
        }
      },
    },
  });
}

/**
 * Route Handler 用（req/res 同期）
 * - ★重要: token無しで Authorization に ANON/sb_* を入れない
 */
export function createRouteHandlerSupabaseClient(req: NextRequest, res: NextResponse) {
  return createServerClient(URL!, ANON!, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options?: CookieOptions) {
        res.cookies.set({
          name,
          value,
          ...toCookieOptions(options),
        });
      },
      remove(name: string, options?: CookieOptions) {
        res.cookies.set({
          name,
          value: '',
          ...toCookieOptions({ ...options, maxAge: 0 }),
        });
      },
    },
  });
}

/**
 * Middleware 用（現状維持）
 */
export function createMiddlewareSupabaseClient(req: NextRequest, res: NextResponse) {
  return createRouteHandlerSupabaseClient(req, res);
}
