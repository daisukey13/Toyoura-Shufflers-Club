'use client';

import { useEffect, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export default function AuthCookieSync() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const sync = async (event: string, session: any) => {
      try {
        await fetch('/auth/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          cache: 'no-store',
          body: JSON.stringify({ event, session }),
        });
      } catch {
        // ignore
      }
    };

    // 初回：localStorage 側の session をサーバ cookie に反映
    supabase.auth.getSession().then(({ data }) => {
      void sync('INITIAL_SESSION', data.session);
    });

    // 以後：ログイン/ログアウト等の変化を反映
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      void sync(event, session);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  return null;
}
