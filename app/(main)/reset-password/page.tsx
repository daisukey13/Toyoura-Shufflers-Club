// app/(main)/reset-password/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { FaLock, FaSpinner } from 'react-icons/fa';

const supabase = createClient();

type Stage = 'INIT' | 'VERIFYING' | 'READY' | 'ERROR' | 'DONE' | 'PKCE_MISSING';

function parseHashFragment(hash: string) {
  const s = hash?.startsWith('#') ? hash.slice(1) : hash || '';
  return Object.fromEntries(new URLSearchParams(s).entries());
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mounted, setMounted] = useState(false);
  const [stage, setStage] = useState<Stage>('INIT');
  const [error, setError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [updating, setUpdating] = useState(false);

  // PKCE フォールバック用（同ブラウザで再送）
  const [emailForResend, setEmailForResend] = useState('');
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);

  const codeFromQuery = useMemo(() => searchParams?.get('code') || '', [searchParams]);
  const tokenHashFromQuery = useMemo(() => searchParams?.get('token_hash') || '', [searchParams]);
  const typeFromQuery = useMemo(() => searchParams?.get('type') || '', [searchParams]);

  useEffect(() => { setMounted(true); }, []);

  // セッション確立: メールのリンクから遷移直後に 1 回だけ
  useEffect(() => {
    if (!mounted) return;

    const run = async () => {
      setStage('VERIFYING');
      setError(null);

      try {
        // 1) 旧方式: #access_token & #refresh_token（メール内ハッシュ）
        const hashObj = parseHashFragment(window.location.hash);
        if (hashObj.access_token && hashObj.refresh_token && hashObj.type === 'recovery') {
          const { data, error } = await supabase.auth.setSession({
            access_token: hashObj.access_token,
            refresh_token: hashObj.refresh_token,
          });
          if (error || !data.session) throw error ?? new Error('セッションの確立に失敗しました');
          setStage('READY');
          return;
        }

        // 2) token_hash + type=recovery（メールリンクの新方式その1）
        if ((tokenHashFromQuery || hashObj.token_hash) && (typeFromQuery === 'recovery' || hashObj.type === 'recovery')) {
          const token_hash = tokenHashFromQuery || hashObj.token_hash;
          const { data, error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash });
          if (error || !data.session) throw error ?? new Error('セッションの確立に失敗しました');
          setStage('READY');
          return;
        }

        // 3) code（PKCE：メールリンクの新方式その2）
        if (codeFromQuery) {
         // 73行 付近
const { error } = await supabase.auth.exchangeCodeForSession(codeFromQuery);

          if (error) {
            // PKCE の code_verifier が無い（別ブラウザ等）場合の既知エラー
            if (/code verifier|both auth code and code verifier/i.test(String(error.message))) {
              setStage('PKCE_MISSING');
              setError('このリンクは同じブラウザでリセット手続きを開始した場合のみ有効です。お手数ですが、ここから再送してください。');
              return;
            }
            throw error;
          }
          setStage('READY');
          return;
        }

        setError('無効または期限切れのリンクです。もう一度お試しください。');
        setStage('ERROR');
      } catch (e: any) {
        setError(e?.message || 'リンクの検証に失敗しました。');
        setStage('ERROR');
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, codeFromQuery, tokenHashFromQuery, typeFromQuery]);

  // パスワード更新
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stage !== 'READY') return;

    if (password.length < 6) {
      setError('パスワードは6文字以上で設定してください。');
      return;
    }
    if (password !== password2) {
      setError('パスワードが一致しません。');
      return;
    }

    setUpdating(true);
    setError(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setStage('DONE');
      setTimeout(() => router.replace('/login?reset=success'), 1200);
    } catch (e: any) {
      setError(e?.message || 'パスワード更新に失敗しました。');
    } finally {
      setUpdating(false);
    }
  };

  // PKCE フォールバック: 同ブラウザからリセットメール再送
  const resendResetMail = async (e: React.FormEvent) => {
    e.preventDefault();
    setResendMsg(null);
    setResending(true);
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const { error } = await supabase.auth.resetPasswordForEmail(emailForResend.trim(), {
        redirectTo: `${origin}/reset-password`,
      });
      if (error) throw error;
      setResendMsg('メールを送信しました。届いたリンクをこのブラウザで開いてください。');
    } catch (e: any) {
      setResendMsg(e?.message || 'メール送信に失敗しました。');
    } finally {
      setResending(false);
    }
  };

  // ---------- Render ----------
  if (!mounted || stage === 'INIT' || stage === 'VERIFYING') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass-card rounded-xl p-8 text-center">
          <FaSpinner className="mx-auto mb-3 animate-spin text-purple-400" />
          <p className="text-gray-300">リンクを検証しています...</p>
        </div>
      </div>
    );
  }

  if (stage === 'PKCE_MISSING') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass-card rounded-xl p-8 w-full max-w-md">
          <div className="text-center mb-4">
            <p className="text-red-400 font-medium mb-2">エラー</p>
            <p className="text-gray-300">{error}</p>
          </div>
          <form onSubmit={resendResetMail} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-2">メールアドレス</label>
              <input
                type="email"
                value={emailForResend}
                onChange={(e) => setEmailForResend(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-gray-800/50 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors"
                placeholder="example@email.com"
                required
              />
            </div>
            <button
              type="submit"
              disabled={resending}
              className="w-full gradient-button py-3 rounded-lg text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resending ? '送信中…' : 'このブラウザで開く用に再送する'}
            </button>
          </form>

          {resendMsg && (
            <p className="mt-4 text-sm text-center text-gray-300">{resendMsg}</p>
          )}

          <div className="mt-6 text-center">
            <a href="/login" className="text-purple-400 hover:text-purple-300">ログインへ戻る</a>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'ERROR') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass-card rounded-xl p-8 max-w-md text-center">
          <p className="text-red-400 font-medium mb-2">エラー</p>
          <p className="text-gray-300 mb-4">{error}</p>
          <a
            href="/login"
            className="inline-block px-5 py-2 rounded-lg border border-purple-500 text-purple-300 hover:bg-purple-500/10 transition-colors"
          >
            ログインへ戻る
          </a>
        </div>
      </div>
    );
  }

  if (stage === 'DONE') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass-card rounded-xl p-8 max-w-md text-center">
          <p className="text-green-400 font-medium mb-2">パスワードを更新しました！</p>
          <p className="text-gray-300">ログイン画面に移動します...</p>
        </div>
      </div>
    );
  }

  // stage === 'READY'
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="glass-card rounded-xl p-8 w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-block p-4 rounded-full bg-purple-600/20 mb-3">
            <FaLock className="text-3xl text-purple-400" />
          </div>
          <h1 className="text-2xl font-bold text-yellow-100">パスワード再設定</h1>
          <p className="text-gray-400 mt-2">新しいパスワードを入力してください</p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-2">新しいパスワード</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-gray-800/50 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors"
              placeholder="6文字以上"
              autoComplete="new-password"
              required
              minLength={6}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-2">新しいパスワード（確認）</label>
            <input
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-gray-800/50 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors"
              placeholder="もう一度入力"
              autoComplete="new-password"
              required
              minLength={6}
            />
          </div>

          <button
            type="submit"
            disabled={updating}
            className="w-full gradient-button py-3 rounded-lg text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updating ? '更新中…' : 'パスワードを更新'}
          </button>
        </form>
      </div>
    </div>
  );
}
