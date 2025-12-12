// lib/supabase/browserClient.ts
'use client';

// 互換用：ここでは new client を作らない（Multiple GoTrueClient 対策）
export { createClient, supabase } from '@/lib/supabase/client';
