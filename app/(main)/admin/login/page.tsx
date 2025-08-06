// app/login/page.tsx

'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FaLock, FaArrowLeft } from 'react-icons/fa';

const supabase = createClient();

export default function LoginPage() {
  const [handleName, setHandleName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  // リダイレクト先を取得
  const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const redirectTo = searchParams.get('redirect') || null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // ハンドルネームからプレーヤー情報を取得
      const { data: player, error: playerError } = await supabase
        .from('players')
        .select('id, email, is_admin, is_active')
        .eq('handle_name', handleName)
        .single();

      if (playerError || !player) {
        throw new Error('ユーザーが見つかりません');
      }

      if (!player.is_active) {
        throw new Error('このアカウントは無効化されています');
      }

      // メールアドレスでログイン
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: player.email,
        password,
      });

      if (authError) throw new Error('パスワードが正しくありません');

      // ログイン成功後のリダイレクト
      if (redirectTo) {
        // リダイレクト先が指定されている場合
        router.push(redirectTo);
      } else if (player.is_admin) {
        // 管理者の場合は管理者ダッシュボードへ
        router.push('/admin/dashboard');
      } else {
        // 一般プレーヤーの場合は自分のプロフィールへ
        router.push(`/players/${player.id}`);
      }
    } catch (error: any) {
      setError(error.message || 'ログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
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
            <p className="text-gray-400 mt-2">ハンドルネームでログインしてください</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                ハンドルネーム
              </label>
              <input
                type="text"
                value={handleName}
                onChange={(e) => setHandleName(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors"
                placeholder="あなたのハンドルネーム"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                パスワード
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors"
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {loading ? 'ログイン中...' : 'ログイン'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-400 mb-2">まだアカウントをお持ちでない方</p>
            <Link
              href="/register"
              className="text-purple-400 hover:text-purple-300 transition-colors"
            >
              新規登録はこちら
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}