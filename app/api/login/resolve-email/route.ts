import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY!;

// ざっくり E.164 バリデーション
function normalizePhone(input: string): string | null {
  let s = (input || '').trim();
  // 全角や空白・ハイフン除去
  s = s.replace(/[^\d+]/g, '');

  // 00 で始まる国際プレフィックス → +
  if (s.startsWith('00')) s = '+' + s.slice(2);

  // + で始まるならそのまま（桁数チェックのみ）
  if (s.startsWith('+')) {
    if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
    return null;
  }

  // 先頭 0 で 10〜11桁（日本想定）→ +81 に変換
  if (/^0\d{9,10}$/.test(s)) {
    return '+81' + s.slice(1);
  }

  // 国番号なし・8〜15桁 → とりあえず + を付ける（多国対応の簡易版）
  if (/^\d{8,15}$/.test(s)) {
    return '+' + s;
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const { phone, token } = await req.json();

    // 1) 入力チェック
    const normalized = normalizePhone(String(phone || ''));
    if (!normalized) {
      return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });
    }
    if (!TURNSTILE_SECRET) {
      return NextResponse.json({ error: 'server_misconfigured', message: 'TURNSTILE_SECRET_KEY missing' }, { status: 500 });
    }

    // 2) Turnstile 検証
    const ip =
      (req.headers.get('cf-connecting-ip') ||
        req.headers.get('x-forwarded-for') ||
        '').split(',')[0].trim();

    const body = new URLSearchParams({
      secret: TURNSTILE_SECRET,
      response: String(token || ''),
      ...(ip ? { remoteip: ip } : {}),
    });

    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      // 注意: Edge Runtime でもOK。Node.js runtimeなら issue 無し
    });

    const verifyJson = await verifyRes.json();
    if (!verifyJson?.success) {
      return NextResponse.json({ error: 'captcha_failed', detail: verifyJson }, { status: 403 });
    }

    // 3) 電話番号からメールを取得（Service Role で RLS を回避）
    const admin = createAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 保存形式ゆらぎ対策：そのまま / 正規化後 どちらでも一致を試す
    const { data, error } = await admin
      .from('players_private')
      .select('email')
      .or(`phone.eq.${normalized},phone.eq.${phone}`)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data?.email) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // 4) メール返却（クライアントで signInWithPassword に使用）
    return NextResponse.json({ email: data.email });
  } catch (e: any) {
    console.error('[resolve-email] error:', e?.message || e);
    return NextResponse.json({ error: 'server_error', message: String(e?.message || e) }, { status: 500 });
  }
}
