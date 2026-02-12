// app/auth/whoami/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getSupabaseServerClient(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) return null;

  // ✅ Route Handler でも「ブラウザから来た Cookie」を Supabase に渡して user を復元できる
  const cookie = req.headers.get('cookie') || '';

  return createClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        // Supabase がセッション復元に cookie を必要とする
        cookie,
      },
    },
  });
}

/**
 * whoami:
 * - Clerk セッションがあれば最優先で authenticated:true
 * - Clerk が無ければ、Supabase cookie(tsc-auth) から「実ユーザーが取れた時だけ」 authenticated:true
 * - 取れない cookie は壊れているので、サーバ側で tsc-auth を削除して authenticated:false にする（無限ループ燃料を断つ）
 * - 返却の shape（authenticated/via/userId）は維持
 */
export async function GET(req: Request) {
  try {
    // 1) Clerk 最優先
    const a = await auth();
    const clerkUserId = (a?.userId as string | null) ?? null;

    if (clerkUserId) {
      return NextResponse.json({
        authenticated: true,
        via: 'clerk',
        userId: clerkUserId,
      });
    }

    // 2) Supabase cookie があるか（互換用）
    const cookie = req.headers.get('cookie') || '';
    const hasSupabaseCookie = /(?:^|;\s*)tsc-auth=/.test(cookie);

    if (!hasSupabaseCookie) {
      return NextResponse.json({
        authenticated: false,
        via: null,
        userId: null,
      });
    }

    // 3) cookie から Supabase user を解決できるか確認
    const sb = getSupabaseServerClient(req);
    if (!sb) {
      // env不足など。cookieだけでは authenticated にしない（ループ防止）
      const res = NextResponse.json({
        authenticated: false,
        via: null,
        userId: null,
      });
      // 念のためcookie燃料を抜く
      res.cookies.set('tsc-auth', '', { path: '/', maxAge: 0 });
      return res;
    }

    const { data, error } = await sb.auth.getUser();

    const userId = data?.user?.id ?? null;

    if (error || !userId) {
      // ✅ cookieが壊れてる/期限切れ/不整合 → ループ原因なので削除
      const res = NextResponse.json({
        authenticated: false,
        via: null,
        userId: null,
      });
      res.cookies.set('tsc-auth', '', { path: '/', maxAge: 0 });
      return res;
    }

    // ✅ Supabase user が取れた時だけ authenticated:true
    return NextResponse.json({
      authenticated: true,
      via: 'supabase',
      userId,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        authenticated: false,
        via: null,
        userId: null,
        message: e?.message ?? 'whoami failed',
      },
      { status: 200 },
    );
  }
}
