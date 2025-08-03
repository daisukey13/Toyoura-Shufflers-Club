// lib/supabase/client.ts

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// シングルトンインスタンス
const supabaseClient = createSupabaseClient(supabaseUrl, supabaseAnonKey);

// 既存のコードとの互換性のため、関数もエクスポート
export const createClient = () => supabaseClient;

// 直接インスタンスをエクスポート（推奨）
export const supabase = supabaseClient;