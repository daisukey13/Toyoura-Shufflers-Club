// app/login/page.tsx
'use client';
import { redirect } from 'next/navigation';

export default function AdminLogin() {
  redirect('/login?redirect=/admin'); // 目的地は必要に応じて調整
}
import { Suspense, useEffect, useState } from 'react';
import Script from 'next/script';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { FaLock, FaPhone, FaEnvelope, FaArrowLeft } from 'react-icons/fa';

const supabase = createClient();
type Mode = 'email' | 'phone';

// Turnstile の型定義（型エラー回避用）
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: any) => string;
      reset: (id?: string) => void;
      getResponse: (id?: string) => string;
    };
    onTurnstileSuccess?: (token: string) => void;
  }
}

/** useSearchParams を使う実処理は Suspense の内側に隔離 */
function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || null;

  const [mode, setMode] = useState<Mode>('email');

  // email ログイン用
  const [email, setEmail] = useState('');
  // phone ログイン用（→ サーバーでメール解決）
  const [phone, setPhone] = useState('');

  const [password, setPassword] = useState('');
  const [cfToken, setCfToken] = useState<string>('');    // Turnstile トークン
  const [widgetReady, setWidgetReady] = useState(false); // ウィジェットの読み込み完了
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

  // Turnstile コールバック（data-callback から呼ばれる）
  useEffect(() => {
    window.onTurnstileSuccess = (token: string) => {
      setCfToken(token);
    };
  }, []);

  // モード切替時に状態リセット
  useEffect(() => {
    setError('');
    setCfToken('');
    try {
      window.turnstile?.reset();
    } catch {}
  }, [mode]);

  const onTurnstileLoaded = () => setWidgetReady(true);

  const goAfterLogin = async () => {
    if (redirectTo) {
      router.push(redirectTo);
      return;
    }
    // 権限別の分岐は middleware 側でハンドリングしている想定。ここではトップへ。
    router.push('/');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let loginEmail = email.trim();

      // 電話番号モードのときは CAPTCHA を必須に（Site Key が設定されている場合）
      if (mode === 'phone' && SITE_KEY && !cfToken) {
        throw new Error('人間確認（CAPTCHA）を完了してください。');
      }

      if (mode === 'phone') {
        // サーバーに電話番号 + Turnstile トークンを送ってメールを解決
        const res = await fetch('/api/login/resolve-email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phone, token: cfToken }),
        });
        const json = await res.json();

        if (!res.ok) {
          if (json?.error === 'not_found') throw new Error('この電話番号のユーザーが見つかりませんでした。');
          if (json?.error === 'invalid_phone') throw new Error('電話番号の形式が正しくありません（例：+8190...）。');
          if (json?.error === 'captcha_failed') throw new Error('人間確認に失敗しました。もう一度お試しください。');
          throw new Error(json?.message || '照会に失敗しました。しばらくしてからお試しください。');
        }
        loginEmail = json.email;
      }

      // メール＋パスワードで通常ログイン
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: password,
      });
      if (signInError) throw new Error('メールまたはパスワードが正しくありません。');

      // 成功したら Turnstile をリセット（念のため）
      try {
        window.turnstile?.reset();
      } catch {}

      await goAfterLogin();
    } catch (err: any) {
      setError(err?.message || 'ログインに失敗しました');
      // 失敗時もリセットして再入力可能に
      try {
        window.turnstile?.reset();
        setCfToken('');
      } catch {}
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      {/* Turnstile スクリプト（Site Key があるときのみ読み込み） */}
      {SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          async
          defer
          onLoad={onTurnstileLoaded}
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

          {/* Turnstile site key 未設定の注意（開発時の見落とし防止） */}
          {!SITE_KEY && (
            <div className="mb-4 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 text-sm">
              NEXT_PUBLIC_TURNSTILE_SITE_KEY が設定されていません。CAPTCHA は無効です。
            </div>
          )}

          {/* モード切替 */}
          <div className="grid grid-cols-2 gap-2 mb-6">
            <button
              type="button"
              onClick={() => setMode('email')}
              className={`px-4 py-2 rounded-lg border transition-colors flex items-center justify-center gap-2 ${
                mode === 'email'
                  ? 'border-purple-400 text-purple-300 bg-purple-500/10'
                  : 'border-purple-500/30 text-gray-300 hover:bg-purple-500/10'
              }`}
              aria-pressed={mode === 'email'}
            >
              <FaEnvelope /> メール
            </button>
            <button
              type="button"
              onClick={() => setMode('phone')}
              className={`px-4 py-2 rounded-lg border transition-colors flex items-center justify-center gap-2 ${
                mode === 'phone'
                  ? 'border-purple-400 text-purple-300 bg-purple-500/10'
                  : 'border-purple-500/30 text-gray-300 hover:bg-purple-500/10'
              }`}
              aria-pressed={mode === 'phone'}
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
                  className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors"
                  placeholder="example@email.com"
                  autoComplete="username"
                  required
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">電話番号（E.164形式）</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors"
                  placeholder="+819012345678（ハイフン不要）"
                  autoComplete="tel"
                  required
                />
                <p className="text-xs text-gray-400 mt-2">
                  例：日本の 090-1234-5678 → <code>+819012345678</code>
                </p>

                {/* Turnstile ウィジェット（電話番号モードで表示推奨） */}
                {SITE_KEY && (
                  <div className="mt-4">
                    <div
                      className="cf-turnstile"
                      data-sitekey={SITE_KEY}
                      data-callback="onTurnstileSuccess"
                      data-action="login"
                      data-size="flexible"
                    />
                    {!widgetReady && (
                      <p className="text-xs text-gray-500 mt-2">CAPTCHA を読み込み中…</p>
                    )}
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
                className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors"
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

/** ページのデフォルトエクスポートは Suspense で包む */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center p-8">読み込み中...</div>}>
      <LoginContent />
    </Suspense>
  );
}
