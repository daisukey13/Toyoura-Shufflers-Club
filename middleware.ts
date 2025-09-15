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
  const { pathname, search } = url;

  // 1) ここで一度だけレスポンスを作成（以降この res に Cookie を積む）
  const res = NextResponse.next({ request: { headers: new Headers(req.headers) } });

  // 2) Supabase SSR クライアント（ミドルウェア用：認証有無の判定だけ行う）
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 3) パスの正規化
  // /admin → /admin/dashboard
  if (pathname === '/admin' || pathname === '/admin/') {
    const dest = new URL('/admin/dashboard' + search, req.url);
    return carryCookies(res, NextResponse.redirect(dest));
  }

  // /matches/register → /matches/register/singles（クエリも維持）
  if (pathname === '/matches/register' || pathname === '/matches/register/') {
    const dest = new URL('/matches/register/singles' + search, req.url);
    return carryCookies(res, NextResponse.redirect(dest));
  }

  // 4) ログイン必須ページのガード
  const requiresAuth =
    pathname.startsWith('/admin') ||
    pathname.startsWith('/matches/register/singles') ||
    pathname.startsWith('/matches/register/teams');

  if (requiresAuth && !user) {
    const dest = '/login?redirect=' + encodeURIComponent(pathname + search);
    return carryCookies(res, NextResponse.redirect(new URL(dest, req.url)));
  }

  // 5) そのまま継続
  return res;
}

export const config = {
  // /login は対象外（意図しないリダイレクト防止）
  matcher: [
    '/admin/:path*',
    '/matches/register',          // 旧URLの正規化用
    '/matches/register/:path*',   // singles / teams の保護
  ],
};
