// lib/hooks/useNotices.ts
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Notice = {
  id: string;
  title: string;
  content: string;
  date: string | null; // YYYY-MM-DD or null
  is_published: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

type UseNoticesOptions = {
  enabled?: boolean;
  includeUnpublished?: boolean;
  limit?: number;
  search?: string;
};

function asTime(v?: string | null) {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function useNotices(opts: UseNoticesOptions = {}) {
  const supabase = useMemo(() => createClient(), []);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetcher = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let q = supabase.from("notices").select("*");

      if (!opts.includeUnpublished) {
        q = q.eq("is_published", true);
      }

      const s = (opts.search ?? "").trim();
      if (s) {
        q = q.or(`title.ilike.%${s}%,content.ilike.%${s}%`);
      }

      if (opts.limit && Number.isFinite(opts.limit)) {
        q = q.limit(opts.limit as number);
      }

      // ⚠️ サーバー側 order(date) は使わない（400回避）
      const { data, error } = await q;
      if (error) throw error;

      const sorted = (data ?? []).sort((a: Notice, b: Notice) => {
        // 優先キー: date → 次点 created_at
        const at = asTime(a.date ?? a.created_at ?? null);
        const bt = asTime(b.date ?? b.created_at ?? null);
        return bt - at; // 降順
      });

      setNotices(sorted);
    } catch (e: any) {
      console.error("[useNotices] fetch error:", e);
      setError(e?.message || "failed to fetch notices");
    } finally {
      setLoading(false);
    }
  }, [supabase, opts.includeUnpublished, opts.limit, opts.search]);

  useEffect(() => {
    if (opts.enabled === false) return;
    fetcher();
  }, [fetcher, opts.enabled]);

  return { notices, loading, error, refetch: fetcher };
}
