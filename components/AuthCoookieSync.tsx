'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

function isInvalidRefreshTokenLike(err: any) {
  const msg = String(err?.message ?? err ?? '');
  return /Invalid Refresh Token/i.test(msg) || /Already Used/i.test(msg) || /Refresh Token Not Found/i.test(msg);
}

export default function AuthCoookieSync() {
  useEffect(() => {
    const supabase = createClient();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      // ここで auth 周りが壊れている場合、callback を叩くと悪化することがあるので避ける
      try {
        // session が null でも送る（SIGNED_OUT 等の同期に必要）
        await fetch('/auth/callback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event, session }),
        });
      } catch (e) {
        // refresh token 競合っぽい時は黙って終了（画面を壊さない）
        if (isInvalidRefreshTokenLike(e)) return;
        // それ以外も基本無視（ここで UI を壊さない）
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  return null;
}
