// app/api/login/resolve-email/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * 電話番号ログイン用：電話番号(+CAPTCHA) → email を返す API
 *
 * 前提:
 *  - Supabase に players_private テーブルがあり、少なくとも { email, phone } を保持
 *  - phone は E.164(+81...) を推奨だが、0 始まり/記号無しでも検索できるよう候補を用意
 *
 * 必要な環境変数 (.env.local など):
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...   // サーバ専用キー（クライアントに絶対出さない）
 *   TURNSTILE_SECRET_KEY=...        // 本番必須。開発で未設定なら検証をスキップ
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Service Role を使うので Edge ではなく Node.js で実行

const E164 = /^\+[1-9]\d{6,14}$/;

/** 日本の電話番号を E.164(+81...) へ正規化（簡易） */
function normalizePhoneJP(input: string): string | null {
  if (!input) return null;
  let s = input.trim().normalize('NFKC').replace(/[^\d+]/g, '');
  if (!s) return null;

  // 00 → +
  if (s.startsWith('00')) s = '+' + s.slice(2);

  if (s.startsWith('+')) return E164.test(s) ? s : null;

  // "81...." を "+81..." とみなす
  if (s.startsWith('81')) {
    const t = '+' + s;
    return E164.test(t) ? t : null;
  }

  // 0 で始まる国内形式 → +81
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

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (remoteip) body.set('remoteip', remoteip);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });

  try {
    const json = await res.json();
    return { ok: !!json?.success, codes: (json?.['error-codes'] ?? []) as string[] };
  } catch {
    return { ok: false, codes: ['bad-request'] };
  }
}

/** Supabase(Service Role) クライアント（lazy キャッシュ） */
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

export async function POST(req: NextRequest) {
  try {
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }

    const phoneRaw = String(body?.phone ?? '');
    const token = String(body?.token ?? '');

    // クライアント IP（CF/Proxy 対応）
    const remoteip =
      req.headers.get('cf-connecting-ip') ||
      (req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() ||
      (req as any).ip ||
      null;

    // 低コスト先にレート制限
    const rlKey = `${remoteip ?? ''}:${phoneRaw}`;
    if (rateLimited(rlKey)) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // 入力チェック
    const e164 = normalizePhoneJP(phoneRaw);
    if (!e164) {
      return NextResponse.json({ error: 'invalid_phone', message: 'phone format invalid' }, { status: 400 });
    }

    // Turnstile
    const v = await verifyTurnstile(token, remoteip);
    if (!v.ok) {
      return NextResponse.json({ error: 'captcha_failed', codes: v.codes }, { status: 400 });
    }

    // Supabase(ADMIN) 検索
    const admin = getAdmin();

    // 保存形式の差異に備えた候補（E.164 / 0 始まり / 記号除去）
    const rawDigits = phoneRaw.replace(/[^\d+]/g, '');
    const zeroLeading = e164.startsWith('+81') ? '0' + e164.slice(3) : '';
    const candidates = Array.from(new Set([e164, rawDigits, zeroLeading].filter(Boolean))) as string[];

    // players_private(phone) で照合（候補を IN で横断）
    const { data, error } = await admin
      .from('players_private')
      .select('email, phone')
      .in('phone', candidates)
      .limit(1)
      .maybeSingle();

    if (error) {
      // テーブル/カラム未整備など
      return NextResponse.json(
        { error: 'not_configured', message: error.message },
        { status: 500 }
      );
    }

    if (!data?.email) {
      return NextResponse.json({ error: 'not_found', message: 'user not found' }, { status: 404 });
    }

    return NextResponse.json({ email: data.email });
  } catch (e: any) {
    console.error('[resolve-email] Unexpected:', e?.message || e);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
