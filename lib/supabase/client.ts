// lib/supabase/client.ts
'use client';

import { createBrowserClient } from '@supabase/ssr';
// import type { Database } from '@/types/supabase' // 型がある場合は有効化

// HMR やチャンク跨ぎでもインスタンスを 1 つに固定
type SB = ReturnType<typeof createBrowserClient/*<Database>*/>;

declare global {
  // eslint-disable-next-line no-var
  var __supabase__: SB | undefined;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // ここで throw すると本番で白画面になるため、開発時のみ強く警告
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error(
      '[supabase] Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY'
    );
  }
}

const _client =
  globalThis.__supabase__ ??
  createBrowserClient/*<Database>*/(url!, anon!, {
    // ここで認証のふるまいを明示（デフォルトでも true だが明記しておく）
    auth: {
      storageKey: 'tsc-auth',          // アプリ固有キーで衝突回避
      persistSession: true,            // セッション永続化
      autoRefreshToken: true,          // トークン自動更新
      detectSessionInUrl: true,        // OAuth/リカバリ経由のURLハッシュを検出
    },
    global: {
      headers: {
        // クライアント識別（監視やログで便利）
        'x-client-info': 'tsc-web',
      },
    },
  });

if (typeof window !== 'undefined') {
  globalThis.__supabase__ = _client;
}

/** 推奨：各所で呼び出して同一インスタンスを得る */
export const createClient = () => _client;

/** 互換輸出：直接使いたい場合はこちらを import */
export { _client as supabase };
