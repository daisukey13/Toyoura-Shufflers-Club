// lib/supabase/admin.ts
import "server-only"; // クライアント側での誤インポートをビルド時に防止
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 追加の安全策：環境変数が未設定なら即時失敗
if (!SUPABASE_URL) {
  throw new Error("[supabaseAdmin] Missing env: NEXT_PUBLIC_SUPABASE_URL");
}
if (!SERVICE_ROLE_KEY) {
  throw new Error("[supabaseAdmin] Missing env: SUPABASE_SERVICE_ROLE_KEY");
}

// 追加の安全策：誤ってクライアント側から import された場合は実行を止める
if (typeof window !== "undefined") {
  throw new Error(
    "[supabaseAdmin] This module must not be imported in the browser.",
  );
}

// サーバ専用クライアント（RLSバイパス: Service Role）
// ※ API Route / Server Action など「サーバ側」からのみ利用してください
export const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
  // db: { schema: 'public' }, // 必要ならスキーマを明示
});

// 変更防止
Object.freeze(supabaseAdmin);
