// app/auth/phone/route.ts
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin'; // Service Role クライアント（サーバ専用）

// Service Role / Node API を使うため Edge ではなく Node.js を明示
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  phone?: string;
  turnstileToken?: string;
};

/* ─────────────── Helpers ─────────────── */

const E164 = /^\+[1-9]\d{6,14}$/;

/** 日本の電話番号を E.164(+81...) へ正規化（簡易） */
function normalizePhoneJP(input?: string): string | null {
  if (!input) return null;
  let s = String(input).trim().normalize('NFKC');

  // 数字と + 以外を除去（ハイフン/空白など）
  s = s.replace(/[^\d+]/g, '');

  if (!s) return null;

  // 00 で始まる国際プレフィックス → +
  if (s.startsWith('00')) s = '+' + s.slice(2);

  // 既に + から始まる → 形式だけ検証
  if (s.startsWith('+')) return E164.test(s) ? s : null;

  // 先頭が 81... を "+81..." とみなす
  if (s.startsWith('81')) {
    const t = '+' + s;
    return E164.test(t) ? t : null;
  }

  // 0 で始まる国内形式（090/080/070 固定/市外局番等）→ +81 に
  if (/^0\d{9,10}$/.test(s)) {
    const t = '+81' + s.slice(1);
    return E164.test(t) ? t : null;
  }

  // それ以外は不正
  return null;
}

/** Turnstile 検証（開発で SECRET 未設定なら pass） */
async function verifyTurnstile(req: Request, token?: string) {
  // 開発時はキー未設定でもスキップ
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV !== 'production') {
      return { ok: true as const, skipped: true as const };
    }
    return { ok: false as const, reason: 'missing-secret' as const };
  }
  if (!token) return { ok: false as const, reason: 'missing-token' as const };

  // クライアントの推定 IP（CF/Vercel などの一般的ヘッダに対応）
  const ip =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    undefined;

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);

  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
    });
    const j: any = await r.json().catch(() => null);
    if (j?.success) return { ok: true as const };
    return { ok: false as const, reason: 'verify-failed' as const, codes: j?.['error-codes'] as string[] | undefined };
  } catch {
    return { ok: false as const, reason: 'network-error' as const };
  }
}

/* ─────────────── Handler ─────────────── */

export async function POST(req: Request) {
  try {
    // JSON 取得（HTML など誤アクセス時のガード）
    let body: Body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, message: 'Bad Request' }, { status: 400 });
    }

    const { phone, turnstileToken } = body;

    // 入力検証 & 正規化
    const normalized = normalizePhoneJP(phone);
    if (!normalized) {
      return NextResponse.json(
        { ok: false, message: '電話番号の形式が正しくありません（+81から始まる形式を推奨）。' },
        { status: 400 }
      );
    }

    // Turnstile（本番必須 / 開発は未設定ならスキップ）
    const tv = await verifyTurnstile(req, turnstileToken);
    if (!tv.ok) {
      // 具体的なメッセージを返す（運用トラブル時の手掛かりに）
      const msg =
        tv.reason === 'missing-secret'
          ? 'サーバ側の Turnstile シークレットが未設定です（管理者設定が必要）。'
          : tv.reason === 'missing-token'
          ? 'CAPTCHA トークンがありません。もう一度実施してください。'
          : tv.reason === 'network-error'
          ? 'Turnstile 検証に失敗しました（ネットワーク）。'
          : 'Turnstile 検証に失敗しました。';
      return NextResponse.json({ ok: false, message: msg, codes: (tv as any).codes }, { status: 400 });
    }

    // 必須な Supabase 環境変数チェック
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { ok: false, message: 'サーバ設定不備: Supabase 環境変数が未設定です。' },
        { status: 500 }
      );
    }

    // Supabase: SMS OTP 送信
    const { error } = await supabaseAdmin.auth.signInWithOtp({
      phone: normalized,
      options: { channel: 'sms' },
    });

    if (error) {
      const status = (error as any)?.status ?? 500;
      console.error('[auth/phone] signInWithOtp error:', { status, message: error.message });
      return NextResponse.json(
        { ok: false, message: status === 429 ? 'リクエストが多すぎます。しばらくしてから再試行してください。' : 'SMS の送信に失敗しました。時間をおいて再試行してください。' },
        { status: status === 429 ? 429 : 500 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    console.error('[auth/phone] fatal:', e?.message || e);
    return NextResponse.json({ ok: false, message: 'サーバエラーが発生しました。' }, { status: 500 });
  }
}
