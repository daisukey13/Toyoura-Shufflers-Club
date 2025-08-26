'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { FaKey, FaArrowLeft, FaCheck } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

export default function UpdatePasswordPage() {
  const router = useRouter();
  const params = useSearchParams();
  const code = useMemo(() => params.get('code') || '', [params]);
  const redirectTo = useMemo(() => params.get('redirect') || '', [params]);

  const [stage, setStage] = useState<'checking' | 'ready' | 'done' | 'error'>('checking');
  const [error, setError] = useState<string | null>(null);

  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [loading, setLoading] = useState(false);

  // メールリンクの code をセッションに交換
  useEffect(() => {
    (async () => {
      try {
        if (!code) throw new Error('無効なリンクです（code がありません）。');
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        setStage('ready');
      } catch (e: any) {
        setError(String(e?.message || e));
        setStage('error');
      }
    })();
  }, [code]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 6) {
      setError('パスワードは6文字以上で設定してください。');
      return;
    }
    if (pw !== pw2) {
      setError('パスワードが一致しません。');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      setStage('done');
      // 少し待ってからログインへ
      setTimeout(() => {
        if (redirectTo) router.replace(`/login?redirect=${encodeURIComponent(redirectTo)}`);
        else router.replace('/login');
      }, 1200);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  if (stage === 'checking') {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-gray-300">リンクを確認しています...</div>
      </div>
    );
  }

  if (stage === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md glass-card rounded-xl p-8 text-center">
          <h1 className="text-2xl font-bold text-yellow-100 mb-2">リンクエラー</h1>
          <p className="text-red-400 mb-4">{error}</p>
          <Link href="/reset-password" className="text-purple-400 hover:text-purple-300">
            もう一度やり直す
          </Link>
        </div>
      </div>
    );
  }

  if (stage === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md glass-card rounded-xl p-8 text-center">
          <FaCheck className="text-4xl text-green-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-yellow-100 mb-2">パスワードを更新しました</h1>
          <p className="text-gray-300">ログインページへ移動します...</p>
        </div>
      </div>
    );
  }

  // stage === 'ready'
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 mb-8 transition-colors"
        >
          <FaArrowLeft /> ログインへ戻る
        </Link>

        <div className="glass-card rounded-xl p-8">
          <div className="text-center mb-8">
            <div className="inline-block p-4 rounded-full bg-purple-600/20 mb-4">
              <FaKey className="text-3xl text-purple-400" />
            </div>
            <h1 className="text-2xl font-bold text-yellow-100">新しいパスワードを設定</h1>
            <p className="text-gray-400 mt-2">新しいパスワードを入力してください。</p>
          </div>

          <form onSubmit={handleUpdate} className="space-y-6">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                新しいパスワード（6文字以上）
              </label>
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors"
                placeholder="••••••••"
                required
                autoComplete="new-password"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                新しいパスワード（確認）
              </label>
              <input
                type="password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors"
                placeholder="••••••••"
                required
                autoComplete="new-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {loading ? '更新中...' : 'パスワードを更新'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
