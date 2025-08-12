'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserClient } from '@supabase/ssr';

type Notice = {
  id: string;
  title: string | null;
  content: string | null;
  created_at: string | null;
  // 必要に応じてフィールドを追加
};

export function useFetchNoticeDetail(id: string) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<unknown>(null);

  const fetchNotice = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const { data, error } = await supabase
        .from('notices')          // ← テーブル名を実際に合わせてください
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      setNotice(data as Notice);
    } catch (e) {
      setError(e);
      setNotice(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) fetchNotice();
  }, [id, fetchNotice]);

  return { notice, loading, error, refetch: fetchNotice };
}
