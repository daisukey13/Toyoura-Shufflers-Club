// lib/config/env.ts
// 環境変数の型安全な管理

const getEnvVar = (key: string): string => {
  if (typeof window !== 'undefined') {
    // クライアントサイド
    const value = process.env[key];
    if (!value) {
      console.warn(`Missing environment variable: ${key}`);
      return '';
    }
    return value;
  } else {
    // サーバーサイド
    const value = process.env[key];
    if (!value) {
      throw new Error(`Missing environment variable: ${key}`);
    }
    return value;
  }
};

export const ENV = {
  SUPABASE_URL: getEnvVar('NEXT_PUBLIC_SUPABASE_URL'),
  SUPABASE_ANON_KEY: getEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
} as const;

export type EnvConfig = typeof ENV;
