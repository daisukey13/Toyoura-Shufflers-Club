// app/reset-password/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

const supabase = createClient();

export default function ResetPasswordPage() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // URLにアクセストークンがある場合の処理
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = hashParams.get('access_token');
    
    if (accessToken) {
      setMessage('パスワードリセットの準備ができました。新しいパスワードを設定してください。');
    }
  }, []);

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      setMessage('パスワードが一致しません');
      return;
    }

    if (newPassword.length < 6) {
      setMessage('パスワードは6文字以上で設定してください');
      return;
    }

    setLoading(true);
    
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) {
        setMessage(`エラー: ${error.message}`);
      } else {
        setMessage('パスワードが正常に更新されました！');
        setTimeout(() => {
          router.push('/login');
        }, 2000);
      }
    } catch (error: any) {
      setMessage(`エラー: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const sendResetEmail = async () => {
    const email = 'daisukeyud@gmail.com';
    setMessage('リセットメールを送信中...');
    
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        setMessage(`エラー: ${error.message}`);
      } else {
        setMessage(`${email} にパスワードリセットメールを送信しました。メールを確認してください。`);
      }
    } catch (error: any) {
      setMessage(`エラー: ${error.message}`);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50 py-12 px-4">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="text-center text-3xl font-extrabold text-gray-900">
            パスワードリセット
          </h2>
        </div>

        {message && (
          <div className={`rounded-md p-4 ${
            message.includes('エラー') 
              ? 'bg-red-50 text-red-800' 
              : 'bg-green-50 text-green-800'
          }`}>
            <p className="text-sm font-medium">{message}</p>
          </div>
        )}

        {/* パスワードリセットフォーム */}
        <form className="mt-8 space-y-6" onSubmit={handlePasswordReset}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="new-password" className="sr-only">
                新しいパスワード
              </label>
              <input
                id="new-password"
                name="new-password"
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder="新しいパスワード"
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className="sr-only">
                パスワード確認
              </label>
              <input
                id="confirm-password"
                name="confirm-password"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder="パスワード確認"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {loading ? '更新中...' : 'パスワードを更新'}
            </button>
          </div>
        </form>

        {/* リセットメール送信ボタン */}
        <div className="text-center">
          <p className="text-sm text-gray-600 mb-4">
            まだリセットメールを受け取っていない場合：
          </p>
          <button
            onClick={sendResetEmail}
            className="text-blue-600 hover:text-blue-500 font-medium"
          >
            パスワードリセットメールを送信
          </button>
        </div>
      </div>
    </div>
  );
}