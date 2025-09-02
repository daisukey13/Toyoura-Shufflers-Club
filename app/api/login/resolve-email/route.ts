// app/api/login/resolve-email/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * 電話番号ログイン用：電話番号(+CAPTCHA) → email を返す API
 *
 * 必要な環境変数:
 *  - NEXT_PUBLIC_SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY  ← サーバ専用（クライアントに公開しない）
 *  - TURNSTILE_SECRET_KEY       ← 本番必須（開発では未設定でも pass）
 *
 * リクエスト(JSON):
 *  { "phone": string, "token": string }  // token = Turnstile の応答
 *
 * レスポンス(JSON):
 *  200: { "email": string }
 *  400: { "error": "invalid_phone" | "captcha_failed" | "bad_request" }
 *  404: { "error": "not_found" }
 *  429: { "error": "rate_limited" }
 *  500: { "error": "not_configured" | "server_error" }
 */

export const runtime = 'nodejs';        // Service Role を使うため Edge ではなく Node.js
export const dynamic = 'force-dynamic';

/* ─────────────── Helpers ─────────────── */

const E164 = /^\+[1-9]\d{6,14}$/;

/** 日本の電話番号を E.164(+81...) へ正規化（簡易） */
function normalizePhoneJP(input: string): string | null {
  if (!input) return null;
  let s = input.trim().normalize('NFKC').replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+')) return E164.test(s) ? s : null;
  if (s.startsWith('81')) return E164.test('+' + s) ? ('+' + s) : null;
  if (/^0\d{9,10}$/.test(s)) {
    const t = '+81' + s.slice(1);
    return E164.test(t) ? t : null;
  }
  return null;
}

/** Turnstile 検証（開発で SECRET 未設定なら pass） */
async function verifyTurnstile(token: string, remoteip?: string | null) {
  if (!token) return { ok: false, codes: ['missing-input-response'] as string[] };

  const secret = process.env.TURNSTILE_SECRET_KEY || '';
  if (!secret) {
    if (process.env.NODE_ENV !== 'production') {
      return { ok: true, codes: [], skipped: true };
    }
    return { ok: false, codes: ['missing-input-secret'] };
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteip) body.set('remoteip', remoteip);

    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const j = await r.json().catch(() => null);
    return { ok: !!j?.success, codes: (j?.['error-codes'] as string[]) ?? [] };
  } catch {
    return { ok: false, codes: ['network-error'] };
  }
}

/** Supabase(Service Role) クライアント（lazy キャッシュ） */
let ADMIN: SupabaseClient | null = null;
function getAdmin() {
  if (ADMIN) return ADMIN;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE URL / SERVICE_ROLE_KEY are missing');
  }
  ADMIN = createClient(url, key, { auth: { persistSession: false } });
  return ADMIN;
}

/** ごく簡易のレート制限（同一 IP × phone）：10 分で 5 回まで */
type RLKey = string;
const RL: Map<RLKey, { c: number; reset: number }> = new Map();
const RL_WINDOW = 10 * 60 * 1000;
const RL_LIMIT = 5;
function rateLimited(key: RLKey) {
  const now = Date.now();
  const rec = RL.get(key);
  if (!rec || now > rec.reset) {
    RL.set(key, { c: 1, reset: now + RL_WINDOW });
    return false;
  }
  if (rec.c >= RL_LIMIT) return true;
  rec.c++;
  return false;
}

/* ─────────────── Handlers ─────────────── */

export async function POST(req: NextRequest) {
  try {
    // JSON 取り出し（HTML を返さないため失敗時も JSON ）
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

    const phoneRaw = String(body.phone ?? '');
    const token = String(body.token ?? '');

    // クライアント IP（CF/Proxy 対応）
    const remoteip =
      req.headers.get('cf-connecting-ip') ||
      (req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() ||
      (req as any).ip ||
      null;

    // 低コスト先にレート制限
    const rlKey = `${remoteip ?? ''}:${phoneRaw}`;
    if (rateLimited(rlKey)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    // 入力チェック
    const e164 = normalizePhoneJP(phoneRaw);
    if (!e164) {
      return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });
    }

    // Turnstile
    const v = await verifyTurnstile(token, remoteip);
    if (!v.ok) {
      return NextResponse.json({ error: 'captcha_failed', codes: v.codes }, { status: 400 });
    }

    // Supabase(ADMIN) 検索
    const admin = getAdmin();

    // 保存形式差異に備えた候補（E.164 / 0始まり / 記号除去）
    const rawDigits = phoneRaw.replace(/[^\d+]/g, '');
    const zeroLeading = e164.startsWith('+81') ? '0' + e164.slice(3) : '';
    const candidates = Array.from(new Set([e164, rawDigits, zeroLeading].filter(Boolean))) as string[];

    const { data, error } = await admin
      .from('players_private')
      .select('email, phone')
      .in('phone', candidates)
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: 'not_configured', message: error.message }, { status: 500 });
    }
    if (!data?.email) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // 成功：クライアントは返した email でパスワードログインする
    return NextResponse.json({ email: data.email }, { status: 200 });
  } catch (e) {
    console.error('[resolve-email] unexpected:', e);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

/** 誤って GET した場合も HTML を返さず JSON を返す（Unexpected token '<' の回避） */
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'POST /api/login/resolve-email' });
}

/** CORS/プリフライトが必要な場合の簡易対応（同一オリジンなら不要） */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
