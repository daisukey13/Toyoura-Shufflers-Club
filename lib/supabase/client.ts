// lib/supabase/client.ts
'use client';

import { createBrowserClient } from '@supabase/ssr';

type SB = ReturnType<typeof createBrowserClient>;

// HMRやチャンク跨ぎでも1つだけにする
declare global {
  // eslint-disable-next-line no-var
  var __supabase__: SB | undefined;
}

const supabase =
  globalThis.__supabase__ ??
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // アプリ固有キーで衝突回避
        storageKey: 'tsc-auth',
        // 必要なら persistSession: true など設定
      },
    }
  );

if (typeof window !== 'undefined') {
  globalThis.__supabase__ = supabase;
}

// 既存互換 & 推奨の両方をエクスポート
export const createClient = () => supabase; // 既存互換
export { supabase };                         // 推奨
