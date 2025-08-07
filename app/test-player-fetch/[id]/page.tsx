'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect } from 'react';

export default function TestPlayerPage() {
  const params = useParams();
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const testFetch = async () => {
      const playerId = params.id as string;
      setLog(prev => [...prev, `開始: Player ID = ${playerId}`]);
      
      try {
        // Fetch APIで直接アクセス
        const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/players?id=eq.${playerId}&select=*`;
        setLog(prev => [...prev, `URL: ${url}`]);
        
        const response = await fetch(url, {
          headers: {
            'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
            'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          }
        });
        
        setLog(prev => [...prev, `HTTPステータス: ${response.status}`]);
        
        if (response.ok) {
          const data = await response.json();
          setLog(prev => [...prev, `データ取得成功: ${JSON.stringify(data)}`]);
        } else {
          const error = await response.text();
          setLog(prev => [...prev, `エラー: ${error}`]);
        }
      } catch (error) {
        setLog(prev => [...prev, `例外エラー: ${error}`]);
      } finally {
        setLoading(false);
      }
    };
    
    testFetch();
  }, [params.id]);
  
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">プレーヤーテストページ</h1>
      <div className="glass-card rounded-xl p-4">
        <h2 className="text-lg font-bold mb-2">ログ:</h2>
        <div className="space-y-1 font-mono text-sm">
          {log.map((entry, i) => (
            <div key={i} className="text-gray-300">{entry}</div>
          ))}
        </div>
        {loading && <div className="mt-4">読み込み中...</div>}
      </div>
    </div>
  );
}