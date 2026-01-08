// lib/supabase/client.ts
'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * ✅ このアプリの Supabase Auth の storageKey は必ず統一する
 */
export const SUPABASE_AUTH_STORAGE_KEY = 'tsc-auth';

type SB = ReturnType<typeof createBrowserClient>;

declare global {
  // eslint-disable-next-line no-var
  var __supabase__: SB | undefined;
  // eslint-disable-next-line no-var
  var __supabase_auth_patched__: boolean | undefined;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if ((!SUPABASE_URL || !SUPABASE_ANON_KEY) && process.env.NODE_ENV !== 'production') {
  // ここで throw すると白画面になりやすいので警告のみ（ただし後で Proxy で明示エラーにする）
  // eslint-disable-next-line no-console
  console.error('[supabase] Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

function isInvalidRefreshTokenError(e: any) {
  const msg = String(e?.message || e || '');
  return (
    msg.includes('Invalid Refresh Token') ||
    msg.includes('Refresh Token Not Found') ||
    msg.includes('refresh_token') // 400系の文言を拾う保険
  );
}

/**
 * 端末内に残る古い Supabase auth の localStorage 残骸を掃除（storageKey 混在対策）
 * - keepKey を渡すと、そのキーだけ残して他を削除
 * - keepKey を渡さないと、該当パターンを全部削除
 */
function purgeAuthLocalStorage(keepKey?: string) {
  try {
    const ls = window.localStorage;
    const keys = Object.keys(ls);

    for (const k of keys) {
      const isSupabaseAuthLike =
        k === 'supabase.auth.token' ||
        k === 'supabase-auth-token' ||
        k.startsWith('sb-') && k.includes('-auth-token') || // sb-<ref>-auth-token 系
        k.includes('supabase') && k.includes('auth') && k.includes('token');

      if (!isSupabaseAuthLike) continue;
      if (keepKey && k === keepKey) continue;

      ls.removeItem(k);
    }
  } catch {
    // Safari / プライベート等で localStorage が死ぬ場合があるので無視
  }
}

/**
 * SSR/Node 側で createClient() が呼ばれても落とさないための Proxy。
 * - 「作るだけ」はOK
 * - サーバ側で実際に使おうとした瞬間に明示エラーにする
 */
function createServerProxyClient(): SB {
  const err = new Error(
    '[supabase] createClient() was called during SSR. ' +
      'This is expected in Next.js, but you must NOT use the returned client on the server. ' +
      'Use createServerSupabaseClient / createRouteHandlerSupabaseClient instead.'
  );

  return new Proxy(
    {},
    {
      get(_t, prop) {
        // React/Next が内部で触る可能性があるものは安全に返す
        if (prop === '__isSupabaseSSRProxy__') return true;
        if (prop === 'then') return undefined; // Promise 判定回避
        throw err;
      },
    }
  ) as SB;
}

/**
 * 無効な refresh token を検知したら、
 * - localStorage の残骸掃除
 * - signOut
 * で復旧できる状態に戻す（ログイン画面に戻すのは各ページ側の判定に任せる）
 */
function patchInvalidRefreshRecovery(sb: SB) {
  if (globalThis.__supabase_auth_patched__) return;
  globalThis.__supabase_auth_patched__ = true;

  const auth: any = sb.auth;

  const wrap = (fnName: 'getSession' | 'refreshSession') => {
    const orig = auth?.[fnName]?.bind(auth);
    if (!orig) return;

    auth[fnName] = async (...args: any[]) => {
      const res = await orig(...args);

      if (res?.error && isInvalidRefreshTokenError(res.error)) {
        try {
          // 「混在キー」は消す（keep しない）
          purgeAuthLocalStorage();
          await sb.auth.signOut();
        } catch {
          // ignore
        }
      }

      return res;
    };
  };

  wrap('getSession');
  wrap('refreshSession');
}

/**
 * ✅ アプリで使うブラウザ用 Supabase クライアント
 * - SSR で呼ばれても throw しない（Proxy を返す）
 * - ブラウザで初回だけ生成して singleton 化
 * - storageKey を tsc-auth に統一
 */
export function createClient(): SB {
  // ✅ Next.js は client component もSSRで一度評価されることがあるため、ここで throw しない
  if (typeof window === 'undefined') {
    return createServerProxyClient();
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // ブラウザでも env が無いなら Proxy（使った瞬間に分かる）
    return createServerProxyClient();
  }

  if (!globalThis.__supabase__) {
    // ✅ 混在源を掃除（tsc-auth 自体は残す）
    purgeAuthLocalStorage(SUPABASE_AUTH_STORAGE_KEY);

    globalThis.__supabase__ = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storageKey: SUPABASE_AUTH_STORAGE_KEY,
      },
    });

    patchInvalidRefreshRecovery(globalThis.__supabase__);
  }

  return globalThis.__supabase__!;
}
