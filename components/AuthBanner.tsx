// components/AuthBanner.tsx
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export const dynamic = 'force-dynamic';

export default async function AuthBanner() {
  // ★ ここがポイント：cookies() を await して「Promise → 実体」にする
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          // cookieStore は ReadonlyRequestCookies なので .get が使える
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // 一部環境で書き込み不可でも致命ではないので握りつぶし
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // 同上
          }
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const name =
    (user.user_metadata &&
      (user.user_metadata.full_name || user.user_metadata.name)) ||
    user.email ||
    'サインイン済み';

  // ★ UI はそのまま維持
  return (
    <div className="border-t border-white/10 bg-green-600/10">
      <div className="container mx-auto px-4 py-2 text-xs sm:text-sm text-green-200">
        現在 <span className="font-semibold">{name}</span> でログイン中
      </div>
    </div>
  );
}
