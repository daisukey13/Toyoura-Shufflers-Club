'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { FaLock, FaSpinner } from 'react-icons/fa';

const supabase = createClient();

// ★ client.ts の storageKey が 'tsc-auth' なので、それに合わせる
const PKCE_VERIFIER_KEY = 'tsc-auth-code-verifier';

type Stage = 'INIT' | 'VERIFYING' | 'READY' | 'ERROR' | 'DONE';

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

  // URL からコード類を読む（必ず string になるようガード）
  const codeFromQuery = useMemo(() => {
    const val = searchParams?.get('code');
    return typeof val === 'string' ? val : '';
  }, [searchParams]);

  const tokenHashFromQuery = useMemo(() => {
    const val = searchParams?.get('token_hash');
    return typeof val === 'string' ? val : '';
  }, [searchParams]);

  const typeFromQuery = useMemo(() => {
    const val = searchParams?.get('type');
    return typeof val === 'string' ? val : '';
  }, [searchParams]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;

    (async () => {
      setStage('VERIFYING');
      setError(null);

      try {
        const hashObj = parseHashFragment(window.location.hash);
        const hasPkceVerifier =
          typeof window !== 'undefined' &&
          !!localStorage.getItem(PKCE_VERIFIER_KEY);

        // 1) 新方式（?code=...）かつ PKCE 検証子がローカルにある場合のみ交換
        if (codeFromQuery && hasPkceVerifier) {
          const { error } = await supabase.auth.exchangeCodeForSession({
            code: codeFromQuery, // ★ 文字列のみ渡す
          });
          if (error) throw error;
          setStage('READY');
          return;
        }

        // 2) token_hash + type=recovery（verifyOtp）
        if (
          (tokenHashFromQuery || hashObj.token_hash) &&
          (typeFromQuery === 'recovery' || hashObj.type === 'recovery')
        ) {
          const token_hash = tokenHashFromQuery || hashObj.token_hash;
          const { data, error } = await supabase.auth.verifyOtp({
            type: 'recovery',
            token_hash,
          });
          if (error || !data.session) throw error ?? new Error('セッション確立に失敗しました');
          setStage('READY');
          return;
        }

        // 3) 旧フラグメント方式（#access_token & #refresh_token & type=recovery）
        if (hashObj.access_token && hashObj.refresh_token && hashObj.type === 'recovery') {
          const { data, error } = await supabase.auth.setSession({
            access_token: hashObj.access_token,
            refresh_token: hashObj.refresh_token,
          });
          if (error || !data.session) throw error ?? new Error('セッション確立に失敗しました');
          setStage('READY');
          return;
        }

        // どれにも当てはまらない
        setError('無効または期限切れのリンクです。もう一度お試しください。');
        setStage('ERROR');
      } catch (e: any) {
        const msg = String(e?.message || e);
        // よくあるPKCE系の文言をユーザー向けに言い換え
        if (/both auth code and code verifier/i.test(msg)) {
          setError('このリンクの検証に必要な情報が見つかりませんでした。もう一度「パスワードを忘れた」からメールを送信し直してください。');
        } else if (/unmarshal.*auth_code.*string/i.test(msg)) {
          setError('リンクのパラメータが不正です。メールを再送して再度お試しください。');
        } else {
          setError(msg || 'リンクの検証に失敗しました。');
        }
        setStage('ERROR');
      }
    })();
  }, [mounted, codeFromQuery, tokenHashFromQuery, typeFromQuery]);

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

  // ----- UI -----
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

  if (stage === 'ERROR') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass-card rounded-xl p-8 max-w-md text-center">
          <p className="text-red-400 font-medium mb-2">エラー</p>
          <p className="text-gray-300 mb-4">{error}</p>
          <a
            href="/forgot-password"
            className="inline-block px-5 py-2 rounded-lg border border-purple-500 text-purple-300 hover:bg-purple-500/10 transition-colors"
          >
            もう一度メールを送る
          </a>
          <a
            href="/login"
            className="inline-block px-5 py-2 ml-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-600/10 transition-colors"
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
