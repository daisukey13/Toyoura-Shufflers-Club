// 例: lib/hooks/useFetchNoticeDetail.ts
'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';

type Notice = {
  id: string;
  title: string | null;
  content: string | null;
  created_at: string | null;
  // 必要に応じてフィールドを追加
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function useFetchNoticeDetail(id: string) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // クライアントは一度だけ生成して使い回す
  const supabase = useMemo(
    () => createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY),
    []
  );

  // アンマウント後の setState を防止
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchNotice = useCallback(async () => {
    if (!id) {
      if (mountedRef.current) {
        setNotice(null);
        setLoading(false);
      }
      return;
    }

    try {
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }

      const { data, error } = await supabase
        .from('notices') // ← テーブル名は実際のものに合わせてください
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      if (mountedRef.current) {
        setNotice(data as Notice);
      }
    } catch (e: any) {
      if (mountedRef.current) {
        setError(e?.message ?? 'Failed to fetch notice');
        setNotice(null);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [id, supabase]);

  useEffect(() => {
    fetchNotice();
  }, [fetchNotice]);

  return { notice, loading, error, refetch: fetchNotice };
}
