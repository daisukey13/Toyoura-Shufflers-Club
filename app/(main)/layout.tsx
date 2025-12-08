// app/(main)/layout.tsx
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

// cookie を読むので静的化を避ける（安全側）
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function MainLayout({ children }: { children: ReactNode }) {
  /**
   * ✅ Next.js 15+
   * cookies() は Promise を返すため await が必要
   */
  const cookieStore = await cookies();

  /**
   * (main) layout でも Supabase SSR を作っている場合は、
   * RootLayout と同様に Cookie 読み取りをここで紐付けておく。
   *
   * 目的：
   * - 「この階層でも Supabase セッションを参照できる形」を維持
   * - getUser() / getSession() を将来ここで使う場合にも破綻しない
   *
   * 注意：
   * - layout は Server Component（RSC）なので、
   *   レンダリング中に cookie の set/remove は許可されない文脈がある
   * - そのため set/remove は no-op（既存方針維持）
   */
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        /**
         * Cookie 読み取りはOK（セッション復元に使われる）
         */
        get(name: string) {
          return cookieStore.get(name)?.value;
        },

        /**
         * RSC の render 中は cookie を変更できない文脈があるため no-op
         * - Supabase SSR は refresh 等の場面で set を呼ぶことがあるが、
         *   layout では「読み取り」目的に限定するのが安全
         */
        set(_name: string, _value: string, _options: CookieOptions) {
          /* no-op in RSC */
        },

        /**
         * 同上：remove も no-op
         */
        remove(_name: string, _options: CookieOptions) {
          /* no-op in RSC */
        },
      },
    }
  );

  /**
   * 現状この layout 内では supabase を直接利用しないが、
   * 「Supabase 連携の形」を維持する（将来の拡張や既存設計の意図を壊さない）。
   */
  void supabase;

  /**
   * ✅ 重要：子 layout（app/(main)/layout.tsx）では <html>/<body> を返さない
   * - <html>/<body> は app/layout.tsx（RootLayout）だけが返す
   * - ここで返してしまうと Next.js のレイアウト構造が崩れたり警告/不具合の原因になる
   */
  return <>{children}</>;
}
