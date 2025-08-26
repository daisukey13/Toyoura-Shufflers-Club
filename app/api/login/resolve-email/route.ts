// app/api/login/resolve-email/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** このルートは
 *  1) Cloudflare Turnstile のトークンを検証
 *  2) players_private.phone から email を引く
 *  3) { email } を返す
 * を行います。
 *
 * 必要な .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...   // サーバ専用キー（絶対に公開しない）
 *   TURNSTILE_SECRET_KEY=...        // Turnstile のシークレット（本番は必須）
 */

// （POST なので不要だが、念のため動的扱い）
export const dynamic = 'force-dynamic';

const E164 = /^\+[1-9]\d{6,14}$/;

/** 日本の電話番号をE.164(+81...)へ正規化（簡易版） */
function normalizePhoneJP(input: string): string | null {
  if (!input) return null;
  let s = input.trim().normalize('NFKC');
  s = s.replace(/[^\d+]/g, ''); // 数字と+以外を除去
  if (!s) return null;

  if (s.startsWith('00')) s = '+' + s.slice(2); // 00 → +
  if (s.startsWith('+')) return E164.test(s) ? s : null;

  if (s.startsWith('81')) {
    const t = '+' + s;
    return E164.test(t) ? t : null;
  }
  if (/^0\d{9,10}$/.test(s)) {
    const t = '+81' + s.slice(1);
    return E164.test(t) ? t : null;
  }
  return null;
}

/** Turnstile を検証（開発で SECRET 未設定ならスキップ可） */
async function verifyTurnstile(token: string, remoteip?: string | null) {
  if (!token) return { ok: false, codes: ['missing-input-response'] as string[] };

  const secret = process.env.TURNSTILE_SECRET_KEY || '';
  if (!secret) {
    if (process.env.NODE_ENV !== 'production') {
      // 開発はスキップ（本番では必須）
      return { ok: true, codes: [], skipped: true };
    }
    return { ok: false, codes: ['missing-input-secret'] };
  }

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (remoteip) body.set('remoteip', remoteip);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });

  let json: any = {};
  try {
    json = await res.json();
  } catch {
    return { ok: false, codes: ['bad-request'] };
  }

  return { ok: !!json?.success, codes: (json?.['error-codes'] ?? []) as string[] };
}

/** Supabase(Service Role) クライアント（lazy・キャッシュ） */
let ADMIN: SupabaseClient | null = null;
function getAdmin() {
  if (ADMIN) return ADMIN;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE URL / SERVICE_ROLE_KEY are missing');
  }
  ADMIN = createClient(url, serviceKey, { auth: { persistSession: false } });
  return ADMIN;
}

/** 超簡易レート制限（同一IP+phoneに対して 10分で5回まで） */
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

export async function POST(req: NextRequest) {
  try {
    const { phone, token } = (await req.json()) as { phone?: string; token?: string };

    // クライアント IP（CF/Proxy 対応）
    const remoteip =
      req.headers.get('cf-connecting-ip') ||
      (req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() ||
      (req as any).ip ||
      null;

    // レート制限
    const rlKey = `${remoteip ?? ''}:${String(phone ?? '')}`;
    if (rateLimited(rlKey)) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // 入力チェック
    const normalized = normalizePhoneJP(String(phone ?? ''));
    if (!normalized) {
      return NextResponse.json({ error: 'invalid_phone', message: 'phone format invalid' }, { status: 400 });
    }

    // Turnstile 検証
    const v = await verifyTurnstile(String(token ?? ''), remoteip);
    if (!v.ok) {
      console.warn('[resolve-email] Turnstile failed', { codes: v.codes, remoteip });
      return NextResponse.json({ error: 'captcha_failed', codes: v.codes }, { status: 400 });
    }

    // Supabase(Service Role) で email を検索
    const admin = getAdmin();

    // 保存形式の差異に備えて候補を用意（E.164 / 0始まり / 記号無し など）
    const rawDigits = String(phone ?? '').replace(/[^\d+]/g, '');
    const zeroLeading =
      normalized.startsWith('+81') && normalized.length >= 4
        ? '0' + normalized.slice(3) // +81xxxxxxxxxx → 0xxxxxxxxxx
        : '';
    const candidates = Array.from(
      new Set([normalized, rawDigits, zeroLeading].filter(Boolean))
    ) as string[];

    // .or() で候補を横断検索（players_private.phone が存在する前提）
    const orExpr = candidates.map((p) => `phone.eq.${p}`).join(',');
    const { data, error } = await admin
      .from('players_private')
      .select('email, phone')
      .or(orExpr)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[resolve-email] Supabase error:', error.message);
      return NextResponse.json({ error: 'lookup_failed', message: 'failed to resolve email' }, { status: 500 });
    }
    if (!data?.email) {
      return NextResponse.json({ error: 'not_found', message: 'user not found' }, { status: 404 });
    }

    return NextResponse.json({ email: data.email });
  } catch (e: any) {
    // ENV 不備やクライアント生成失敗もここで拾う
    console.error('[resolve-email] Unexpected:', e?.message || e);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
