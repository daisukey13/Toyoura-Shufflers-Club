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
  const { pathname, search } = req.nextUrl;

  // ここで1度だけレスポンスを作り、この res に Cookie を蓄積
  const res = NextResponse.next({ request: { headers: new Headers(req.headers) } });

  // Supabase SSR クライアント（Middleware 用）— 認証の有無だけ判定する
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

  // 現在のユーザーを Cookie ベースで確認（DB は触らない）
  const { data: { user } } = await supabase.auth.getUser();

  // /admin → /admin/dashboard に正規化
  if (pathname === '/admin' || pathname === '/admin/') {
    return carryCookies(res, NextResponse.redirect(new URL('/admin/dashboard', req.url)));
  }

  // /admin/* はログイン必須（管理者判定はページ側で実施）
  if (pathname.startsWith('/admin')) {
    if (!user) {
      const dest = '/login?redirect=' + encodeURIComponent(pathname + search);
      return carryCookies(res, NextResponse.redirect(new URL(dest, req.url)));
    }
  }

  // ✅ 試合結果登録ページはログイン必須
  if (pathname === '/matches/register') {
    if (!user) {
      const dest = '/login?redirect=' + encodeURIComponent('/matches/register');
      return carryCookies(res, NextResponse.redirect(new URL(dest, req.url)));
    }
  }

  return res;
}

export const config = {
  // `/login` は対象外（意図しないリダイレクトを防止）
  matcher: ['/admin/:path*', '/matches/register'],
};
