// middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { clerkMiddleware } from '@clerk/nextjs/server';

/** 既にセットされた Cookie を別レスポンスにも引き継ぐ */
function carryCookies(from: NextResponse, to: NextResponse) {
  for (const c of from.cookies.getAll()) to.cookies.set(c);
  return to;
}

export default clerkMiddleware(async (auth, req: NextRequest) => {
  const { pathname, searchParams } = req.nextUrl;

  // ここで1度だけレスポンスを作り、この res に Cookie を蓄積
  const res = NextResponse.next({
    request: { headers: new Headers(req.headers) },
  });

  // ─────────────────────────────────────────────
  // 1) Clerk でログイン判定（最優先）
  // ─────────────────────────────────────────────
  let clerkUserId: string | null = null;
  try {
    const a: any = await auth();
    clerkUserId = (a?.userId as string) ?? null;
  } catch {
    clerkUserId = null;
  }
  const clerkAuthed = !!clerkUserId;

  // ─────────────────────────────────────────────
  // 2) Supabase セッション更新（重要）
  //    ✅ トップページなど「保護ルート以外」でも refresh が必要
  //    ✅ getAll / setAll で cookie を更新できるのは middleware のみ
  // ─────────────────────────────────────────────
  let supabaseUser: any = null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseAnon) {
    try {
      const supabase = createServerClient(supabaseUrl, supabaseAnon, {
        cookies: {
          getAll() {
            return req.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              // options は Supabase 側の CookieOptions 互換
              res.cookies.set({ name, value, ...(options ?? {}) });
            });
          },
        },
      });

      // ✅ これが refresh を走らせ、必要なら res に Set-Cookie を載せる
      const {
        data: { user },
      } = await supabase.auth.getUser();

      supabaseUser = user ?? null;
    } catch {
      supabaseUser = null;
    }
  }

  const authed = clerkAuthed || !!supabaseUser;

  // ─────────────────────────────────────────────
  // ルーティング規約（既存の挙動維持）
  // ─────────────────────────────────────────────

  // /admin → /admin/dashboard に正規化
  if (pathname === '/admin' || pathname === '/admin/') {
    return carryCookies(res, NextResponse.redirect(new URL('/admin/dashboard', req.url)));
  }

  // /admin/league/<...> を公開 URL /league/<...> にリダイレクト
  if (pathname === '/admin/league' || pathname === '/admin/league/') {
    return carryCookies(res, NextResponse.redirect(new URL('/league', req.url)));
  }
  if (pathname.startsWith('/admin/league/')) {
    const publicPath = pathname.replace(/^\/admin/, '');
    const url = new URL(publicPath + req.nextUrl.search, req.url);
    return carryCookies(res, NextResponse.redirect(url));
  }

  // /admin/* はログイン必須（管理者判定はページ側）
  if (pathname.startsWith('/admin')) {
    if (!authed) {
      const dest = '/login?redirect=' + encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search);
      return carryCookies(res, NextResponse.redirect(new URL(dest, req.url)));
    }
  }

  // 旧：/matches/register は新：/matches/register/singles へ統一
  if (pathname === '/matches/register') {
    return carryCookies(res, NextResponse.redirect(new URL('/matches/register/singles', req.url)));
  }

  // 旧：/mypage?open=register は必ず新ページへ
  if (pathname === '/mypage' && searchParams.get('open') === 'register') {
    return carryCookies(res, NextResponse.redirect(new URL('/matches/register/singles', req.url)));
  }

  // 試合登録ページはログイン必須
  if (pathname.startsWith('/matches/register')) {
    if (!authed) {
      const dest = '/login?redirect=' + encodeURIComponent('/matches/register/singles');
      return carryCookies(res, NextResponse.redirect(new URL(dest, req.url)));
    }
  }

  return res;
});

// ✅ 重要：_next/static / _next/image / 拡張子付きファイルは絶対に除外（ここが崩れると今の症状になります）
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)'],
};
