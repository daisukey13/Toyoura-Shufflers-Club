// components/AuthCookieSync.tsx
'use client';

import { useEffect, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * クライアント側の Supabase 認証イベントを監視し、
 * サーバの Supabase Cookie（middleware/SSR 判定に使用）へセッションを同期します。
 *
 * - 初回マウント時に現在のセッションを /auth/callback へ送信
 * - 以後、SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT を捕捉して同期
 * - 同一 access_token の重複送信は避けて無駄な POST を削減
 */
export default function AuthCookieSync() {
  const supabase = useMemo(() => createClient(), []);
  const lastAccessTokenRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  // サーバへ同期（重複・多重送信を抑制）
  const postSync = async (payload: { event: string; session: any }) => {
    try {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      await fetch('/auth/callback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // same-origin のみ、Cookie は route.ts 側で set される
        body: JSON.stringify(payload),
      });
    } catch {
      // 失敗しても UI は止めない（次のイベントで再同期される）
    } finally {
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    let unsub: (() => void) | undefined;

    // 1) 初期同期：既存セッションがあれば Cookie を最新化
    supabase.auth.getSession().then(({ data: { session } }) => {
      const token = session?.access_token ?? null;
      if (token) {
        lastAccessTokenRef.current = token;
        void postSync({ event: 'TOKEN_REFRESHED', session });
      }
    });

    // 2) 認証イベント監視
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        // サインアウトは常に通知
        lastAccessTokenRef.current = null;
        void postSync({ event, session: null });
        return;
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        const token = session?.access_token ?? null;
        // 同一トークンの重複送信はスキップ（無限ループ/過剰 POST 対策）
        if (token && lastAccessTokenRef.current !== token) {
          lastAccessTokenRef.current = token;
          void postSync({ event, session });
        }
      }
    });

    unsub = () => sub?.subscription?.unsubscribe?.();

    return () => {
      if (unsub) unsub();
    };
  }, [supabase]);

  return null;
}
