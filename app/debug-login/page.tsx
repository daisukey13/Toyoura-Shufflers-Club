// app/debug-login/page.tsx
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

type PlayerRow = {
  id: string;
  handle_name: string;
  email?: string | null;
  is_admin?: boolean | null;
  is_active?: boolean | null;
};

export default function DebugLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [handleName, setHandleName] = useState('');
  const [message, setMessage] = useState('');

  // メールアドレスで直接ログイン
  const handleDirectLogin = async () => {
    setMessage('メールアドレスでログイン中...');
    try {
      const { data: signInData, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setMessage(`エラー: ${error.message}`);
        return;
      }

      const user = signInData?.user;
      if (!user) {
        setMessage('ログイン結果: ユーザー情報が取得できませんでした。');
        return;
      }

      setMessage('ログイン成功！ユーザー情報を確認中...');

      // players テーブルの該当行を取得
      const { data: playerData, error: pErr } = await supabase
        .from('players')
        .select('id, handle_name, email, is_admin, is_active')
        .eq('id', user.id)
        .maybeSingle();

      if (pErr) {
        setMessage(`players 取得エラー: ${pErr.message}`);
        return;
      }

      const player = (playerData ?? null) as PlayerRow | null;

      if (player) {
        setMessage(
          [
            'ログイン成功！',
            `ユーザーID: ${user.id}`,
            `メール: ${user.email ?? '(不明)'}`,
            `ハンドルネーム: ${player.handle_name}`,
            `管理者: ${player.is_admin ? 'はい' : 'いいえ'}`,
            `アクティブ: ${player.is_active ? 'はい' : 'いいえ'}`,
          ].join('\n')
        );
      } else {
        setMessage(
          [
            'ログイン成功！',
            'playersテーブルにユーザー情報がありません',
            `ユーザーID: ${user.id}`,
            `メール: ${user.email ?? '(不明)'}`
          ].join('\n')
        );
      }
    } catch (err: any) {
      setMessage(`エラー: ${err?.message ?? String(err)}`);
    }
  };

  // ハンドルネームでユーザー検索
  const handleSearchByHandleName = async () => {
    setMessage('ハンドルネームで検索中...');
    try {
      const { data, error } = await supabase
        .from('players')
        .select('id, handle_name, email, is_admin, is_active')
        .eq('handle_name', handleName)
        .maybeSingle();

      if (error) {
        setMessage(`エラー: ${error.message}`);
        return;
      }

      const row = (data ?? null) as PlayerRow | null;

      if (!row) {
        setMessage('該当ユーザーが見つかりませんでした');
        return;
      }

      setMessage(
        [
          'ユーザー情報:',
          `ID: ${row.id}`,
          `ハンドルネーム: ${row.handle_name}`,
          `メール: ${row.email ?? '(未登録)'}`,
          `管理者: ${row.is_admin ? 'はい' : 'いいえ'}`,
          `アクティブ: ${row.is_active ? 'はい' : 'いいえ'}`,
        ].join('\n')
      );
    } catch (err: any) {
      setMessage(`エラー: ${err?.message ?? String(err)}`);
    }
  };

  // 現在のユーザーを確認
  const checkCurrentUser = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setMessage(
          ['現在のユーザー:', `ID: ${user.id}`, `メール: ${user.email ?? '(不明)'}`].join(
            '\n'
          )
        );
      } else {
        setMessage('ログインしていません');
      }
    } catch (err: any) {
      setMessage(`エラー: ${err?.message ?? String(err)}`);
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

      const admins = (data ?? []) as PlayerRow[];
      if (admins.length > 0) {
        const adminList = admins
          .map(
            (admin) =>
              `ハンドルネーム: ${admin.handle_name}, メール: ${admin.email ?? '(未登録)'}, アクティブ: ${admin.is_active ? 'はい' : 'いいえ'}`
          )
          .join('\n');
        setMessage(`管理者一覧:\n${adminList}`);
      } else {
        setMessage('管理者が見つかりません');
      }
    } catch (err: any) {
      setMessage(`エラー: ${err?.message ?? String(err)}`);
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
