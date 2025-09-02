// app/api/turnstile/verify/route.ts
export const runtime = 'edge'; // どちらでもOK（edge/node）
export async function POST(req: Request) {
  try {
    const { token } = await req.json(); // クライアントから受け取る
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      return new Response(JSON.stringify({ ok: false, reason: 'missing-server-secret' }), { status: 500 });
    }
    if (!token) {
      return new Response(JSON.stringify({ ok: false, reason: 'missing-client-token' }), { status: 400 });
    }

    const body = new URLSearchParams();
    body.append('secret', secret);
    body.append('response', token);

    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await resp.json();

    // 代表的なエラーコードの取り出し（ログ/監視用）
    // invalid-input-secret / missing-input-secret / invalid-input-response / timeout-or-duplicate など
    if (!data.success) {
      return new Response(JSON.stringify({ ok: false, reason: 'verify-failed', errors: data['error-codes'] ?? [] }), { status: 400 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, reason: 'exception' }), { status: 500 });
  }
}
