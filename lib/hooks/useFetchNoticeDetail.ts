// lib/hooks/useFetchNoticeDetail.ts
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type NoticeDetail = {
  id: string;
  title: string | null;
  content: string | null;
  date: string | null;
  is_published: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

export function useFetchNoticeDetail(id: string | null) {
  const [notice, setNotice] = useState<NoticeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await (supabase.from('notices') as any)
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (error) {
          console.error('[useFetchNoticeDetail] fetch error:', error);
          setError(error);
          setNotice(null);
          return;
        }

        if (!cancelled) setNotice((data ?? null) as NoticeDetail | null);
      } catch (e: any) {
        console.error('[useFetchNoticeDetail] fatal error:', e);
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
          setNotice(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  return { notice, loading, error };
}
