// lib/supabase/client.ts
'use client';

import { createBrowserClient } from '@supabase/ssr';
// import type { Database } from '@/types/supabase' // 型がある場合は有効化

type SB = ReturnType<typeof createBrowserClient /* <Database> */>;

declare global {
  // eslint-disable-next-line no-var
  var __supabase__: SB | undefined;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// ✅ env 不足は「落とさず」開発時に分かるように
if ((!url || !anon) && process.env.NODE_ENV !== 'production') {
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY'
  );
}

// ✅ ここが最重要：window がある時だけ global singleton を使う
function getSingleton(): SB {
  // SSR で誤って呼ばれた場合でも落ちにくくする（基本は client component でのみ使用）
  // @supabase/ssr の createBrowserClient はブラウザ想定だが、
  // 念のため window 未定義時は「毎回作る」ではなく「作成を避ける」ほうが安全。
  if (typeof window === 'undefined') {
    // どうしても必要なら server 用は別ファイルに分ける（ここでは最小修正として null 回避）
    // ただしこのファイルは 'use client' なので通常ここには来ない
    return createBrowserClient/*<Database>*/(url!, anon!, {
      auth: {
        storageKey: 'tsc-auth',
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { headers: { 'x-client-info': 'tsc-web' } },
    });
  }

  // ✅ 既にあれば絶対に作らない（HMR/複数 import の事故を止める）
  if (globalThis.__supabase__) return globalThis.__supabase__;

  // ✅ 初回だけ生成
  const client = createBrowserClient/*<Database>*/(url!, anon!, {
    auth: {
      storageKey: 'tsc-auth', // アプリ固有キーで衝突回避
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      headers: {
        'x-client-info': 'tsc-web',
      },
    },
  });

  globalThis.__supabase__ = client;
  return client;
}

// ✅ 生成は必ず 1 箇所・1 回だけ
const _client = getSingleton();

/** 推奨：各所で呼び出して同一インスタンスを得る */
export const createClient = () => _client;

/** 互換輸出：直接使いたい場合はこちらを import */
export { _client as supabase };
