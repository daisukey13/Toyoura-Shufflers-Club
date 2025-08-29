import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// 例: profiles または players に { phone, email } がある想定
const CANDIDATE_TABLES = ['profiles', 'players'] as const;

function normalizeE164Like(input: string) {
  let s = (input || '').trim().normalize('NFKC').replace(/[^\d+]/g, '');
  if (!s) return s;
  if (s.startsWith('+')) return s;
  if (s.startsWith('00')) return '+' + s.slice(2);
  if (/^0\d{9,10}$/.test(s)) return '+81' + s.slice(1); // 日本想定
  return s;
}

export async function POST(req: Request) {
  try {
    const { phone, token } = await req.json();

    if (!phone || typeof phone !== 'string') {
      return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });
    }
    if (!process.env.TURNSTILE_SECRET_KEY) {
      // 開発時は CAPTCHA 無しで通すならここで分岐可
      // return NextResponse.json({ error: 'captcha_required' }, { status: 400 });
    } else {
      // Turnstile 検証
      const form = new FormData();
      form.append('secret', process.env.TURNSTILE_SECRET_KEY);
      form.append('response', token || '');
      const ver = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body: form });
      const data = await ver.json();
      if (!data?.success) {
        return NextResponse.json({ error: 'captcha_failed' }, { status: 400 });
      }
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! // Server-Only!
    );

    const target = normalizeE164Like(phone);
    let email: string | null = null;

    for (const table of CANDIDATE_TABLES) {
      const { data, error } = await admin
        .from(table)
        .select('email')
        .eq('phone', target)
        .maybeSingle();

      if (error) continue;
      if (data?.email) {
        email = data.email;
        break;
      }
    }

    if (!email) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json({ email });
  } catch (e: any) {
    return NextResponse.json({ message: String(e?.message || e) }, { status: 500 });
  }
}
