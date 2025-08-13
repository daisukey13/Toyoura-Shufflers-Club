'use client';

import { createBrowserClient } from '@supabase/ssr';

// 型
type SB = ReturnType<typeof createBrowserClient>;

// グローバル退避でHMR・チャンク跨ぎの重複生成防止
declare global {
  // eslint-disable-next-line no-var
  var __supabase_browser__: SB | undefined;
}

const supabase =
  globalThis.__supabase_browser__ ??
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        storageKey: 'tsc-auth', // アプリ固有キー
      },
    }
  );

if (typeof window !== 'undefined') {
  globalThis.__supabase_browser__ = supabase;
}

export { supabase };
