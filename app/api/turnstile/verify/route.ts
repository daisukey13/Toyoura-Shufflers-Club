// app/api/turnstile/verify/route.ts

// ✅ Edge をやめて Node.js で動かす（最小修正）
export const runtime = 'nodejs';

// ✅ 検証は毎回実行したいので動的指定を明示（任意だが安全）
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { token } = (await req.json()) as { token?: string };

    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      return new Response(JSON.stringify({ ok: false, reason: 'missing-server-secret' }), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    if (!token) {
      return new Response(JSON.stringify({ ok: false, reason: 'missing-client-token' }), {
        status: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    const body = new URLSearchParams();
    body.append('secret', secret);
    body.append('response', token);

    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      // cache: 'no-store' 相当（API route なので基本不要だが念のため）
    });

    const data = (await resp.json()) as { success?: boolean; ['error-codes']?: string[] };

    if (!data?.success) {
      return new Response(
        JSON.stringify({ ok: false, reason: 'verify-failed', errors: data?.['error-codes'] ?? [] }),
        { status: 400, headers: { 'content-type': 'application/json; charset=utf-8' } },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: 'exception' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
}
