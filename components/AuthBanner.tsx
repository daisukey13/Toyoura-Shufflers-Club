// components/AuthBanner.tsx
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export const dynamic = 'force-dynamic';

export default async function AuthBanner() {
  // ✅ Next.js 15: cookies() は Promise
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // ✅ 新API: getAll / setAll のみ渡す（overload 解決のため）
      cookies: {
        getAll() {
          // Nextの cookie は {name,value,...} を返すので supabase 期待形式へ
          return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
        },
        setAll(cookiesToSet) {
          // Server Component では set が禁止/無効な場合があるので安全に no-op
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              (cookieStore as any).set({ name, value, ...(options ?? {}) });
            });
          } catch {}
        },
      } as any, // 型ズレ吸収（Supabase/Nextの版差で型が変わるため）
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const name =
    (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) ||
    user.email ||
    'サインイン済み';

  return (
    <div className="border-t border-white/10 bg-green-600/10">
      <div className="container mx-auto px-4 py-2 text-xs sm:text-sm text-green-200">
        現在 <span className="font-semibold">{name}</span> でログイン中
      </div>
    </div>
  );
}
