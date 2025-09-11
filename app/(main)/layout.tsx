// app/(main)/layout.tsx
import { cookies as nextCookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  // ── Supabase SSR: レイアウト内では Cookie を書き換えない（dev のクラッシュ回避）
  const cookieStore = nextCookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        // レイアウト（RSC）では set/remove を no-op にする
        set(_name: string, _value: string, _options: CookieOptions) {
          /* no-op in RSC */
        },
        remove(_name: string, _options: CookieOptions) {
          /* no-op in RSC */
        },
      },
    }
  );
  void supabase; // 未使用警告の抑止

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-64px)]">{children}</main>
      <Footer />
    </>
  );
}
