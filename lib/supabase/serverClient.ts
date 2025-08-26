// lib/supabase/serverClient.ts
import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/**
 * 共通 ENV 取得（開発時のみ強い警告）
 */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if ((!URL || !ANON) && process.env.NODE_ENV !== 'production') {
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY'
  );
}

/**
 * CookieOptions を Next.js の cookies().set / res.cookies.set に
 * そのまま渡せる形にして返す（ほぼ同一だが型を明示）
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
 * Server Components / Server Actions 用の Supabase クライアント。
 * - cookies() を直接利用
 * - 一部の場面（RSC）では cookies().set が禁止のため try/catch で安全化
 */
export function createServerSupabaseClient() {
  const cookieStore = cookies();

  return createServerClient(URL!, ANON!, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options?: CookieOptions) {
        try {
          // Next.js 14 ではオブジェクト or (name, value, options) の両方に対応
          cookieStore.set({ name, value, ...toCookieOptions(options) });
        } catch {
          // RSC など set 禁止文脈では無視（Server Actions / Route Handlers で上書きされる）
        }
      },
      remove(name: string, options?: CookieOptions) {
        try {
          cookieStore.set({
            name,
            value: '',
            ...toCookieOptions({ ...options, maxAge: 0 }),
          });
        } catch {
          // 同上
        }
      },
    },
  });
}

/**
 * Route Handler 用の Supabase クライアント（推奨）。
 * - req/resp の Cookie を確実に同期できる
 * - 例: const supabase = createRouteHandlerSupabaseClient(req, res);
 */
export function createRouteHandlerSupabaseClient(
  req: NextRequest,
  res: NextResponse
) {
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
 * Middleware 用の Supabase クライアント。
 * - Middleware では NextResponse を自分で生成してから渡す必要があります。
 *   例:
 *     export async function middleware(req: NextRequest) {
 *       const res = NextResponse.next();
 *       const supabase = createMiddlewareSupabaseClient(req, res);
 *       const { data: { user } } = await supabase.auth.getUser();
 *       // ...（判定して必要に応じて res を返す）
 *       return res;
 *     }
 */
export function createMiddlewareSupabaseClient(
  req: NextRequest,
  res: NextResponse
) {
  return createRouteHandlerSupabaseClient(req, res);
}
