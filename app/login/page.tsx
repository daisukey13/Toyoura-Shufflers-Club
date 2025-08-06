'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { FiUser, FiLock, FiAlertCircle } from 'react-icons/fi'
import { useAuth } from '@/contexts/AuthContext'

export default function LoginPage() {
  const router = useRouter()
  const [handleName, setHandleName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { refreshAuth } = useAuth()

  // リダイレクト先を取得
  const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const redirectTo = searchParams.get('redirect') || null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()

    try {
      // ハンドルネームからプレーヤー情報を取得
      const { data: player, error: playerError } = await supabase
        .from('players')
        .select('id, email, is_admin, is_active')
        .eq('handle_name', handleName)
        .single();

      if (playerError || !player) {
        setError('ユーザーが見つかりません')
        setLoading(false)
        return
      }

      if (!player.is_active) {
        setError('このアカウントは無効化されています')
        setLoading(false)
        return
      }

      // メールアドレスでログイン
      const { data, error } = await supabase.auth.signInWithPassword({
        email: player.email,
        password,
      })

      if (error) {
        console.error('Login error:', error)
        
        // エラーメッセージの詳細表示
        if (error.message === 'Invalid login credentials') {
          setError('パスワードが間違っています')
        } else if (error.message === 'Email not confirmed') {
          setError('メールアドレスの確認が必要です')
        } else if (error.message.includes('Email link is invalid')) {
          setError('メール認証リンクが無効です。再度登録してください。')
        } else {
          setError(`ログインエラー: ${error.message}`)
        }
      } else {
        // 認証情報を更新
        await refreshAuth()
        
        // ログイン成功後のリダイレクト
        if (redirectTo) {
          router.push(redirectTo);
        } else if (player.is_admin) {
          router.push('/admin/dashboard');
        } else {
          router.push(`/players/${player.id}`);
        }
      }
    } catch (err) {
      console.error('Unexpected error:', err)
      setError('ログインに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="mx-auto h-12 w-12 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">
            S
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            アカウントにログイン
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            または{' '}
            <Link href="/register" className="font-medium text-blue-600 hover:text-blue-500">
              新規アカウントを作成
            </Link>
          </p>
        </div>
        
        <form className="mt-8 space-y-6" onSubmit={handleLogin} method="POST">
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <FiAlertCircle className="h-5 w-5 text-red-400" />
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-red-800">{error}</p>
                </div>
              </div>
            </div>
          )}
          
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="handleName" className="sr-only">
                ハンドルネーム
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <FiUser className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="handleName"
                  name="handleName"
                  type="text"
                  autoComplete="username"
                  required
                  value={handleName}
                  onChange={(e) => setHandleName(e.target.value)}
                  className="appearance-none rounded-none relative block w-full px-3 py-2 pl-10 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder="ハンドルネーム"
                />
              </div>
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                パスワード
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <FiLock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none rounded-none relative block w-full px-3 py-2 pl-10 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder="パスワード"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <input
                id="remember-me"
                name="remember-me"
                type="checkbox"
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-900">
                ログイン状態を保持
              </label>
            </div>

            <div className="text-sm">
              <a href="#" className="font-medium text-blue-600 hover:text-blue-500">
                パスワードを忘れた方
              </a>
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'ログイン中...' : 'ログイン'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}