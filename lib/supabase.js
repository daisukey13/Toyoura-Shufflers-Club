'use client';

// ここでは新規に createClient しない（= 重複生成を止める）
// 全て /lib/supabase/client.ts の単一インスタンスへ寄せる
export { createClient, supabase } from '@/lib/supabase/client';

// default export 互換（どこかが default import していても壊れない）
import { supabase as _supabase } from '@/lib/supabase/client';
export default _supabase;
