// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { clerkMiddleware } from "@clerk/nextjs/server";

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

  // ─────────────────────────────────────────────────────────────
  // 1) Clerk でログイン判定（最優先）
  // ─────────────────────────────────────────────────────────────
  let clerkUserId: string | null = null;
  try {
    // ★重要: 環境によって Promise なので await
    const a: any = await auth();
    clerkUserId = (a?.userId as string) ?? null;
  } catch {
    clerkUserId = null;
  }
  const clerkAuthed = !!clerkUserId;

  // ─────────────────────────────────────────────────────────────
  // 2) Supabase でログイン判定（フォールバック）
  //    ※ refresh_token_already_used を増やさないために「必要なときだけ」見る
  // ─────────────────────────────────────────────────────────────
  const needsAuthCheck =
    pathname.startsWith("/admin") || pathname.startsWith("/matches/register");

  let supabaseUser: any = null;

  if (!clerkAuthed && needsAuthCheck) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseAnon) {
      try {
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

        const {
          data: { user },
        } = await supabase.auth.getUser();

        supabaseUser = user ?? null;
      } catch {
        supabaseUser = null;
      }
    }
  }

  // 最終的なログイン判定（Clerk 優先 + Supabase フォールバック）
  const authed = clerkAuthed || !!supabaseUser;

  // ─────────────────────────────────────────────────────────────
  // ルーティング規約（既存の挙動維持）
  // ─────────────────────────────────────────────────────────────

  // /admin → /admin/dashboard に正規化
  if (pathname === "/admin" || pathname === "/admin/") {
    return carryCookies(
      res,
      NextResponse.redirect(new URL("/admin/dashboard", req.url))
    );
  }

  // ✅ /admin/league/<...> を公開 URL /league/<...> にリダイレクト（ログイン不要で閲覧させる）
  //    ※ "/admin/league-blocks" を誤爆させないために "/admin/league/" のみ対象
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
    if (!authed) {
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
    if (!authed) {
      const dest =
        "/login?redirect=" + encodeURIComponent("/matches/register/singles");
      return carryCookies(res, NextResponse.redirect(new URL(dest, req.url)));
    }
  }

  return res;
});

export const config = {
  matcher: [
    "/((?!.*\\..*|_next).*)",
    "/",
    "/(api|trpc)(.*)",
  ],
};
