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
 * - ここでの set は RSC 制約で失敗する場合があるため try/catch で安全化
 * - Route Handler で cookie を確実に書きたい場合は createRouteHandlerSupabaseClient を使う
 *
 * ✅ IMPORTANT:
 * - @supabase/ssr の型オーバーロード回避のため、cookies は「new style(getAll/setAll)」のみ渡す
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
    },
  });
}

/**
 * Route Handler 用（cookie を確実に同期できる）
 * - req/res を使って cookie を確実に読み書きできる
 * - こちらは cookies() を触らないので async 不要
 *
 * ✅ cookies は「new style(getAll/setAll)」のみ渡す（オーバーロード一致させる）
 */
export function createRouteHandlerSupabaseClient(req: NextRequest, res: NextResponse) {
  return createServerClient(URL ?? '', ANON ?? '', {
    cookies: {
      getAll() {
        // NextRequestCookies は getAll() を持つが、型差異対策で any ガード
        const all = (req.cookies as any).getAll?.() ?? [];
        return all.map((c: any) => ({ name: c.name, value: c.value }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          res.cookies.set({ name, value, ...toCookieOptions(options) });
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
