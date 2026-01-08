// lib/hooks/useFetchNoticeDetail.ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

/** 必要最低限の Notice 型（DB列が増えても壊れないよう optional 多め） */
export type NoticeRow = {
  id: string;
  title?: string | null;
  body?: string | null;
  created_at?: string | null;
  updated_at?: string | null;

  // あり得る列（環境差分吸収）
  is_published?: boolean | null;
  published_at?: string | null;
  pinned?: boolean | null;
  category?: string | null;
};

type Options = {
  requireAuth?: boolean; // 既存互換用（必要なら使う）
};

export function useFetchNoticeDetail(noticeId?: string | null, opts: Options = {}) {
  const { requireAuth = false } = opts;

  const [notice, setNotice] = useState<NoticeRow | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  const fetchOne = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      if (!noticeId) {
        if (mountedRef.current) {
          setNotice(null);
          setLoading(false);
        }
        return;
      }

      if (requireAuth) {
        const { data } = await supabase.auth.getUser();
        if (!data.user) {
          if (mountedRef.current) {
            setNotice(null);
            setError('ログインが必要です。');
            setLoading(false);
          }
          return;
        }
      }

      const { data, error: qErr } = await supabase
        .from('notices')
        .select('*')
        .eq('id', noticeId)
        .maybeSingle();

      if (qErr) throw qErr;

      if (mountedRef.current) {
        setNotice((data as any) ?? null);
        setLoading(false);
      }
    } catch (e: any) {
      if (mountedRef.current) {
        setNotice(null);
        setError(e?.message ?? 'お知らせの取得に失敗しました');
        setLoading(false);
      }
    }
  }, [noticeId, requireAuth]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchOne();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchOne]);

  return { notice, loading, error, refetch: fetchOne };
}
