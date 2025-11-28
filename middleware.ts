// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/** 既にセットされた Cookie を別レスポンスにも引き継ぐ */
function carryCookies(from: NextResponse, to: NextResponse) {
  for (const c of from.cookies.getAll()) to.cookies.set(c);
  return to;
}

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // ここで1度だけレスポンスを作り、この res に Cookie を蓄積
  const res = NextResponse.next({
    request: { headers: new Headers(req.headers) },
  });

  // env が無ければ認証判定できないので、ここでは何もしない（開発中の事故防止）
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let user: any = null;

  if (supabaseUrl && supabaseAnon) {
    try {
      // Supabase SSR クライアント（Middleware 用）— 認証の有無だけ判定する
      const supabase = createServerClient(supabaseUrl, supabaseAnon, {
        cookies: {
          get(name: string) {
            return req.cookies.get(name)?.value;
          },
          set(name: string, value: string, options: CookieOptions) {
            res.cookies.set(name, value, options);
          },
          remove(name: string, options: CookieOptions) {
            res.cookies.set(name, "", { ...options, maxAge: 0 });
          },
        },
      });

      // 現在のユーザーを Cookie ベースで確認（DB は触らない）
      const {
        data: { user: u },
      } = await supabase.auth.getUser();
      user = u ?? null;
    } catch {
      user = null;
    }
  }

  // /admin → /admin/dashboard に正規化
  if (pathname === "/admin" || pathname === "/admin/") {
    return carryCookies(
      res,
      NextResponse.redirect(new URL("/admin/dashboard", req.url))
    );
  }

  // ✅ 旧：/admin/league/<...> を公開 URL /league/<...> にリダイレクト（ログイン不要で閲覧させる）
  // ★重要："/admin/league-blocks" を誤爆させないために、"/admin/league/" のみ対象にする
  if (pathname === "/admin/league" || pathname === "/admin/league/") {
    return carryCookies(res, NextResponse.redirect(new URL("/league", req.url)));
  }
  if (pathname.startsWith("/admin/league/")) {
    const publicPath = pathname.replace(/^\/admin/, ""); // /league/...
    const url = new URL(publicPath + req.nextUrl.search, req.url);
    return carryCookies(res, NextResponse.redirect(url));
  }

  // /admin/* はログイン必須（管理者判定はページ側で実施）
  if (pathname.startsWith("/admin")) {
    if (!user) {
      const dest =
        "/login?redirect=" +
        encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search);
      return carryCookies(res, NextResponse.redirect(new URL(dest, req.url)));
    }
  }

  // 旧：/matches/register は新：/matches/register/singles へ統一
  if (pathname === "/matches/register") {
    return carryCookies(
      res,
      NextResponse.redirect(new URL("/matches/register/singles", req.url))
    );
  }

  // ✅ 旧：/mypage?open=register は必ず新ページへリダイレクト
  if (pathname === "/mypage" && searchParams.get("open") === "register") {
    return carryCookies(
      res,
      NextResponse.redirect(new URL("/matches/register/singles", req.url))
    );
  }

  // ✅ 試合登録ページはログイン必須（新URLも含めてチェック）
  if (pathname.startsWith("/matches/register")) {
    if (!user) {
      const dest =
        "/login?redirect=" + encodeURIComponent("/matches/register/singles");
      return carryCookies(res, NextResponse.redirect(new URL(dest, req.url)));
    }
  }

  return res;
}

export const config = {
  // `/login` は対象外（意図しないリダイレクトを防止）
  matcher: ["/admin/:path*", "/matches/register", "/matches/register/:path*", "/mypage"],
};
