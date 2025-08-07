// app/test-supabase/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function TestSupabasePage() {
  const [status, setStatus] = useState('初期化中...');
  const [details, setDetails] = useState({});
  const [testResults, setTestResults] = useState([]);

  useEffect(() => {
    runTests();
  }, []);

  const runTests = async () => {
    const results = [];
    
    // Test 1: Supabaseクライアントの確認
    try {
      setStatus('Test 1: Supabaseクライアントを確認中...');
      if (supabase) {
        results.push({ test: 'Supabaseクライアント', status: '✅ OK', details: 'クライアントが初期化されています' });
      } else {
        results.push({ test: 'Supabaseクライアント', status: '❌ NG', details: 'クライアントが未初期化' });
      }
    } catch (error) {
      results.push({ test: 'Supabaseクライアント', status: '❌ エラー', details: error instanceof Error ? error.message : String(error) });
    }

    // Test 2: 環境変数の確認
    try {
      setStatus('Test 2: 環境変数を確認中...');
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      
      results.push({ 
        test: '環境変数', 
        status: (supabaseUrl && supabaseAnonKey) ? '✅ OK' : '❌ NG',
        details: {
          url: supabaseUrl ? `設定済み (${supabaseUrl.substring(0, 30)}...)` : '未設定',
          anonKey: supabaseAnonKey ? '設定済み' : '未設定'
        }
      });
    } catch (error) {
      results.push({ test: '環境変数', status: '❌ エラー', details: error instanceof Error ? error.message : String(error) });
    }

    // Test 3: 簡単なクエリテスト
    try {
      setStatus('Test 3: データベース接続を確認中...');
      const { data, error } = await supabase
        .from('players')
        .select('id')
        .limit(1);
      
      if (error) {
        results.push({ test: 'データベース接続', status: '❌ NG', details: error.message });
      } else {
        results.push({ test: 'データベース接続', status: '✅ OK', details: 'クエリ成功' });
      }
    } catch (error) {
      results.push({ test: 'データベース接続', status: '❌ エラー', details: error instanceof Error ? error.message : String(error) });
    }

    // Test 4: ネットワーク状態
    try {
      setStatus('Test 4: ネットワーク状態を確認中...');
      results.push({ 
        test: 'ネットワーク', 
        status: navigator.onLine ? '✅ オンライン' : '❌ オフライン',
        details: {
          onLine: navigator.onLine,
          connection: (navigator as any).connection ? {
            effectiveType: (navigator as any).connection.effectiveType,
            downlink: (navigator as any).connection.downlink
          } : 'Connection API未対応'
        }
      });
    } catch (error) {
      results.push({ test: 'ネットワーク', status: '❌ エラー', details: error instanceof Error ? error.message : String(error) });
    }

    // Test 5: ユーザーエージェント
    setStatus('Test 5: ブラウザ情報を確認中...');
    results.push({ 
      test: 'ブラウザ情報', 
      status: '✅ 情報',
      details: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language
      }
    });

    setTestResults(results);
    setStatus('テスト完了');
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8 text-yellow-100">Supabase接続テスト</h1>
      
      <div className="glass-card rounded-xl p-6 mb-6">
        <h2 className="text-xl font-bold mb-4 text-purple-300">ステータス: {status}</h2>
      </div>

      <div className="space-y-4">
        {testResults.map((result, index) => (
          <div key={index} className="glass-card rounded-xl p-6 border border-purple-500/20">
            <div className="flex justify-between items-start mb-2">
              <h3 className="text-lg font-bold text-yellow-100">{result.test}</h3>
              <span className="text-sm">{result.status}</span>
            </div>
            <pre className="text-xs text-gray-400 overflow-x-auto">
              {typeof result.details === 'object' 
                ? JSON.stringify(result.details, null, 2)
                : result.details
              }
            </pre>
          </div>
        ))}
      </div>

      <div className="mt-8 flex gap-4">
        <button
          onClick={runTests}
          className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg font-medium hover:scale-105 transition-transform"
        >
          再テスト
        </button>
        
        <button
          onClick={() => window.location.href = '/rankings?debug=true'}
          className="px-6 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-lg font-medium hover:scale-105 transition-transform"
        >
          デバッグモードでランキングを開く
        </button>
      </div>
    </div>
  );
}