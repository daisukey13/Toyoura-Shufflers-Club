// app/test-supabase/page.tsx

"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

interface TestResult {
  test: string;
  status: string;
  details: any;
}

export default function TestSupabasePage() {
  const [status, setStatus] = useState("初期化中...");
  const [testResults, setTestResults] = useState<TestResult[]>([]);

  useEffect(() => {
    runTests();
  }, []);

  const runTests = async () => {
    const results: TestResult[] = [];

    // Test 1: Supabaseクライアントの確認
    try {
      setStatus("Test 1: Supabaseクライアントを確認中...");
      if (supabase) {
        results.push({
          test: "Supabaseクライアント",
          status: "✅ OK",
          details: "クライアントが初期化されています",
        });
      } else {
        results.push({
          test: "Supabaseクライアント",
          status: "❌ NG",
          details: "クライアントが未初期化",
        });
      }
    } catch (error) {
      results.push({
        test: "Supabaseクライアント",
        status: "❌ エラー",
        details: error instanceof Error ? error.message : String(error),
      });
    }

    // Test 2: 環境変数の確認
    try {
      setStatus("Test 2: 環境変数を確認中...");
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      results.push({
        test: "環境変数",
        status: supabaseUrl && supabaseAnonKey ? "✅ OK" : "❌ NG",
        details: {
          url: supabaseUrl
            ? `設定済み (${supabaseUrl.substring(0, 30)}...)`
            : "未設定",
          anonKey: supabaseAnonKey ? "設定済み" : "未設定",
        },
      });
    } catch (error) {
      results.push({
        test: "環境変数",
        status: "❌ エラー",
        details: error instanceof Error ? error.message : String(error),
      });
    }

    // Test 3: 簡単なクエリテスト（シンプル版）
    try {
      setStatus("Test 3: データベース接続を確認中...");

      const startTime = Date.now();
      const { data, error } = await supabase
        .from("players")
        .select("id")
        .limit(1);
      const endTime = Date.now();

      if (error) {
        results.push({
          test: "データベース接続",
          status: "❌ NG",
          details: {
            message: error.message,
            code: error.code,
            hint: error.hint || "なし",
            responseTime: `${endTime - startTime}ms`,
          },
        });
      } else {
        results.push({
          test: "データベース接続",
          status: "✅ OK",
          details: {
            message: "クエリ成功",
            responseTime: `${endTime - startTime}ms`,
            dataReceived: data ? "あり" : "なし",
          },
        });
      }
    } catch (error) {
      results.push({
        test: "データベース接続",
        status: "❌ エラー",
        details: error instanceof Error ? error.message : String(error),
      });
    }

    // Test 4: ネットワーク状態
    try {
      setStatus("Test 4: ネットワーク状態を確認中...");
      results.push({
        test: "ネットワーク",
        status: navigator.onLine ? "✅ オンライン" : "❌ オフライン",
        details: {
          onLine: navigator.onLine,
          connection: (navigator as any).connection
            ? {
                effectiveType: (navigator as any).connection.effectiveType,
                downlink: (navigator as any).connection.downlink,
              }
            : "Connection API未対応",
        },
      });
    } catch (error) {
      results.push({
        test: "ネットワーク",
        status: "❌ エラー",
        details: error instanceof Error ? error.message : String(error),
      });
    }

    // Test 5: ユーザーエージェント
    setStatus("Test 5: ブラウザ情報を確認中...");
    results.push({
      test: "ブラウザ情報",
      status: "✅ 情報",
      details: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
      },
    });

    // Test 6: Supabase URLへの直接アクセステスト
    try {
      setStatus("Test 6: Supabase URLへの接続を確認中...");
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

      if (supabaseUrl) {
        const startTime = Date.now();

        try {
          // HEADリクエストではなくGETリクエストを使用
          const response = await fetch(`${supabaseUrl}/rest/v1/`, {
            method: "GET",
            headers: {
              apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
              "Content-Type": "application/json",
            },
          });
          const endTime = Date.now();

          results.push({
            test: "Supabase URL接続",
            status:
              response.ok || response.status === 404 ? "✅ 到達可能" : "❌ NG",
            details: {
              status: response.status,
              statusText: response.statusText,
              responseTime: `${endTime - startTime}ms`,
              url: supabaseUrl.substring(0, 30) + "...",
            },
          });
        } catch (fetchError) {
          results.push({
            test: "Supabase URL接続",
            status: "❌ エラー",
            details: {
              message:
                fetchError instanceof Error
                  ? fetchError.message
                  : String(fetchError),
              type: fetchError instanceof Error ? fetchError.name : "Unknown",
            },
          });
        }
      } else {
        results.push({
          test: "Supabase URL接続",
          status: "❌ 未設定",
          details: "NEXT_PUBLIC_SUPABASE_URLが設定されていません",
        });
      }
    } catch (error) {
      results.push({
        test: "Supabase URL接続",
        status: "❌ エラー",
        details: error instanceof Error ? error.message : String(error),
      });
    }

    setTestResults(results);
    setStatus("テスト完了");
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8 text-yellow-100">
        Supabase接続テスト
      </h1>

      <div className="glass-card rounded-xl p-6 mb-6">
        <h2 className="text-xl font-bold mb-4 text-purple-300">
          ステータス: {status}
        </h2>
      </div>

      <div className="space-y-4">
        {testResults.map((result, index) => (
          <div
            key={index}
            className="glass-card rounded-xl p-6 border border-purple-500/20"
          >
            <div className="flex justify-between items-start mb-2">
              <h3 className="text-lg font-bold text-yellow-100">
                {result.test}
              </h3>
              <span className="text-sm">{result.status}</span>
            </div>
            <pre className="text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap">
              {typeof result.details === "object"
                ? JSON.stringify(result.details, null, 2)
                : result.details}
            </pre>
          </div>
        ))}
      </div>

      <div className="mt-8 flex gap-4 flex-wrap">
        <button
          onClick={runTests}
          className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg font-medium hover:scale-105 transition-transform"
        >
          再テスト
        </button>

        <button
          onClick={() => (window.location.href = "/rankings?debug=true")}
          className="px-6 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-lg font-medium hover:scale-105 transition-transform"
        >
          デバッグモードでランキングを開く
        </button>

        <button
          onClick={() => (window.location.href = "/")}
          className="px-6 py-3 bg-gradient-to-r from-gray-600 to-gray-700 text-white rounded-lg font-medium hover:scale-105 transition-transform"
        >
          トップページへ
        </button>
      </div>

      {/* デバッグ情報 */}
      <div className="mt-8 glass-card rounded-xl p-6 border border-yellow-500/20">
        <h3 className="text-lg font-bold text-yellow-100 mb-2">
          トラブルシューティング
        </h3>
        <ul className="text-sm text-gray-400 space-y-2">
          <li>
            •
            データベース接続で「タイムアウト」が表示される場合、ネットワークの問題の可能性があります
          </li>
          <li>• 「❌ NG」が表示される場合、エラーの詳細を確認してください</li>
          <li>
            • すべてのテストが「✅
            OK」でも問題が続く場合、キャッシュをクリアしてみてください
          </li>
          <li>• プライベートブラウジングモードをOFFにしてみてください</li>
        </ul>
      </div>
    </div>
  );
}
