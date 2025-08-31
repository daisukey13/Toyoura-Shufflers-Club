// components/AuthBanner.tsx
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export const dynamic = 'force-dynamic';

export default async function AuthBanner() {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: '', ...options });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
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
