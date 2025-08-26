// app/AuthCookieSync.tsx
'use client';

import { useEffect, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function AuthCookieSync() {
  const supabase = useMemo(() => createClient(), []);
  const lastAccessTokenRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  const postSync = async (payload: { event: string; session: any }) => {
    try {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      await fetch('/auth/callback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } finally {
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    let unsub: (() => void) | undefined;

    // 初期同期
    supabase.auth.getSession().then(({ data: { session } }) => {
      const token = session?.access_token ?? null;
      if (token) {
        lastAccessTokenRef.current = token;
        void postSync({ event: 'TOKEN_REFRESHED', session });
      }
    });

    // 認証イベント監視
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        lastAccessTokenRef.current = null;
        void postSync({ event, session: null });
        return;
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        const token = session?.access_token ?? null;
        if (token && lastAccessTokenRef.current !== token) {
          lastAccessTokenRef.current = token;
          void postSync({ event, session });
        }
      }
    });

    unsub = () => sub?.subscription?.unsubscribe?.();
    return () => { if (unsub) unsub(); };
  }, [supabase]);

  return null;
}
