// app/test-simple/page.tsx

"use client";

import { useState } from "react";

export default function SimpleTestPage() {
  const [log, setLog] = useState<string[]>(["テスト開始..."]);
  const [testing, setTesting] = useState(false);

  const addLog = (message: string) => {
    setLog((prev) => [
      ...prev,
      `${new Date().toLocaleTimeString()}: ${message}`,
    ]);
  };

  const testSupabase = async () => {
    setTesting(true);
    setLog(["テスト開始..."]);

    try {
      // 1. 環境変数チェック
      addLog("環境変数を確認中...");
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!url || !key) {
        addLog("❌ 環境変数が設定されていません");
        return;
      }

      addLog(`✅ URL: ${url.substring(0, 30)}...`);
      addLog("✅ Key: 設定済み");

      // 2. fetch APIで直接アクセス
      addLog("fetch APIでSupabaseに接続中...");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        addLog("❌ 5秒でタイムアウトしました");
      }, 5000);

      try {
        const response = await fetch(`${url}/rest/v1/`, {
          method: "GET",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        addLog(`✅ HTTPステータス: ${response.status} ${response.statusText}`);

        // 3. playersテーブルに直接アクセス
        addLog("playersテーブルにアクセス中...");

        const playersResponse = await fetch(
          `${url}/rest/v1/players?select=id&limit=1`,
          {
            method: "GET",
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              Prefer: "count=none",
            },
          },
        );

        addLog(`✅ Players HTTPステータス: ${playersResponse.status}`);

        if (playersResponse.ok) {
          const data = await playersResponse.json();
          addLog(`✅ データ取得成功: ${JSON.stringify(data)}`);
        } else {
          const errorText = await playersResponse.text();
          addLog(`❌ エラーレスポンス: ${errorText}`);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error) {
          if (error.name === "AbortError") {
            addLog("❌ リクエストがタイムアウトしました");
          } else {
            addLog(`❌ エラー: ${error.message}`);
          }
        }
      }

      // 4. Supabase clientを使用（もし可能なら）
      try {
        addLog("Supabaseクライアントをインポート中...");
        const { supabase } = await import("@/lib/supabase");

        if (supabase) {
          addLog("✅ Supabaseクライアントが利用可能");

          addLog("クライアントでクエリ実行中...");
          const { data, error } = await supabase
            .from("players")
            .select("id")
            .limit(1);

          if (error) {
            addLog(`❌ クライアントエラー: ${error.message}`);
          } else {
            addLog(`✅ クライアント成功: ${JSON.stringify(data)}`);
          }
        }
      } catch (clientError) {
        addLog(`❌ クライアントエラー: ${clientError}`);
      }
    } catch (error) {
      addLog(`❌ 予期しないエラー: ${error}`);
    } finally {
      setTesting(false);
      addLog("テスト完了");
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-4 text-yellow-100">
        シンプルSupabaseテスト
      </h1>

      <button
        onClick={testSupabase}
        disabled={testing}
        className="mb-4 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg font-medium disabled:opacity-50"
      >
        {testing ? "テスト中..." : "テスト開始"}
      </button>

      <div className="glass-card rounded-xl p-4">
        <h2 className="text-lg font-bold mb-2 text-purple-300">ログ:</h2>
        <div className="space-y-1 font-mono text-sm">
          {log.map((entry, index) => (
            <div key={index} className="text-gray-300">
              {entry}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 text-sm text-gray-400">
        <p>このテストは基本的な接続性のみを確認します。</p>
        <p>タイムアウトは5秒に設定されています。</p>
      </div>
    </div>
  );
}
