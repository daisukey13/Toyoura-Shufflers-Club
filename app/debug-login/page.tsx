// app/debug-login/page.tsx

'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

export default function DebugLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [handleName, setHandleName] = useState('');
  const [message, setMessage] = useState('');

  // メールアドレスで直接ログイン
  const handleDirectLogin = async () => {
    setMessage('メールアドレスでログイン中...');
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setMessage(`エラー: ${error.message}`);
        return;
      }

      setMessage('ログイン成功！ユーザー情報を確認中...');

      // ユーザー情報を確認
      const { data: player } = await supabase
        .from('players')
        .select('*')
        .eq('id', data.user.id)
        .single();

      if (player) {
        setMessage(`
ログイン成功！
ユーザーID: ${data.user.id}
メール: ${data.user.email}
ハンドルネーム: ${player.handle_name}
管理者: ${player.is_admin ? 'はい' : 'いいえ'}
アクティブ: ${player.is_active ? 'はい' : 'いいえ'}
        `);
      } else {
        setMessage('playersテーブルにユーザー情報がありません');
      }
    } catch (error: any) {
      setMessage(`エラー: ${error.message}`);
    }
  };

  // ハンドルネームでユーザー検索
  const handleSearchByHandleName = async () => {
    setMessage('ハンドルネームで検索中...');
    try {
      const { data, error } = await supabase
        .from('players')
        .select('*')
        .eq('handle_name', handleName)
        .single();

      if (error) {
        setMessage(`エラー: ${error.message}`);
        return;
      }

      if (data) {
        setMessage(`
ユーザー情報:
ID: ${data.id}
ハンドルネーム: ${data.handle_name}
メール: ${data.email}
管理者: ${data.is_admin ? 'はい' : 'いいえ'}
アクティブ: ${data.is_active ? 'はい' : 'いいえ'}
        `);
      }
    } catch (error: any) {
      setMessage(`エラー: ${error.message}`);
    }
  };

  // 現在のユーザーを確認
  const checkCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setMessage(`
現在のユーザー:
ID: ${user.id}
メール: ${user.email}
      `);
    } else {
      setMessage('ログインしていません');
    }
  };

  // 管理者一覧を表示
  const showAdmins = async () => {
    setMessage('管理者を検索中...');
    try {
      const { data, error } = await supabase
        .from('players')
        .select('id, handle_name, email, is_admin, is_active')
        .eq('is_admin', true);

      if (error) {
        setMessage(`エラー: ${error.message}`);
        return;
      }

      if (data && data.length > 0) {
        const adminList = data.map(admin => 
          `ハンドルネーム: ${admin.handle_name}, メール: ${admin.email}, アクティブ: ${admin.is_active}`
        ).join('\n');
        setMessage(`管理者一覧:\n${adminList}`);
      } else {
        setMessage('管理者が見つかりません');
      }
    } catch (error: any) {
      setMessage(`エラー: ${error.message}`);
    }
  };

  return (
    <div className="min-h-screen p-8 bg-gray-900 text-white">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">デバッグ用ログイン</h1>
        
        {/* メールアドレスでログイン */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">メールアドレスで直接ログイン</h2>
          <div className="space-y-4">
            <input
              type="email"
              placeholder="メールアドレス"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-3 bg-gray-700 rounded"
            />
            <input
              type="password"
              placeholder="パスワード"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 bg-gray-700 rounded"
            />
            <button
              onClick={handleDirectLogin}
              className="w-full p-3 bg-blue-600 hover:bg-blue-700 rounded"
            >
              メールでログイン
            </button>
          </div>
        </div>

        {/* ハンドルネームで検索 */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">ハンドルネームでユーザー検索</h2>
          <div className="space-y-4">
            <input
              type="text"
              placeholder="ハンドルネーム"
              value={handleName}
              onChange={(e) => setHandleName(e.target.value)}
              className="w-full p-3 bg-gray-700 rounded"
            />
            <button
              onClick={handleSearchByHandleName}
              className="w-full p-3 bg-green-600 hover:bg-green-700 rounded"
            >
              ハンドルネームで検索
            </button>
          </div>
        </div>

        {/* その他の機能 */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">その他の機能</h2>
          <div className="space-y-4">
            <button
              onClick={checkCurrentUser}
              className="w-full p-3 bg-purple-600 hover:bg-purple-700 rounded"
            >
              現在のユーザーを確認
            </button>
            <button
              onClick={showAdmins}
              className="w-full p-3 bg-yellow-600 hover:bg-yellow-700 rounded"
            >
              管理者一覧を表示
            </button>
          </div>
        </div>

        {/* 結果表示 */}
        {message && (
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-bold mb-4">結果</h2>
            <pre className="whitespace-pre-wrap text-sm">{message}</pre>
          </div>
        )}
      </div>
    </div>
  );
}