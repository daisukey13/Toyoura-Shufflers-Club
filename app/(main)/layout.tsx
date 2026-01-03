// app/(main)/layout.tsx
import type { ReactNode } from "react";
import { cookies as nextCookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export default async function MainLayout({ children }: { children: ReactNode }) {
  // Next.js 15+: cookies() は await が必要
  const cookieStore = await nextCookies();

  // ── Supabase SSR: レイアウト（RSC）では Cookie を書き換えない（dev のクラッシュ回避）
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        // RSC では set/remove を no-op にする（Render中のcookie変更禁止対策）
        set(_name: string, _value: string, _options: CookieOptions) {
          /* no-op in RSC */
        },
        remove(_name: string, _options: CookieOptions) {
          /* no-op in RSC */
        },
      },
    }
  );

  void supabase; // 未使用警告の抑止（※このlayout内でsupabaseを使わなくてもOK）

  // Header / Footer は app/layout.tsx 側で描画しているため、ここでは children のみ
  return <div className="min-h-[calc(100vh-64px)]">{children}</div>;
}
