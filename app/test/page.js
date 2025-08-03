'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function TestPage() {
  const [status, setStatus] = useState('テスト開始...');
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    testSupabase();
  }, []);

  const testSupabase = async () => {
    try {
      // 1. 環境変数の確認
      setStatus('環境変数を確認中...');
      console.log('SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
      console.log('Has ANON_KEY:', !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

      // 2. Storageのファイルリストを取得
      setStatus('Storageからファイルリストを取得中...');
      const { data, error } = await supabase.storage
        .from('avatars')
        .list('preset', {
          limit: 10,
          offset: 0
        });

      if (error) {
        throw error;
      }

      console.log('取得したファイル:', data);
      setFiles(data || []);

      // 3. 公開URLの生成テスト
      if (data && data.length > 0) {
        const testFile = data[0];
        const { data: { publicUrl } } = supabase.storage
          .from('avatars')
          .getPublicUrl(`preset/${testFile.name}`);
        
        console.log('生成されたURL:', publicUrl);
        setStatus(`成功！ ${data.length}個のファイルが見つかりました。`);
      } else {
        setStatus('ファイルが見つかりませんでした。');
      }

    } catch (err) {
      console.error('エラー:', err);
      setError(err.message);
      setStatus('エラーが発生しました。');
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Supabase接続テスト</h1>
      
      <div className="mb-4">
        <p className="text-lg">ステータス: {status}</p>
        {error && (
          <p className="text-red-500">エラー: {error}</p>
        )}
      </div>

      <div className="mb-4">
        <h2 className="text-xl font-semibold mb-2">環境変数</h2>
        <pre className="bg-gray-100 p-2 rounded">
          {JSON.stringify({
            url: process.env.NEXT_PUBLIC_SUPABASE_URL || '未設定',
            hasKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
          }, null, 2)}
        </pre>
      </div>

      <div className="mb-4">
        <h2 className="text-xl font-semibold mb-2">ファイルリスト</h2>
        <ul className="list-disc list-inside">
          {files.map((file, index) => (
            <li key={index}>{file.name}</li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-2">画像プレビュー</h2>
        <div className="grid grid-cols-4 gap-4">
          {files.slice(0, 4).map((file, index) => {
            const { data: { publicUrl } } = supabase.storage
              .from('avatars')
              .getPublicUrl(`preset/${file.name}`);
            
            return (
              <div key={index} className="border p-2">
                <img 
                  src={publicUrl} 
                  alt={file.name}
                  className="w-full h-24 object-cover"
                  onError={(e) => {
                    console.error('画像エラー:', file.name, publicUrl);
                    e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="%23f00"/%3E%3C/svg%3E';
                  }}
                />
                <p className="text-xs mt-1">{file.name}</p>
              </div>
            );
          })}
        </div>
      </div>

      <button
        onClick={testSupabase}
        className="mt-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
      >
        再テスト
      </button>
    </div>
  );
}