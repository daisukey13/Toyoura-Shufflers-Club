// app/api/login/resolve-email/route.ts
import { NextResponse, NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY || ''; // 開発では未設定可（検証スキップ）

// ───────────── 入力スキーマ ─────────────
const BodySchema = z.object({
  phone: z.string().min(3, 'phone is required'),
  token: z.string().optional(), // Turnstile トークン（開発では省略可）
});

// ───────────── ユーティリティ ─────────────

// ざっくり E.164 正規化（日本の 0 始まりは +81 に寄せる）
// 全角→半角やハイフン等の除去にも対応
function normalizePhone(input: string): string | null {
  let s = (input || '').trim().normalize('NFKC');
  // 数字と + 以外（空白・ハイフン等）を除去
  s = s.replace(/[^\d+]/g, '');

  // 00 → +
  if (s.startsWith('00')) s = '+' + s.slice(2);

  // + で始まる国際表記
  if (s.startsWith('+')) {
    return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
  }

  // 日本の 0 始まり（10〜11桁）→ +81（例：080xxxx → +8180xxxx）
  if (/^0\d{9,10}$/.test(s)) {
    return '+81' + s.slice(1);
  }

  // 国番号なし（8〜15桁）は暫定的に + を付与
  if (/^\d{8,15}$/.test(s)) {
    return '+' + s;
  }

  return null;
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    // @ts-ignore: 環境により undefined
    req.ip ||
    ''
  );
}

// ── 超簡易メモリレート制限（5分/20回・HMR越しに保持）
type Bucket = { count: number; resetAt: number };
const WINDOW_MS = 5 * 60 * 1000;
const LIMIT = 20;
const buckets: Map<string, Bucket> = (globalThis as any).__resolveBuckets ?? new Map();
(globalThis as any).__resolveBuckets = buckets;

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now > b.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (b.count >= LIMIT) return false;
  b.count++;
  return true;
}

// Turnstile 検証（SECRET 未設定ならスキップ）
async function verifyTurnstile(token: string | undefined, remoteip: string) {
  if (!TURNSTILE_SECRET) return { ok: true }; // 開発中は検証スキップ
  if (!token) return { ok: false, reason: 'missing' };

  const params = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token });
  if (remoteip) params.set('remoteip', remoteip);

  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!resp.ok) return { ok: false, reason: 'network' };

  const json: any = await resp.json();
  return json?.success ? { ok: true } : { ok: false, reason: 'invalid', data: json };
}

// ───────────── Handler ─────────────
export async function POST(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 });
    }

    // レート制限
    const ip = getClientIp(req);
    if (!rateLimit(ip)) {
      return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
    }

    // 入力
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_input', detail: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { phone, token } = parsed.data;

    // 電話番号正規化
    const normalized = normalizePhone(phone);
    if (!normalized) {
      return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });
    }

    // Turnstile 検証
    const captcha = await verifyTurnstile(token, ip);
    if (!captcha.ok) {
      return NextResponse.json({ error: 'captcha_failed', detail: captcha }, { status: 403 });
    }

    // Supabase (Service Role) でメールを引く
    const admin = createAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 正規化前後の候補で照合（+ を含む値も安全に扱えるよう .in(...) を使用）
    const candidates = Array.from(new Set([normalized, phone].filter(Boolean)));
    const { data, error } = await admin
      .from('players_private')
      .select('email')
      .in('phone', candidates as string[])
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data?.email) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // クライアントで signInWithPassword に使用
    return NextResponse.json({ email: data.email }, { status: 200 });
  } catch (e: any) {
    console.error('[resolve-email] error:', e?.message || e);
    return NextResponse.json(
      { error: 'server_error', message: String(e?.message || e) },
      { status: 500 }
    );
  }
}
