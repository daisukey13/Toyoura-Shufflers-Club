// app/AuthCookieSync.tsx
'use client';

import { useEffect, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

// タブ単位で「前回同期したトークン」を覚える
const STORAGE_KEY = 'tsc:sb_cookie_sync:v1';

type SyncState = {
  sig: string; // access_token の末尾など（変化検知用）
  at: number;  // 最終同期時刻（デバッグ用）
};

function readState(): SyncState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { sig: 'none', at: 0 };
    const j = JSON.parse(raw);
    return { sig: String(j?.sig ?? 'none'), at: Number(j?.at ?? 0) };
  } catch {
    return { sig: 'none', at: 0 };
  }
}

function writeState(s: SyncState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

function tokenSig(accessToken?: string | null) {
  if (!accessToken) return 'none';
  // 末尾16文字で十分（同一判定用）
  return accessToken.slice(-16);
}

async function postSync(payload: any) {
  await fetch('/auth/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export default function AuthCookieSync() {
  // ✅ 1回のマウント中は同じ supabase を使う（モジュールスコープに置かない）
  const supabase = useMemo(() => createClient(), []);
  const inFlight = useRef(false);

  useEffect(() => {
    let mounted = true;

    const syncNow = async (reason: string) => {
      if (!mounted) return;
      if (inFlight.current) return;

      const { data } = await supabase.auth
        .getSession()
        .catch(() => ({ data: { session: null } } as any));
      const session = data?.session ?? null;

      const state = readState();
      const now = Date.now();

      // ---- セッション無し：以前はあったなら Cookie を消す ----
      if (!session) {
        if (state.sig !== 'none') {
          inFlight.current = true;
          try {
            await postSync({ action: 'signout', reason });
            writeState({ sig: 'none', at: now });
          } finally {
            inFlight.current = false;
          }
        }
        return;
      }

      // ---- セッションあり：トークンが変わった時だけ Cookie を更新 ----
      const sig = tokenSig(session.access_token);
      if (sig === state.sig) return; // ✅ ここが「必要時のみ」

      inFlight.current = true;
      try {
        await postSync({
          action: 'set',
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          reason,
        });
        writeState({ sig, at: now });
      } finally {
        inFlight.current = false;
      }
    };

    // 初回（起動時）に1回だけチェック
    void syncNow('boot');

    // 状態変化時だけ同期
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'USER_UPDATED' ||
        event === 'INITIAL_SESSION'
      ) {
        void syncNow(event);
      }

      if (event === 'SIGNED_OUT') {
        // 明示的にCookieを消す（state.sig が none でも害はない）
        void postSync({ action: 'signout', reason: event });
        writeState({ sig: 'none', at: Date.now() });
      }
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [supabase]);

  return null;
}
