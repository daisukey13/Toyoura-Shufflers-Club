// app/test-player-detail/page.tsx
'use client';

import { useState } from 'react';
import { useFetchPlayerDetail } from '@/lib/hooks/useFetchSupabaseData';

export default function TestPlayerDetailPage() {
  const [testPlayerId, setTestPlayerId] = useState('1'); // テスト用ID
  const { player, loading, error } = useFetchPlayerDetail(testPlayerId);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-4">プレーヤー詳細 Fetch APIテスト</h1>
      
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">
          テストするプレーヤーID:
        </label>
        <input
          type="text"
          value={testPlayerId}
          onChange={(e) => setTestPlayerId(e.target.value)}
          className="border rounded px-3 py-2 w-full max-w-xs"
          placeholder="プレーヤーIDを入力"
        />
      </div>

      <div className="bg-gray-100 p-4 rounded">
        <h2 className="font-semibold mb-2">デバッグ情報:</h2>
        <pre className="text-xs overflow-auto">
          {JSON.stringify({ 
            loading, 
            error, 
            player: player ? {
              id: player.id,
              name: player.name,
              matchHistoryCount: player.matchHistory?.length || 0
            } : null
          }, null, 2)}
        </pre>
      </div>

      {player && (
        <div className="mt-4 bg-white p-4 rounded shadow">
          <h2 className="font-semibold mb-2">取得したデータ:</h2>
          <pre className="text-xs overflow-auto">
            {JSON.stringify(player, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}