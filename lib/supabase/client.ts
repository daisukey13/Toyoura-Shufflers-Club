// lib/supabase/client.ts
"use client";

import { createBrowserClient } from "@supabase/ssr";
// import type { Database } from '@/types/supabase'; // 型がある場合は有効化

// ──────────────────────────────────────────────────────────────
// HMR やチャンク跨ぎでもインスタンスを 1 つに固定（StrictMode対策）
// ──────────────────────────────────────────────────────────────
type SB = ReturnType<typeof createBrowserClient /* <Database> */>;

declare global {
  // eslint-disable-next-line no-var
  var __supabase__: SB | undefined;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // 本番で throw は避ける（白画面防止）。開発時のみ強い警告。
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.error(
      "[supabase] Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
}

const _client =
  globalThis.__supabase__ ??
  createBrowserClient(/* <Database> */ url!, anon!, {
    auth: {
      storageKey: "tsc-auth", // アプリ固有キーで衝突回避
      persistSession: true, // セッションを永続化
      autoRefreshToken: true, // アクセストークンの自動更新
      // OAuth コード処理は /auth/callback で行うため URL 検出は無効化
      // （二重処理により refresh_token_already_used を避ける）
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        "x-client-info": "tsc-web",
      },
    },
  });

if (typeof window !== "undefined") {
  globalThis.__supabase__ = _client;
}

/** どこからでも同一インスタンスを取得 */
export const createClient = () => _client;

/** 直接使いたい場合のエイリアス */
export { _client as supabase };
