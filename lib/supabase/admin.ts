// lib/supabase/admin.ts
import 'server-only'; // クライアント側での誤インポートをビルド時に防止
import { createClient } from '@supabase/supabase-js';

/**
 * 目的：
 * - 既存の「Service Role を使う supabaseAdmin」を維持（機能は変えない）
 * - Next.js / 環境変数更新まわりで起きやすい “Invalid API key” の切り分けをしやすくする
 * - キーそのものはログに出さない（prefix/len のみ）
 *
 * NOTE:
 * - ここは “サーバ専用” で、RLS バイパス用（Service Role / Secret key）
 * - クライアントで使う anon/publishable とは別物
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();

// 互換維持：現在は SUPABASE_SERVICE_ROLE_KEY を使っている前提を維持しつつ、
// 将来 Supabase 側の表記が "Secret key" になった場合でも移行しやすいように候補を用意。
// （どちらも “サーバ専用キー” の位置付け。優先順位は現状の変数名を優先）
const SERVICE_ROLE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SECRET_KEY ?? // 互換用（あってもなくてもOK）
  ''
).trim();

// 追加の安全策：環境変数が未設定なら即時失敗（既存方針維持）
if (!SUPABASE_URL) {
  throw new Error('[supabaseAdmin] Missing env: NEXT_PUBLIC_SUPABASE_URL');
}
if (!SERVICE_ROLE_KEY) {
  throw new Error('[supabaseAdmin] Missing env: SUPABASE_SERVICE_ROLE_KEY');
}

// 追加の安全策：誤ってクライアント側から import された場合は実行を止める（既存方針維持）
if (typeof window !== 'undefined') {
  throw new Error('[supabaseAdmin] This module must not be imported in the browser.');
}

/** URL から project ref を抜く（https://xxxx.supabase.co -> xxxx） */
function getProjectRefFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.host || '';
    // cpfyaezsyvjjwpbuhewa.supabase.co
    const m = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** base64url decode（JWT 用） */
function b64urlDecode(input: string): string {
  const pad = '='.repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

function containsEllipsisLike(s: string) {
  // Supabase UI の省略表示やコピペ事故検知
  return s.includes('...') || s.includes('…');
}

/**
 * JWTっぽければ payload を読んで iss/ref を検査する。
 * sb_secret_ / sb_publishable_ は JWT 形式ではないため参照一致チェックはできない。
 */
function tryAssertProjectMatch(url: string, key: string) {
  const ref = getProjectRefFromUrl(url);

  // ① JWT 形式（ヘッダ.ペイロード.署名）なら中身を見れる
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payloadJson = b64urlDecode(parts[1]);
      const payload = JSON.parse(payloadJson) as any;

      const iss = typeof payload?.iss === 'string' ? payload.iss : '';
      const jwtRef =
        typeof payload?.ref === 'string'
          ? payload.ref
          : (iss.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? null);

      if (ref && jwtRef && ref !== jwtRef) {
        throw new Error(
          `[supabaseAdmin] Project mismatch: url_ref=${ref} jwt_ref=${jwtRef} (URLとKEYが別プロジェクトの可能性大)`
        );
      }
    } catch (e) {
      // JWT 解析に失敗しても値は壊さない（ただし原因のヒントになる）
      // 既存方針維持：warn のみ
      console.warn('[supabaseAdmin] JWT inspection failed:', (e as any)?.message ?? e);
    }
    return;
  }

  // ② sb_secret_ 等 JWTじゃない場合：ref 一致チェックは不可
  // ただし “改行/空白混入” “途中で切れている” “マスク文字列を貼った” は検知できる
  if (/\s/.test(key)) {
    throw new Error('[supabaseAdmin] Key contains whitespace/newlines. .env の改行混入の可能性があります。');
  }

  if (containsEllipsisLike(key)) {
    throw new Error(
      '[supabaseAdmin] Key looks masked (contains "..." or "…"). Supabase 画面の短縮表示を貼っている可能性があります。'
    );
  }

  // 目安：sb_secret_ は最近のUIでは 40文字台もあり得る（あなたのスクショがそれ）
  // ここでは “明らかに短すぎる” だけ弾く。41はOKにする。
  if (key.length < 30) {
    throw new Error('[supabaseAdmin] Key too short. 途中で切れている可能性があります。');
  }

  // sb_secret_ 以外（JWTは上で分岐済み）
  if (!(key.startsWith('sb_secret_') || key.startsWith('sb_sec_') || key.startsWith('sb_'))) {
    console.warn('[supabaseAdmin] Key format is unexpected (not sb_* or JWT). Check your env value.');
  }

  // ★ここが今回の最重要修正：
  // 以前は「sb_secret_ なら 80未満はエラー」にしていたが、新APIキーは40文字台もあるため誤爆する。
  // → “省略表示/空白/極端に短い” は上で弾いているので、ここではエラーにしない。
}

// 起動時に検査（値そのものは出さない）
tryAssertProjectMatch(SUPABASE_URL, SERVICE_ROLE_KEY);

// ログは “値そのものは出さない” を維持しつつ、切り分けに必要な情報だけ出す
console.log('[supabaseAdmin] env check', {
  url: SUPABASE_URL,
  url_host: (() => {
    try {
      return new URL(SUPABASE_URL).host;
    } catch {
      return null;
    }
  })(),
  url_ref: getProjectRefFromUrl(SUPABASE_URL),

  // 絶対に全文は出さない（prefix/len のみ）
  service_role_key_prefix: SERVICE_ROLE_KEY.slice(0, 10),
  service_role_key_len: SERVICE_ROLE_KEY.length,

  // 追加の “事故検知” 情報（キーは出さない）
  service_role_key_is_jwt: SERVICE_ROLE_KEY.split('.').length === 3,
  service_role_key_has_ws: /\s/.test(SERVICE_ROLE_KEY),
  service_role_key_has_mask: containsEllipsisLike(SERVICE_ROLE_KEY),
});

// サーバ専用クライアント（RLSバイパス: Service Role）
// ※ API Route / Server Action など「サーバ側」からのみ利用してください
export const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

// 変更防止（既存方針維持）
Object.freeze(supabaseAdmin);
