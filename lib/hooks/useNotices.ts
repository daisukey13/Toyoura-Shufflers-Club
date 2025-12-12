// lib/hooks/useNotices.ts
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Notice = {
  id: string;
  title: string | null;
  content: string | null;
  date: string | null;         // date型 or null
  is_published: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

function asTime(v?: string | null) {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function useNotices(options?: { limit?: number; onlyPublished?: boolean }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      setLoading(true);
      setError(null);
      try {
        // カラム名差異で落としたくないので、できるだけワイドに select
        const { data, error } = await (supabase.from('notices') as any).select('*');
        if (error) {
          console.error('[useNotices] select error:', error);
          setError(error);
          setNotices([]);
          return;
        }

        const list = (data ?? []) as Notice[];

        // クライアント側で安定ソート
        const sorted = list
          // 公開のみフィルタ
          .filter((n) => (options?.onlyPublished ? n.is_published : true))
          .sort((a, b) => {
            // date（YYYY-MM-DD）優先 → created_at で補完
            const at = asTime(a.date ?? a.created_at ?? null);
            const bt = asTime(b.date ?? b.created_at ?? null);
            return bt - at; // 降順
          });

        const limited = options?.limit ? sorted.slice(0, options.limit) : sorted;
        if (!cancelled) {
          setNotices(limited);
        }
      } catch (e: any) {
        console.error('[useNotices] fatal error:', e);
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
          setNotices([]); // ここでも空配列を返し、絶対に throw はしない
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [options?.limit, options?.onlyPublished]);

  return { notices, loading, error };
}
