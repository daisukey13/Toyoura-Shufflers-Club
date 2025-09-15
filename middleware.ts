// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/** 既にセットされた Cookie を別レスポンスにも引き継ぐ */
function carryCookies(from: NextResponse, to: NextResponse) {
  for (const c of from.cookies.getAll()) to.cookies.set(c);
  return to;
}

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const { pathname } = url;

  // ここで一度だけレスポンスを作成（以降この res に Cookie を積む）
  const res = NextResponse.next({ request: { headers: new Headers(req.headers) } });

  // Supabase SSR（認証の有無だけ判定）
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    }
  );
  const { data: { user } } = await supabase.auth.getUser();

  // --- 正規化 ---
  // /admin → /admin/dashboard
  if (pathname === '/admin' || pathname === '/admin/') {
    return carryCookies(res, NextResponse.redirect(new URL('/admin/dashboard' + url.search, req.url)));
  }

  // /matches/register → /matches/register/singles
  if (pathname === '/matches/register' || pathname === '/matches/register/') {
    return carryCookies(res, NextResponse.redirect(new URL('/matches/register/singles' + url.search, req.url)));
  }

  // ★ 追加：/matches/register/singles → /matches/register/singles
  if (pathname === '/mypage' || pathname === '/mypage/') {
    const open = url.searchParams.get('open');
    if (open === 'register') {
      // 他のクエリは温存（open だけ除去）
      const next = new URL('/matches/register/singles', req.url);
      const sp = new URLSearchParams(url.searchParams);
      sp.delete('open');
      const rest = sp.toString();
      if (rest) next.search = '?' + rest;
      return carryCookies(res, NextResponse.redirect(next));
    }
  }

  // --- 認可（ログイン必須ページ） ---
  const requiresAuth =
    pathname.startsWith('/admin') ||
    pathname.startsWith('/matches/register/singles') ||
    pathname.startsWith('/matches/register/teams');

  if (requiresAuth && !user) {
    const dest = '/login?redirect=' + encodeURIComponent(url.pathname + url.search);
    return carryCookies(res, NextResponse.redirect(new URL(dest, req.url)));
  }

  return res;
}

export const config = {
  // /login は対象外
  matcher: [
    '/admin/:path*',
    '/matches/register',          // 旧URLの正規化
    '/matches/register/:path*',   // singles / teams の保護
    '/mypage',                    // ★ /matches/register/singles の正規化
  ],
};
