// app/auth/callback/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * メール確認 / パスワードリセット / Magic Link / OAuth リダイレクトの着地点。
 * - URL の #/query に含まれるトークンを Supabase が検出（detectSessionInUrl=true）
 * - 取得したセッションを /auth/callback に POST して **サーバCookieへ同期**
 * - 同期後、redirect（なければ / ）へ遷移
 */
export default function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const [status, setStatus] = useState<'checking' | 'synced' | 'error'>('checking');
  const [message, setMessage] = useState<string>('メールアドレスを確認しています…');

  // ?redirect=/admin/dashboard のようなクエリをサポート
  const redirect = searchParams.get('redirect') || searchParams.get('next') || '/';

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let redirected = false;
    let timeoutId: any;

    const syncToServer = async (event: string, session: any | null) => {
      try {
        // サーバ側クッキーへセッションを反映
        await fetch('/auth/callback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event, session }),
        });
        setStatus('synced');
        setMessage('ログインが完了しました。移動します…');
        if (!redirected) {
          redirected = true;
          router.replace(redirect);
        }
      } catch (e) {
        setStatus('error');
        setMessage('サーバとの同期に失敗しました。もう一度お試しください。');
      }
    };

    (async () => {
      // 1) 既にセッションがあれば即同期
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await syncToServer('TOKEN_REFRESHED', session);
        return;
      }

      // 2) 状態変化を待って同期（メール確認/パスワードリセット直後など）
      const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          await syncToServer(event, session);
        } else if (event === 'SIGNED_OUT') {
          setStatus('error');
          setMessage('ログイン情報が見つかりませんでした。ログイン画面へ移動します…');
          if (!redirected) {
            redirected = true;
            router.replace('/login');
          }
        }
      });

      unsub = () => sub.subscription.unsubscribe();

      // 3) フォールバック：一定時間待ってもセッションが来ない場合はログインへ
      timeoutId = setTimeout(async () => {
        const { data: { session: again } } = await supabase.auth.getSession();
        if (again) {
          await syncToServer('TOKEN_REFRESHED', again);
        } else {
          setStatus('error');
          setMessage('リンクの有効期限が切れている可能性があります。ログイン画面へ移動します…');
          if (!redirected) {
            redirected = true;
            router.replace('/login');
          }
        }
      }, 4000);
    })();

    return () => {
      if (unsub) unsub();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [router, supabase, redirect]);

  // エラークエリ（?error= / ?error_description=）を表示
  useEffect(() => {
    const err = searchParams.get('error') || '';
    const desc = searchParams.get('error_description') || '';
    if (err || desc) {
      setStatus('error');
      setMessage(desc || err);
    }
    // ハッシュに message が来るケースに軽く対応
    if (typeof window !== 'undefined' && window.location.hash.includes('error_description=')) {
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const hErr = hashParams.get('error') || '';
      const hDesc = hashParams.get('error_description') || '';
      if (hErr || hDesc) {
        setStatus('error');
        setMessage(hDesc || hErr);
      }
    }
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="inline-block h-10 w-10 rounded-full bg-purple-500/20 animate-pulse mb-4" />
        <h1 className="text-2xl font-bold mb-2">
          {status === 'error' ? '処理に失敗しました' : 'メールアドレスが確認されました'}
        </h1>
        <p className="text-gray-300">{message}</p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => router.replace('/login')}
            className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 transition-colors"
          >
            ログインへ
          </button>
          <button
            onClick={() => router.replace('/')}
            className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors"
          >
            トップへ
          </button>
        </div>
      </div>
    </div>
  );
}
