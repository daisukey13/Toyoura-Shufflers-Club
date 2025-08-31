// components/client/AuthAwareLoginButton.client.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FaUserCircle } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

export default function AuthAwareLoginButtonClient() {
  const supabase = useMemo(() => createClient(), []);
  const [authed, setAuthed] = useState<boolean | null>(null);

  const refreshWhoami = useCallback(async () => {
    try {
      const r = await fetch('/auth/whoami', { cache: 'no-store' });
      const j = r.ok ? await r.json() : { authenticated: false };
      setAuthed(!!j?.authenticated);
    } catch {
      setAuthed(false);
    }
  }, []);

  // 初回 & 画面復帰でサーバー判定を取り直す / クライアントの認証イベントにも追従
  useEffect(() => {
    let active = true;

    (async () => {
      if (!active) return;
      await refreshWhoami();
    })();

    const onFocus = () => refreshWhoami();
    window.addEventListener('focus', onFocus);

    const { data: sub } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_OUT') {
        await refreshWhoami();
      }
    });

    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
      try {
        sub?.subscription?.unsubscribe();
      } catch {}
    };
  }, [refreshWhoami, supabase]);

  const isAuthed = !!authed;

  // ★ 未ログイン時は電話番号タブ（CAPTCHA あり）で開く
  const href = isAuthed ? '/mypage' : '/login?redirect=/mypage&mode=phone';

  const label = isAuthed ? 'ログイン中' : 'ログイン';
  const className =
    'inline-flex items-center justify-center px-4 sm:px-5 py-2.5 sm:py-3 rounded-lg font-medium transition-colors border ' +
    (isAuthed
      ? 'bg-green-600 hover:bg-green-700 text-white border-green-500/50'
      : 'bg-purple-600 hover:bg-purple-700 text-white border-purple-500/50');

  // 認証状態判定中のプレースホルダ
  if (authed === null) {
    return (
      <span
        className="inline-flex items-center px-4 py-2.5 rounded-lg bg-white/10 text-gray-300 border border-white/20 select-none"
        aria-busy="true"
      >
        <FaUserCircle className="mr-2 opacity-70" />
        確認中…
      </span>
    );
  }

  return (
    <Link href={href} prefetch={false} className={className} aria-label={label} title={label}>
      <FaUserCircle className="mr-2" />
      {label}
    </Link>
  );
}
