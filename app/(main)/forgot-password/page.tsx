// app/(main)/forgot-password/page.tsx
'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { FaEnvelope, FaLock, FaSpinner } from 'react-icons/fa';

/* ---------------- Fallback for Suspense ---------------- */
function Fallback() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="glass-card rounded-xl p-8 text-center">
        <FaSpinner className="mx-auto mb-3 animate-spin text-purple-400" />
        <p className="text-gray-300">読み込み中...</p>
      </div>
    </div>
  );
}

/* ---------------- Page Inner (wrapped by Suspense) ---------------- */
function ForgotPasswordInner() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>('');
  const [sent, setSent] = useState(false);

  // Prefill email from query (?email=)
  useEffect(() => {
    setMounted(true);
    const qEmail = searchParams?.get('email');
    if (qEmail && typeof qEmail === 'string') setEmail(qEmail);
  }, [searchParams]);

  const redirectParam = useMemo(() => {
    const r = searchParams?.get('redirect');
    return r && r !== '/login' ? r : '/';
  }, [searchParams]);

  const redirectTo = useMemo(() => {
    if (!mounted) return '';
    // /reset-password に戻し、元の遷移先は ?redirect= に載せる
    const base = `${window.location.origin}/reset-password`;
    const qs = redirectParam ? `?redirect=${encodeURIComponent(redirectParam)}` : '';
    return `${base}${qs}`;
  }, [mounted, redirectParam]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setSending(true);
    setError('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo, // ← Supabase Auth 設定のリダイレクト許可URLに含めてください
      });
      if (error) throw error;
      setSent(true);
    } catch (err: any) {
      const msg = String(err?.message || err);
      // よくある文言のやわらか表現
      if (/email.*not valid|invalid/i.test(msg)) {
        setError('メールアドレスの形式が正しくありません。');
      } else if (/over request rate|rate/i.test(msg)) {
        setError('リクエストが多すぎます。しばらくしてからお試しください。');
      } else {
        setError(msg || 'メール送信に失敗しました。');
      }
    } finally {
      setSending(false);
    }
  };

  if (!mounted) return <Fallback />;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="glass-card rounded-xl p-8">
          <div className="text-center mb-8">
            <div className="inline-block p-4 rounded-full bg-purple-600/20 mb-4">
              <FaLock className="text-3xl text-purple-400" />
            </div>
            <h1 className="text-2xl font-bold text-yellow-100">パスワードをお忘れですか？</h1>
            <p className="text-gray-400 mt-2">
              登録済みのメールアドレスを入力すると、再設定用リンクをお送りします。
            </p>
          </div>

          {sent ? (
            <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-4 text-green-300">
              再設定メールを送信しました。メール内のリンクからパスワードを再設定してください。
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  メールアドレス
                </label>
                <div className="relative">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none"
                    placeholder="example@email.com"
                    autoComplete="email"
                    required
                  />
                  <FaEnvelope className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
                </div>
              </div>

              <button
                type="submit"
                disabled={sending || !email}
                className="w-full px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium inline-flex items-center justify-center gap-2"
              >
                {sending && <FaSpinner className="animate-spin" />}
                送信する
              </button>

              <p className="text-xs text-gray-500">
                ※ 迷惑メールフォルダに振り分けられる場合があります。届かない場合は、メールアドレスの誤りや受信設定をご確認ください。
              </p>
            </form>
          )}

          <div className="mt-6 text-center">
            <button
              onClick={() => router.push('/login')}
              className="text-sm text-purple-400 hover:text-purple-300 underline-offset-2 hover:underline"
            >
              ログイン画面へ戻る
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Default export: add Suspense wrapper (CSR bailout対策) ---------------- */
export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <ForgotPasswordInner />
    </Suspense>
  );
}
