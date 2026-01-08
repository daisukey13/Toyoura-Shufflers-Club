'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

function isInvalidRefreshTokenLike(err: any) {
  const msg = String(err?.message ?? err ?? '');
  return (
    /Invalid Refresh Token/i.test(msg) ||
    /Already Used/i.test(msg) ||
    /Refresh Token Not Found/i.test(msg)
  );
}

export default function AuthCookieSync() {
  useEffect(() => {
    const supabase = createClient();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        await fetch('/auth/callback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event, session }),
        });
      } catch (e) {
        // 競合系は悪化しやすいので黙って終わる
        if (isInvalidRefreshTokenLike(e)) return;
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  return null;
}
