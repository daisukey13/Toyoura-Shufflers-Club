// types/global.d.ts
// グローバル型定義

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NEXT_PUBLIC_SUPABASE_URL: string;
      NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
      NODE_ENV: "development" | "production" | "test";
    }
  }
}

// TypeScriptがこのファイルをモジュールとして認識するため
export {};
