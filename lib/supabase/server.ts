// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL) throw new Error('[supabaseServer] Missing env: NEXT_PUBLIC_SUPABASE_URL');
if (!ANON_KEY) throw new Error('[supabaseServer] Missing env: NEXT_PUBLIC_SUPABASE_ANON_KEY');

export function createServerSupabase() {
  const store = cookies();
  return createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      get(name: string) {
        return store.get(name)?.value;
      },
      set(name: string, value: string, options: any) {
        store.set({ name, value, ...options });
      },
      remove(name: string, options: any) {
        store.set({ name, value: '', ...options });
      },
    },
  });
}

// 既存コード互換の別名（任意）
export const getServerSupabase = createServerSupabase;
