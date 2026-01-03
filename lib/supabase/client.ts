'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * ✅ ここが今回の肝：
 * createBrowserClient のジェネリクス未指定だと環境によって `never` 系の型推論になり、
 * .from('players').update(...) が `update(values: never)` になってビルド落ちします。
 *
 * Database 型が既にあるなら any の代わりに差し替えてください。
 */
// import type { Database as DB } from '@/types/supabase';
// type Database = DB;
type Database = any;

// HMR / チャンク跨ぎでもインスタンスを 1 つに固定
type SB = ReturnType<(typeof createBrowserClient)<Database>>;

declare global {
  // eslint-disable-next-line no-var
  var __supabase__: SB | undefined;
  // eslint-disable-next-line no-var
  var __supabase_auth_patched__: boolean | undefined;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * storageKey は「このアプリだけ」で統一してください。
 * もし他の場所で createClient(url, anon) 等を使っていると、
 * 互いに別キーになって refresh token の競合が起きやすいです。
 */
const STORAGE_KEY = 'tsc-auth';

if (!url || !anon) {
  // ここで throw すると本番で白画面になるため、開発時のみ警告
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error(
      '[supabase] Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY'
    );
  }
}

/** エラー判定 */
function isInvalidRefreshToken(err: any) {
  const msg = String(err?.message ?? err ?? '');
  return /Invalid Refresh Token/i.test(msg) || /Already Used/i.test(msg);
}

/** 未ログイン（セッション無し）判定：コンソールを汚さないために握る */
function isAuthSessionMissing(err: any) {
  const name = String(err?.name ?? '');
  const msg = String(err?.message ?? err ?? '');
  return name === 'AuthSessionMissingError' || /Auth session missing/i.test(msg);
}

/** 競合/残骸からの復旧（= いったんログアウト扱いにして正常系へ戻す） */
async function recoverAuth(client: any) {
  try {
    // localStorage を使っている構成の場合に備えて掃除（cookie 構成でも害はない）
    try {
      if (typeof window !== 'undefined') {
        window.localStorage?.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore
    }

    // サーバ/クライアント双方の状態を「未ログイン」に寄せる
    await client.auth.signOut();
  } catch {
    // ignore
  }
}

const _client: SB =
  globalThis.__supabase__ ??
  createBrowserClient<Database>(url!, anon!, {
    auth: {
      storageKey: STORAGE_KEY, // ✅ このアプリで統一
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      headers: {
        'x-client-info': 'tsc-web',
      },
    },
  });

if (typeof window !== 'undefined') {
  globalThis.__supabase__ = _client;

  // auth メソッドを 1 回だけパッチ（Invalid Refresh Token を握りつぶして復旧）
  if (!globalThis.__supabase_auth_patched__) {
    globalThis.__supabase_auth_patched__ = true;

    const auth: any = (_client as any).auth;

    // getSession パッチ
    const origGetSession = auth.getSession.bind(auth);
    auth.getSession = async (...args: any[]) => {
      try {
        const res = await origGetSession(...args);

        // ✅ 未ログインは正常扱い
        if (res?.error && isAuthSessionMissing(res.error)) {
          return { data: { session: null }, error: null };
        }

        if (res?.error && isInvalidRefreshToken(res.error)) {
          await recoverAuth(_client as any);
          return { data: { session: null }, error: null };
        }
        return res;
      } catch (e: any) {
        // ✅ 未ログインは正常扱い
        if (isAuthSessionMissing(e)) {
          return { data: { session: null }, error: null };
        }

        if (isInvalidRefreshToken(e)) {
          await recoverAuth(_client as any);
          return { data: { session: null }, error: null };
        }
        throw e;
      }
    };

    // getUser パッチ（内部で refresh が走ることがあるため同様に）
    const origGetUser = auth.getUser.bind(auth);
    auth.getUser = async (...args: any[]) => {
      try {
        const res = await origGetUser(...args);

        // ✅ 未ログインは正常扱い
        if (res?.error && isAuthSessionMissing(res.error)) {
          return { data: { user: null }, error: null };
        }

        if (res?.error && isInvalidRefreshToken(res.error)) {
          await recoverAuth(_client as any);
          return { data: { user: null }, error: null };
        }
        return res;
      } catch (e: any) {
        // ✅ 未ログインは正常扱い
        if (isAuthSessionMissing(e)) {
          return { data: { user: null }, error: null };
        }

        if (isInvalidRefreshToken(e)) {
          await recoverAuth(_client as any);
          return { data: { user: null }, error: null };
        }
        throw e;
      }
    };

    // 起動直後に一度だけセッションを触って、残骸があれば即復旧（overlay 対策）
    void (async () => {
      const { error } = await auth.getSession();
      if (error && isInvalidRefreshToken(error)) {
        await recoverAuth(_client as any);
      }
    })();
  }
}

/** 推奨：各所で呼び出して同一インスタンスを得る */
export const createClient = () => _client;

/** 互換輸出：直接使いたい場合はこちらを import */
export { _client as supabase };
