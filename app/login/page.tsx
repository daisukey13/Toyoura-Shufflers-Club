// app/(auth)/login/page.tsx
'use client';

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Script from 'next/script';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { FaLock, FaPhone, FaEnvelope, FaArrowLeft } from 'react-icons/fa';

type Mode = 'email' | 'phone';

/** +81 表示整形（見た目のみ、日本想定） */
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

/* ★ 追加：内部パスだけ許可するサニタイズ */
function safeInternalPath(p?: string | null): string | null {
  if (!p) return null;
  try {
    const s = decodeURIComponent(p.trim());
    if (!s || s === '/login') return null;        // /login へは戻さない（ループ防止）
    if (!s.startsWith('/')) return null;          // 外部URL禁止
    // 必要ならさらに厳密なホワイトリストに
    return s;
  } catch {
    return null;
  }
}

function LoginPageInner() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // ★ 変更：?from または ?redirect を読み、内部パスのみ許可
  const DEFAULT_AFTER_LOGIN = '/mypage';
  const rawRedirect = mounted
    ? (searchParams.get('from') ?? searchParams.get('redirect') ?? '')
    : '';
  const redirectedFromParam = safeInternalPath(rawRedirect); // null なら使わない
  const redirectSafe = redirectedFromParam ?? DEFAULT_AFTER_LOGIN;

  const [alreadyAuthed, setAlreadyAuthed] = useState<boolean | null>(null);

  const [mode, setMode] = useState<Mode>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // ---- 管理者メール 決め打ち（複数可） -----------------------------------
  const ADMIN_EMAILS: Set<string> = useMemo(() => {
    const raw =
      process.env.NEXT_PUBLIC_ADMIN_EMAILS ||
      process.env.NEXT_PUBLIC_ADMIN_EMAIL ||
      'daisukeyud@gmail.com';
    return new Set(
      raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    );
  }, []);
  const isForcedAdmin = useCallback(
    (mail?: string | null) => !!mail && ADMIN_EMAILS.has(mail.trim().toLowerCase()),
    [ADMIN_EMAILS]
  );

  // ---- Turnstile（電話番号タブのみ） ---------------------------------------
  const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptError, setScriptError] = useState('');
  const [cfToken, setCfToken] = useState('');
  const [cfMsg, setCfMsg] = useState('');
  const widgetHostRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenTimeRef = useRef<number>(0);
  const TOKEN_TTL_MS = 110 * 1000;

  /** whoami → 既ログイン検出。管理者なら即ダッシュボードへ
   *  一般ユーザーは「?from/redirect が指定されている場合のみ」即リダイレクト
   *  （指定が無い通常アクセスでは従来どおりモーダル表示）
   */
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/auth/whoami', { cache: 'no-store' });
        const j = r.ok ? await r.json() : { authenticated: false };
        if (cancelled) return;

        if (j?.authenticated) {
          const { data: gu } = await supabase.auth.getUser();
          const currentEmail = gu?.user?.email?.toLowerCase() || '';
          if (currentEmail && isForcedAdmin(currentEmail)) {
            router.replace('/admin/dashboard');
            return;
          }
          // ★ 追加：一般ユーザーでも from/redirect があればそちらへ即遷移
          if (redirectedFromParam) {
            router.replace(redirectSafe);
            return;
          }
          setAlreadyAuthed(true); // ← 通常アクセスは従来どおりモーダル表示
          return;
        }

        setAlreadyAuthed(false);
      } catch {
        if (!cancelled) setAlreadyAuthed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, supabase, isForcedAdmin, router, redirectedFromParam, redirectSafe]);

  /** Turnstile window 参照（型定義の衝突回避のため any で扱う） */
  const getT = () =>
    (window as any).turnstile as
      | {
          render: (el: HTMLElement, opts: any) => string;
          reset: (id?: string) => void;
          remove: (id?: string) => void;
          getResponse: (id?: string) => string;
        }
      | undefined;

  /** CAPTCHA リセット */
  const resetCaptcha = useCallback((hint?: string) => {
    try {
      const T = getT();
      if (widgetIdRef.current && T) T.reset(widgetIdRef.current);
    } catch {}
    tokenTimeRef.current = 0;
    setCfToken('');
    setCfMsg(hint || '');
  }, []);

  /** phone タブで mount */
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

    const T = getT();
    if (widgetIdRef.current && T) {
      resetCaptcha();
      return;
    }
    if (T) {
      try {
        const id = T.render(host, {
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

  /** アンマウント */
  const unmountTurnstile = useCallback(() => {
    try {
      const T = getT();
      if (widgetIdRef.current && T) T.remove(widgetIdRef.current);
    } catch {}
    widgetIdRef.current = null;
    tokenTimeRef.current = 0;
    setCfToken('');
    setCfMsg('');
  }, []);

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

  /** 成功後の遷移（管理者メールは常にダッシュボード） */
  const afterSuccessRedirect = async (emails: string[]) => {
    const lower = emails.map((e) => (e || '').toLowerCase());
    const isAdmin = lower.some((e) => isForcedAdmin(e));
    router.replace(isAdmin ? '/admin/dashboard' : redirectSafe); // ★ 修正：from/redirect を優先
  };

  /** 最新 Turnstile token */
  const getFreshToken = useCallback(() => {
    const T = getT();
    const fromWidget =
      (widgetIdRef.current && T?.getResponse(widgetIdRef.current)) || '';
    const token = fromWidget || cfToken || '';
    if (!token) return '';
    const age = Date.now() - tokenTimeRef.current;
    if (!tokenTimeRef.current || age > TOKEN_TTL_MS) return '';
    return token;
  }, [cfToken]);

  /** JSON 安全パーサ */
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
        // 電話番号→email 解決
        const res = await fetch('/api/login/resolve-email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phone, token }),
        });
        const json = await safeJson(res);
        if (!res.ok) {
          if ((json as any)?.error === 'captcha_failed') {
            resetCaptcha('人間確認に失敗しました。もう一度行ってください。');
          }
          throw new Error((json as any)?.message || '照会に失敗しました。');
        }
        loginEmail = (json as any).email;
      }

      // サインイン
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });
      if (signInError) throw new Error('メール（または電話に紐づくメール）かパスワードが正しくありません。');

      if (data.session) await syncServerSession('SIGNED_IN', data.session);

      // Turnstile をリセット
      try {
        const T = getT();
        if (widgetIdRef.current && T) T.reset(widgetIdRef.current);
      } catch {}
      tokenTimeRef.current = 0;
      setCfToken('');

      // ★ 入力メール と Supabase 側メール の両方で管理者判定 → 適切にリダイレクト
      const effectiveEmails = [loginEmail, data.user?.email || ''];
      await afterSuccessRedirect(effectiveEmails);
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

  if (alreadyAuthed) {
    // ★ 既ログインでも from/redirect 指定があれば useEffect 側で即遷移するので
    // ここに来るのは通常アクセスだけ（従来のモーダル表示を維持）
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
  const primaryDisabled = loading || (mode === 'phone' && !!SITE_KEY && !cfToken);

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
                    className="w-full px-4 py-3 rounded-lg bg紫-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none"
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
