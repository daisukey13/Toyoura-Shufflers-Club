// app/login/page.tsx
'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Script from 'next/script';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { FaLock, FaPhone, FaEnvelope, FaArrowLeft } from 'react-icons/fa';

type Mode = 'email' | 'phone';

// Turnstile 型
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: any) => string;
      reset: (id?: string) => void;
      getResponse: (id?: string) => string;
    };
  }
}

/** 見た目だけ +81 を付ける整形（日本想定、サーバ側で厳密正規化済み） */
function toE164JapanForView(input: string): string {
  let s = (input || '').trim().normalize('NFKC');
  s = s.replace(/[^\d+]/g, '');
  if (!s) return s;
  if (s.startsWith('+')) return s;
  if (s.startsWith('00')) return '+' + s.slice(2);
  if (/^0\d{9,10}$/.test(s)) return '+81' + s.slice(1);
  return s;
}

function Fallback() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="glass-card rounded-xl p-8">
          <div className="h-6 w-32 bg-white/10 rounded mb-4" />
          <div className="h-10 w-full bg-white/10 rounded mb-3" />
          <div className="h-10 w-full bg-white/10 rounded" />
        </div>
      </div>
    </div>
  );
}

/** Suspense でラップした内側本体 */
function LoginPageInner() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Hydration 安定化
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const redirectQ = mounted ? (searchParams.get('redirect') ?? '') : '';
  const hasRedirect = !!(redirectQ && redirectQ !== '/login');
  const redirectSafe = hasRedirect ? redirectQ : '/';

  // 既ログインか（サーバCookie基準）
  const [alreadyAuthed, setAlreadyAuthed] = useState<boolean | null>(null);

  const [mode, setMode] = useState<Mode>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // Turnstile
  const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
  const [scriptReady, setScriptReady] = useState(false);
  const [cfToken, setCfToken] = useState<string>('');
  const widgetHostRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  /** サーバCookieの実セッション確認 */
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/auth/whoami', { cache: 'no-store' });
        const j = r.ok ? await r.json() : { authenticated: false };
        if (cancelled) return;
        setAlreadyAuthed(!!j?.authenticated);

        // ✅ redirect= があるときだけ自動遷移（手動アクセス時は滞在）
        if (j?.authenticated && hasRedirect) {
          router.replace(redirectSafe);
        }
      } catch {
        if (!cancelled) setAlreadyAuthed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mounted, hasRedirect, redirectSafe, router]);

  /** phone モードで Turnstile を明示レンダー */
  useEffect(() => {
    if (!mounted) return;
    if (mode !== 'phone') return;
    if (!SITE_KEY || !scriptReady) return;
    const host = widgetHostRef.current;
    if (!host) return;

    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
      setCfToken('');
      return;
    }
    if (window.turnstile) {
      const id = window.turnstile.render(host, {
        sitekey: SITE_KEY,
        action: 'login',
        size: 'flexible',
        callback: (token: string) => setCfToken(token),
        'error-callback': () => setCfToken(''),
        'timeout-callback': () => setCfToken(''),
      });
      widgetIdRef.current = id;
      setCfToken('');
    }
  }, [mounted, mode, SITE_KEY, scriptReady]);

  useEffect(() => {
    if (!mounted) return;
    setCfToken('');
  }, [mounted, mode]);

  const syncServerSession = async (event: 'SIGNED_IN' | 'TOKEN_REFRESHED', session: any) => {
    try {
      await fetch('/auth/callback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event, session }),
      });
    } catch {}
  };

  const afterSuccessRedirect = async () => {
    router.replace(redirectSafe);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let loginEmail = email.trim();

      if (mode === 'phone') {
        if (!SITE_KEY) throw new Error('CAPTCHA 用 Site key が未設定です。');
        if (!cfToken) throw new Error('人間確認（CAPTCHA）を完了してください。');
        const res = await fetch('/api/login/resolve-email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phone, token: cfToken }),
        });
        const json = await res.json();
        if (!res.ok) {
          if (json?.error === 'not_found') throw new Error('この電話番号のユーザーが見つかりませんでした。');
          if (json?.error === 'invalid_phone') throw new Error('電話番号の形式が正しくありません。');
          if (json?.error === 'captcha_failed') throw new Error('人間確認に失敗しました。もう一度お試しください。');
          throw new Error(json?.message || '照会に失敗しました。');
        }
        loginEmail = json.email;
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });
      if (signInError) throw new Error('メールまたはパスワードが正しくありません。');

      if (data.session) {
        await syncServerSession('SIGNED_IN', data.session);
      }

      try {
        if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
        setCfToken('');
      } catch {}

      await afterSuccessRedirect();
    } catch (err: any) {
      setError(err?.message || 'ログインに失敗しました');
      try {
        if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
        setCfToken('');
      } catch {}
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchAccount = async () => {
    // アカウント切替：ログアウトして同ページを再表示
    try {
      await supabase.auth.signOut();
      await fetch('/auth/callback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: 'SIGNED_OUT', session: null }),
      });
    } catch {}
    setAlreadyAuthed(false);
  };

  // マウント前はスケルトン
  if (!mounted || alreadyAuthed === null) {
    return <Fallback />;
  }

  // 既ログインだが redirect が無い（手動アクセス）のときは案内を表示
  if (alreadyAuthed && !hasRedirect) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md glass-card rounded-xl p-8 text-center">
          <h1 className="text-xl font-bold mb-2">すでにログイン中です</h1>
          <p className="text-gray-400 mb-6">
            トップページ、もしくは管理ページに移動できます。別アカウントでログインする場合はアカウント切替を押してください。
          </p>
          <div className="flex gap-3 justify-center">
            <Link href="/" className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 transition-colors">
              トップへ
            </Link>
            <Link
              href="/admin/dashboard"
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors"
            >
              管理ページへ
            </Link>
            <button
              onClick={handleSwitchAccount}
              className="px-4 py-2 rounded-lg bg-gray-600 hover:bg-gray-700 transition-colors"
            >
              アカウント切替
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      {SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          async
          defer
          onLoad={() => setScriptReady(true)}
        />
      )}

      <div className="w-full max-w-md">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 mb-8 transition-colors"
        >
          <FaArrowLeft /> トップページに戻る
        </Link>

        <div className="glass-card rounded-xl p-8">
          <div className="text-center mb-8">
            <div className="inline-block p-4 rounded-full bg-purple-600/20 mb-4">
              <FaLock className="text-3xl text-purple-400" />
            </div>
            <h1 className="text-2xl font-bold text-yellow-100">ログイン</h1>
            <p className="text-gray-400 mt-2">メールまたは電話番号でログイン</p>
          </div>

          {!SITE_KEY && mode === 'phone' && (
            <div className="mb-4 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 text-sm">
              NEXT_PUBLIC_TURNSTILE_SITE_KEY が未設定のため、電話番号ログインは利用できません。
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 mb-6">
            <button
              type="button"
              onClick={() => setMode('email')}
              className={`px-4 py-2 rounded-lg border flex items-center justify-center gap-2 transition-colors ${
                mode === 'email'
                  ? 'border-purple-400 text-purple-300 bg-purple-500/10'
                  : 'border-purple-500/30 text-gray-300 hover:bg-purple-500/10'
              }`}
            >
              <FaEnvelope /> メール
            </button>
            <button
              type="button"
              onClick={() => setMode('phone')}
              className={`px-4 py-2 rounded-lg border flex items-center justify-center gap-2 transition-colors ${
                mode === 'phone'
                  ? 'border-purple-400 text-purple-300 bg-purple-500/10'
                  : 'border-purple-500/30 text-gray-300 hover:bg-purple-500/10'
              }`}
            >
              <FaPhone /> 電話番号
            </button>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 text-sm">
                {error}
              </div>
            )}

            {mode === 'email' ? (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">メールアドレス</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none"
                  placeholder="example@email.com"
                  autoComplete="username"
                  required
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  電話番号（+81 もしくは 0 から）
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onBlur={() => setPhone(toE164JapanForView(phone))}
                  className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none"
                  placeholder="+819012345678 または 09012345678"
                  autoComplete="tel"
                  required
                />
                <p className="text-xs text-gray-400 mt-2">
                  入力後フォーカスを外すと自動で <code>+81</code> 形式に整形されます（見た目のみ）。
                </p>
                {SITE_KEY && (
                  <div className="mt-4">
                    <div ref={widgetHostRef} />
                    {!cfToken && <p className="text-xs text-gray-500 mt-2">CAPTCHA を完了してください。</p>}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">パスワード</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none"
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || (mode === 'phone' && !!SITE_KEY && !cfToken)}
              className="w-full px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {loading ? 'ログイン中...' : 'ログイン'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link href="/forgot-password" className="text-sm text-purple-400 hover:text-purple-300">
              パスワードをお忘れの方はこちら
            </Link>
            <p className="text-sm text-gray-400 mt-2">
              アカウント未作成の方は{' '}
              <Link href="/register" className="text-purple-400 hover:text-purple-300">
                新規登録
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // Suspense で useSearchParams を含むクライアントを包む
  return (
    <Suspense fallback={<Fallback />}>
      <LoginPageInner />
    </Suspense>
  );
}
