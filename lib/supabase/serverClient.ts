// lib/supabase/serverClient.ts
import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/**
 * 共通 ENV 取得（開発時のみ強い警告）
 * ※ production では白画面事故を避けるため throw しない（既存方針踏襲）
 */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if ((!URL || !ANON) && process.env.NODE_ENV !== 'production') {
  // eslint-disable-next-line no-console
  console.error('[supabase] Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

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
 * Server Components / Server Actions 用（読み取り中心）。
 * ✅ Next.js 15: cookies() は await 必須 → async
 * - ここでの set/remove は RSC 制約で失敗する場合があるため try/catch で安全化
 * - Route Handler で cookie を確実に書きたい場合は createRouteHandlerSupabaseClient を使う
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies(); // ✅ Next.js 15 対応

  return createServerClient(URL ?? '', ANON ?? '', {
    cookies: {
      // --- new style (推奨) ---
      getAll() {
        return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set({ name, value, ...toCookieOptions(options) });
          });
        } catch {
          // RSC / Server Components では set 禁止の文脈がある → 無視
        }
      },

      // --- legacy style (互換: supabase-ssr の版差対策) ---
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options?: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...toCookieOptions(options) });
        } catch {
          // ignore
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
          // ignore
        }
      },
    },
  });
}

/**
 * Route Handler 用（cookie を確実に同期できる）
 * - req/res を使って cookie を確実に読み書きできる
 * - こちらは cookies() を触らないので async 不要
 */
export function createRouteHandlerSupabaseClient(req: NextRequest, res: NextResponse) {
  return createServerClient(URL ?? '', ANON ?? '', {
    cookies: {
      // --- new style (推奨) ---
      getAll() {
        // NextRequestCookies は getAll() を持つ（型差異があるので any ガード）
        const all = (req.cookies as any).getAll?.() ?? [];
        return all.map((c: any) => ({ name: c.name, value: c.value }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          res.cookies.set({ name, value, ...toCookieOptions(options) });
        });
      },

      // --- legacy style (互換) ---
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options?: CookieOptions) {
        res.cookies.set({ name, value, ...toCookieOptions(options) });
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
 * Middleware 用（実体は Route Handler と同じでOK）
 */
export function createMiddlewareSupabaseClient(req: NextRequest, res: NextResponse) {
  return createRouteHandlerSupabaseClient(req, res);
}
