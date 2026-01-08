// lib/supabase/browserClient.ts
'use client';

import { createClient, SUPABASE_AUTH_STORAGE_KEY } from './client';

export { createClient, SUPABASE_AUTH_STORAGE_KEY };

/**
 * ✅ 重要：
 * - import 時点で createClient() を実行しない（= サーバで 500 を起こさない）
 * - 実際に supabase.* を触った瞬間にだけ生成する
 */
let _client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (_client) return _client;
  _client = createClient(); // ここで初めてブラウザ専用チェックが走る
  return _client;
}

// 既存コード互換：named export supabase / default export 両対応
export const supabase: ReturnType<typeof createClient> = new Proxy({} as any, {
  get(_target, prop) {
    const c = getClient();
    const v = (c as any)[prop];
    return typeof v === 'function' ? v.bind(c) : v;
  },
}) as any;

export default supabase;
