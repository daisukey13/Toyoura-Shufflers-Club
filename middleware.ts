// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/** 既にセットされた Cookie を別レスポンスにも引き継ぐ */
function carryCookies(from: NextResponse, to: NextResponse) {
  for (const c of from.cookies.getAll()) to.cookies.set(c);
  return to;
}

/** Supabase SSR クライアント（Middleware用） */
function createSbForMiddleware(req: NextRequest, res: NextResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // 環境変数未設定時の防御（開発中に .env が欠けても 500 にしない）
  if (!url || !anon) {
    return null as const;
  }

  return createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        // SameSite/Lax などは Supabase 側で良きに設定される
        res.cookies.set(name, value, options);
      },
      remove(name: string, options: CookieOptions) {
        res.cookies.set(name, '', { ...options, maxAge: 0 });
      },
    },
  });
}

export async function middleware(req: NextRequest) {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const searchParams = url.searchParams;

  // 1度だけレスポンスを作り、この res に Cookie を蓄積
  const res = NextResponse.next({ request: { headers: new Headers(req.headers) } });

  // --- 認証が必要な可能性があるパスのみ、軽量にユーザー確認 ---
  // matcher で絞っているが、念のためここでも条件分岐
  const needsAuth =
    pathname.startsWith('/admin') ||
    pathname === '/matches/register' ||
    pathname.startsWith('/matches/register') ||
    (pathname === '/mypage' && searchParams.get('open') === 'register');

  let isLoggedIn = false;

  if (needsAuth) {
    try {
      const supabase = createSbForMiddleware(req, res);
      if (supabase) {
        const { data: { user } } = await supabase.auth.getUser();
        isLoggedIn = !!user;
      } else {
        // 環境未設定なら未ログイン扱い（ミドルウェアで 500 にしない）
        isLoggedIn = false;
      }
    } catch {
      // Supabase 呼び出しに失敗してもミドルウェアで落とさない
      isLoggedIn = false;
    }
  }

  // ========== 正規化・保護ルール ==========
  // /admin → /admin/dashboard に正規化
  if (pathname === '/admin' || pathname === '/admin/') {
    return carryCookies(res, NextResponse.redirect(new URL('/admin/dashboard', req.url)));
  }

  // /admin/* はログイン必須（管理者判定はページ側で実施）
  if (pathname.startsWith('/admin')) {
    if (!isLoggedIn) {
      const dest = '/login?redirect=' + encodeURIComponent(url.pathname + url.search);
      return carryCookies(res, NextResponse.redirect(new URL(dest, req.url)));
    }
  }

  // 旧：/matches/register → 新：/matches/register/singles
  if (pathname === '/matches/register') {
    return carryCookies(res, NextResponse.redirect(new URL('/matches/register/singles', req.url)));
  }

  // ✅ 旧：/mypage?open=register は必ず新ページへ
  if (pathname === '/mypage' && searchParams.get('open') === 'register') {
    return carryCookies(res, NextResponse.redirect(new URL('/matches/register/singles', req.url)));
  }

  // ✅ 試合登録（新URL群）はログイン必須
  if (pathname.startsWith('/matches/register')) {
    if (!isLoggedIn) {
      const dest = '/login?redirect=' + encodeURIComponent('/matches/register/singles');
      return carryCookies(res, NextResponse.redirect(new URL(dest, req.url)));
    }
  }

  // それ以外は素通し
  return res;
}

export const config = {
  // `/login` や `/api/*` は対象外（意図しないリダイレクトや HTML 混入を防止）
  matcher: [
    '/admin/:path*',
    '/matches/register',
    '/matches/register/:path*',
    '/mypage',
  ],
};
