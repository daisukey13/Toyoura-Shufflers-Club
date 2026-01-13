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

  // ✅ 重要：/api と /trpc は middleware 対象外にする
  // ここを通すと Clerk の signed-out 判定や内部処理が絡んで /_not-found になることがあります。
  // API は各 route.ts 側で Supabase cookie を読めるので問題ありません。
  if (pathname.startsWith('/api') || pathname.startsWith('/trpc')) {
    return NextResponse.next();
  }

  // ここで1度だけレスポンスを作り、この res に Cookie を蓄積
  const res = NextResponse.next({
    request: { headers: new Headers(req.headers) },
  });

  // ─────────────────────────────────────────────
  // 1) Clerk でログイン判定（既存維持）
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
  // 2) Supabase セッション更新（既存維持）
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
              res.cookies.set({ name, value, ...(options ?? {}) });
            });
          },
        },
      });

      // refresh を走らせ、必要なら res に Set-Cookie を載せる
      const {
        data: { user },
      } = await supabase.auth.getUser();

      supabaseUser = user ?? null;
    } catch {
      supabaseUser = null;
    }
  }

  // ✅ Supabase の cookie があるのに getUser が失敗した場合でも、
  // ルーティング上は「ログイン済み扱い」にして余計な not-found/redirect を避ける（最小の保険）
  const hasSupabaseCookie = Boolean(req.cookies.get('tsc-auth')?.value);

  const authed = clerkAuthed || !!supabaseUser || hasSupabaseCookie;

  // ─────────────────────────────────────────────
  // ルーティング規約（既存の挙動維持 + 404潰し）
  // ─────────────────────────────────────────────

  // /admin → /admin/dashboard に正規化
  if (pathname === '/admin' || pathname === '/admin/') {
    return carryCookies(res, NextResponse.redirect(new URL('/admin/dashboard', req.url)));
  }

  // /admin/league/<...> を公開 URL /league/<...> にリダイレクト（既存維持）
  if (pathname === '/admin/league' || pathname === '/admin/league/') {
    return carryCookies(res, NextResponse.redirect(new URL('/league', req.url)));
  }
  if (pathname.startsWith('/admin/league/')) {
    const publicPath = pathname.replace(/^\/admin/, '');
    const url = new URL(publicPath + req.nextUrl.search, req.url);
    return carryCookies(res, NextResponse.redirect(url));
  }

  // ✅ 追加：/admin/matches/register/* を /matches/register/* に寄せて 404 を消す
  // （ログに出ていた /admin/matches/register/singles 404 対策）
  if (pathname === '/admin/matches/register' || pathname === '/admin/matches/register/') {
    return carryCookies(res, NextResponse.redirect(new URL('/matches/register/singles', req.url)));
  }
  if (pathname.startsWith('/admin/matches/register/')) {
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

// ✅ 重要：_next/static / _next/image / 拡張子付きファイルは除外
// ✅ さらに重要：api / trpc も matcher から除外（ここが今回の 핵）
export const config = {
  matcher: ['/((?!api|trpc|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)'],
};
