// lib/supabase/admin.ts
import 'server-only'; // クライアント側での誤インポートをビルド時に防止
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * ✅ 目的
 * - Vercel build 時に env が無いだけで "throw" してビルドが落ちるのを防ぐ
 * - 実行時（APIが呼ばれた時）にだけ env を検査して、必要ならエラーにする
 *
 * ✅ 使い方
 * - 既存の `import { supabaseAdmin } ...` がある場合は、できれば `getSupabaseAdmin()` に置換推奨
 * - 置換が難しい箇所のために `supabaseAdmin` (Proxy) も提供（実行時に初回生成）
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;

// ✅ ブラウザ実行は即止める（これはビルドを落とさず、実行時にだけ効く）
function assertServerOnly() {
  if (typeof window !== 'undefined') {
    throw new Error('[supabaseAdmin] This module must not be imported in the browser.');
  }
}

// ✅ 実行時チェック（build-time に throw しない）
function assertEnv() {
  if (!SUPABASE_URL) {
    throw new Error('[supabaseAdmin] Missing env: NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!SERVICE_ROLE_KEY) {
    throw new Error('[supabaseAdmin] Missing env: SUPABASE_SERVICE_ROLE_KEY');
  }
}

let _cachedAdmin: SupabaseClient | null = null;

/**
 * ✅ 推奨：必要な時だけ呼ぶ（ここで env を検査）
 */
export function getSupabaseAdmin(): SupabaseClient {
  assertServerOnly();
  assertEnv();

  if (_cachedAdmin) return _cachedAdmin;

  const client = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    // db: { schema: 'public' }, // 必要なら
  });

  // 参照を固定（プロパティ自体の freeze は薄いが、意図の明示として残す）
  Object.freeze(client);
  _cachedAdmin = client;
  return client;
}

/**
 * ✅ 互換：既存コードが `supabaseAdmin.from(...)` を使っていても動かせる Proxy
 * - import 時点では throw しない（= build を落とさない）
 * - 実際に `.from` 等にアクセスした瞬間に getSupabaseAdmin() で生成し、env 未設定ならその時 throw
 */
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseAdmin();
    // @ts-ignore dynamic access
return (client as any)[prop as any];
  },
}) as SupabaseClient;
