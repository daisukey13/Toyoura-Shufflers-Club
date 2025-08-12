// middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

// リダイレクト時に、Supabase がセットした Cookie を引き継ぐヘルパ
function withCookies(from: NextResponse, to: NextResponse) {
  for (const c of from.cookies.getAll()) {
    to.cookies.set(c)
  }
  return to
}

export async function middleware(req: NextRequest) {
  // cookie 書き換え可能なレスポンスを最初に用意
  let res = NextResponse.next({
    request: { headers: new Headers(req.headers) },
  })

  // Supabase SSR クライアント（middleware 用：手動で cookies を橋渡し）
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          // set/remove のたびに res を再生成して header を引き継ぐ
          res = NextResponse.next({
            request: { headers: new Headers(req.headers) },
          })
          res.cookies.set(name, value, options)
        },
        remove(name: string, options: CookieOptions) {
          res = NextResponse.next({
            request: { headers: new Headers(req.headers) },
          })
          res.cookies.set(name, '', { ...options, maxAge: 0 })
        },
      },
    }
  )

  const url = new URL(req.url)
  const pathname = url.pathname

  // セッション取得（ここで Supabase が cookies を更新することがある）
  const { data: { user } } = await supabase.auth.getUser()

  // /admin を /admin/dashboard に正規化（ブックマーク等の古いリンク対策）
  if (pathname === '/admin' || pathname === '/admin/') {
    return withCookies(res, NextResponse.redirect(new URL('/admin/dashboard', req.url)))
  }

  // /admin 配下はログイン必須 + app_admins に存在するユーザーのみ
  if (pathname.startsWith('/admin')) {
    if (!user) {
      const dest = '/login?redirect=' + encodeURIComponent('/admin/dashboard')
      return withCookies(res, NextResponse.redirect(new URL(dest, req.url)))
    }
    const { data: adminRow } = await supabase
      .from('app_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!adminRow) {
      return withCookies(res, NextResponse.redirect(new URL('/', req.url)))
    }
  }

  // 試合登録はログイン必須
  if (pathname === '/matches/new') {
    if (!user) {
      const dest = '/login?redirect=' + encodeURIComponent('/matches/new')
      return withCookies(res, NextResponse.redirect(new URL(dest, req.url)))
    }
  }

  // 既にログイン済みで /login を開いた時はロールで着地変更
  if (pathname === '/login' && user) {
    const { data: adminRow } = await supabase
      .from('app_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const dest = adminRow ? '/admin/dashboard' : `/players/${user.id}`
    return withCookies(res, NextResponse.redirect(new URL(dest, req.url)))
  }

  // ここまでで cookie が更新されていれば res に入っているので、そのまま返す
  return res
}

export const config = {
  // 監視対象：/admin 配下、/login、/matches/new
  matcher: ['/admin/:path*', '/login', '/matches/new'],
}
