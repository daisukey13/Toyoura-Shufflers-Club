// app/(auth)/login/page.tsx
'use client';

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Script from 'next/script';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { FaLock, FaPhone, FaEnvelope, FaArrowLeft } from 'react-icons/fa';

type Mode = 'email' | 'phone';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: any) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
      getResponse: (id?: string) => string;
    };
  }
}

/** 見た目だけ +81 を付ける整形（日本想定） */
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

function LoginPageInner() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const DEFAULT_AFTER_LOGIN = '/mypage';
  const redirectQ = mounted ? (searchParams.get('redirect') ?? '') : '';
  const hasRedirect = !!(redirectQ && redirectQ !== '/login');
  const redirectSafe = hasRedirect ? redirectQ : DEFAULT_AFTER_LOGIN;

  const [alreadyAuthed, setAlreadyAuthed] = useState<boolean | null>(null);

  const [mode, setMode] = useState<Mode>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // Turnstile（電話番号タブのみ使用）
  const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptError, setScriptError] = useState('');
  const [cfToken, setCfToken] = useState('');
  const [cfMsg, setCfMsg] = useState('');
  const widgetHostRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenTimeRef = useRef<number>(0); // 取得時刻(ms)
  const TOKEN_TTL_MS = 110 * 1000;       // 110秒で期限切れ扱い

  /** whoami で既ログイン判定 */
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/auth/whoami', { cache: 'no-store' });
        const j = r.ok ? await r.json() : { authenticated: false };
        if (cancelled) return;
        setAlreadyAuthed(!!j?.authenticated);
        if (j?.authenticated && hasRedirect) router.replace(redirectSafe);
      } catch {
        if (!cancelled) setAlreadyAuthed(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mounted, hasRedirect, redirectSafe, router]);

  /** CAPTCHA を無効化（入力変更/失敗/期限切れ時） */
  const resetCaptcha = useCallback((hint?: string) => {
    try {
      if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
    } catch {}
    tokenTimeRef.current = 0;
    setCfToken('');
    setCfMsg(hint || '');
  }, []);

  /** phone タブ時だけ Turnstile を mount */
  const mountTurnstile = useCallback(() => {
    setCfMsg('');
    setCfToken('');
    tokenTimeRef.current = 0;

    if (!SITE_KEY) {
      setCfMsg('電話番号ログインには CAPTCHA の Site key が必要です（NEXT_PUBLIC_TURNSTILE_SITE_KEY）。');
      return;
    }
    const host = widgetHostRef.current;
    if (!host) return;

    // 既存があるなら reset
    if (widgetIdRef.current && window.turnstile) {
      resetCaptcha();
      return;
    }

    if (window.turnstile) {
      try {
        const id = window.turnstile.render(host, {
          sitekey: SITE_KEY,
          action: 'login',
          theme: 'auto',
          size: 'flexible',
          callback: (token: string) => {
            setCfToken(token);
            tokenTimeRef.current = Date.now();
            setCfMsg('');
          },
          'expired-callback': () =>
            resetCaptcha('CAPTCHA の有効期限が切れました。もう一度完了してください。'),
          'timeout-callback': () =>
            resetCaptcha('CAPTCHA がタイムアウトしました。再度お試しください。'),
          'error-callback': () =>
            resetCaptcha('CAPTCHA の初期化に失敗しました。拡張機能/ネットワーク/CSP をご確認ください。'),
        });
        widgetIdRef.current = id;
      } catch {
        setCfMsg('CAPTCHA の初期化に失敗しました。');
      }
    }
  }, [SITE_KEY, resetCaptcha]);

  /** タブ離脱やアンマウントで確実に破棄 */
  const unmountTurnstile = useCallback(() => {
    try {
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
    } catch {}
    widgetIdRef.current = null;
    tokenTimeRef.current = 0;
    setCfToken('');
    setCfMsg('');
  }, []);

  // スクリプト読み込み完了時 / モード切替で mount/unmount
  useEffect(() => {
    if (!mounted) return;
    if (mode === 'phone' && scriptReady) {
      mountTurnstile();
    } else {
      unmountTurnstile();
    }
    return () => {
      if (mode !== 'phone') return;
      unmountTurnstile();
    };
  }, [mounted, mode, scriptReady, mountTurnstile, unmountTurnstile]);

  // スクリプトが来ないときのガード
  useEffect(() => {
    if (!mounted || mode !== 'phone' || scriptReady) return;
    const t = setTimeout(() => {
      if (!scriptReady) {
        setScriptError('CAPTCHA スクリプトを読み込めませんでした。ネットワーク/拡張機能/CSP を確認してください。');
      }
    }, 4000);
    return () => clearTimeout(t);
  }, [mounted, mode, scriptReady]);

  const syncServerSession = async (event: 'SIGNED_IN' | 'TOKEN_REFRESHED' | 'SIGNED_OUT', session: any) => {
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

  /** 直前に常に最新 Turnstile トークンを取得 */
  const getFreshToken = useCallback(() => {
    const fromWidget =
      (widgetIdRef.current && window.turnstile?.getResponse(widgetIdRef.current)) || '';
    const token = fromWidget || cfToken || '';
    if (!token) return '';
    const age = Date.now() - tokenTimeRef.current;
    if (!tokenTimeRef.current || age > TOKEN_TTL_MS) {
      return '';
    }
    return token;
  }, [cfToken]);

  /** fetch の JSON 安全パーサ（HTML 404 等での "Unexpected token '<'" を防ぐ） */
  const safeJson = async (res: Response) => {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { __nonjson: true, text };
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let loginEmail = email.trim();

      if (mode === 'phone') {
        if (!SITE_KEY) throw new Error('CAPTCHA 用 Site key が未設定です。');

        const token = getFreshToken();
        if (!token) {
          resetCaptcha('CAPTCHA を完了してください。');
          throw new Error('CAPTCHA を完了してください。');
        }

        // 電話番号 → email の解決
        const res = await fetch('/api/login/resolve-email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phone, token }),
        });
        const json = await safeJson(res);

        if (!res.ok) {
          // サーバからの JSON 以外（= ルート間違いなど）を検知
          if ((json as any)?.__nonjson) {
            throw new Error('サーバ応答が不正です。エンドポイント /api/login/resolve-email を確認してください。');
          }
          // Turnstile 失敗の詳細を表示
          if ((json as any)?.error === 'captcha_failed') {
            const codes: string[] = (json as any)?.codes || [];
            let msg = '人間確認に失敗しました。もう一度 CAPTCHA を完了してください。';
            if (codes.includes('timeout-or-duplicate')) msg = 'CAPTCHA の有効期限が切れたか、既に使用済みです。もう一度実施してください。';
            if (codes.includes('invalid-input-secret')) msg = 'サーバ側の Turnstile シークレットが正しくありません（管理者設定が必要）。';
            if (codes.includes('missing-input-secret')) msg = 'サーバ側のシークレットが未設定です（管理者設定が必要）。';
            if (codes.includes('invalid-input-response')) msg = 'CAPTCHA 応答が無効です。ページを再読み込みして再度お試しください。';
            resetCaptcha(msg);
            throw new Error(msg);
          }
          if ((json as any)?.error === 'invalid_phone') throw new Error('電話番号の形式が正しくありません。');
          if ((json as any)?.error === 'not_found') throw new Error('この電話番号のユーザーが見つかりませんでした。');
          if ((json as any)?.error === 'rate_limited') throw new Error('リクエストが多すぎます。しばらくしてからお試しください。');

          throw new Error((json as any)?.message || '照会に失敗しました。');
        }

        loginEmail = (json as any).email;
      }

      // メール/パスワードでログイン（電話番号の時は解決した email を使用）
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });
      if (signInError) throw new Error('メール（または電話に紐づくメール）かパスワードが正しくありません。');

      if (data.session) await syncServerSession('SIGNED_IN', data.session);

      try {
        if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
        tokenTimeRef.current = 0;
        setCfToken('');
      } catch {}

      await afterSuccessRedirect();
    } catch (err: any) {
      setError(err?.message || 'ログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchAccount = async () => {
    try {
      await supabase.auth.signOut();
      await syncServerSession('SIGNED_OUT', null);
    } catch {}
    setAlreadyAuthed(false);
  };

  if (!mounted || alreadyAuthed === null) return <Fallback />;

  if (alreadyAuthed && !hasRedirect) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md glass-card rounded-xl p-8 text-center">
          <h1 className="text-xl font-bold mb-2">すでにログイン中です</h1>
          <p className="text-gray-400 mb-6">別アカウントでログインする場合はアカウント切替を押してください。</p>
          <div className="flex gap-3 justify-center">
            <Link href={DEFAULT_AFTER_LOGIN} className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 transition-colors">
              マイページへ
            </Link>
            <Link href="/admin/dashboard" className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors">
              管理ページへ
            </Link>
            <button onClick={handleSwitchAccount} className="px-4 py-2 rounded-lg bg-gray-600 hover:bg-gray-700 transition-colors">
              アカウント切替
            </button>
          </div>
        </div>
      </div>
    );
  }

  const primaryButtonText = loading ? 'ログイン中…' : 'ログイン';
  const primaryDisabled =
    loading ||
    (mode === 'phone' && !!SITE_KEY && !cfToken); // 電話番号タブでは CAPTCHA 完了が必須

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      {!!SITE_KEY && (
        <Script
          id="cf-turnstile"
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={() => setScriptReady(true)}
          onError={() =>
            setScriptError('CAPTCHA スクリプトの読み込みに失敗しました。ネットワーク/拡張機能/CSP を確認してください。')
          }
        />
      )}

      <div className="w-full max-w-md">
        <Link href="/" className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 mb-8 transition-colors">
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
              電話番号ログインを使うには <code>NEXT_PUBLIC_TURNSTILE_SITE_KEY</code> を設定してください。
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 mb-6">
            <button
              type="button"
              onClick={() => { setMode('email'); setError(''); }}
              className={`px-4 py-2 rounded-lg border flex items-center justify-center gap-2 transition-colors ${
                mode === 'email' ? 'border-purple-400 text-purple-300 bg-purple-500/10' : 'border-purple-500/30 text-gray-300 hover:bg-purple-500/10'
              }`}
            >
              <FaEnvelope /> メール
            </button>
            <button
              type="button"
              onClick={() => { setMode('phone'); setError(''); }}
              className={`px-4 py-2 rounded-lg border flex items-center justify-center gap-2 transition-colors ${
                mode === 'phone' ? 'border-purple-400 text-purple-300 bg-purple-500/10' : 'border-purple-500/30 text-gray-300 hover:bg-purple-500/10'
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
              <>
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
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    電話番号（+81 もしくは 0 から）
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      resetCaptcha('電話番号が変更されました。CAPTCHA を再度完了してください。');
                    }}
                    onBlur={() => setPhone(toE164JapanForView(phone))}
                    className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none"
                    placeholder="+819012345678 または 09012345678"
                    autoComplete="tel"
                    required
                  />
                  <p className="text-xs text-gray-400 mt-2">
                    入力後フォーカスを外すと自動で <code>+81</code> 形式に整形されます（見た目のみ）。
                  </p>
                </div>

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

                <div className="mt-2">
                  <div ref={widgetHostRef} style={{ minHeight: 80 }} />
                  {!cfToken && (
                    <p className="text-xs text-gray-500 mt-2">
                      {cfMsg || (scriptError ? scriptError : !scriptReady ? 'CAPTCHA を読み込み中です…' : 'CAPTCHA を完了してください。')}
                    </p>
                  )}
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={primaryDisabled}
              className="w-full px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {primaryButtonText}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link href="/forgot-password" className="text-sm text-purple-400 hover:text-purple-300">
              パスワードをお忘れの方はこちら
            </Link>
            <p className="text-sm text-gray-400 mt-2">
              アカウント未作成の方は{' '}
              <Link href="/register" className="text-purple-400 hover:text-purple-300">新規登録</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <LoginPageInner />
    </Suspense>
  );
}
