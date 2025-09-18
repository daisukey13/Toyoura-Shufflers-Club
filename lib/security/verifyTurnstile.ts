export type TurnstileVerifyResult = {
  success: boolean;
  ['error-codes']?: string[];
  action?: string;
  hostname?: string;
};

export async function verifyTurnstile(token: string | undefined, req: Request) {
  if (!token) return { ok: false, data: { success: false, 'error-codes': ['missing-token'] } };

  const ip =
    req.headers.get('cf-connecting-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0] ||
    '';

  const body = new URLSearchParams({
    secret: process.env.TURNSTILE_SECRET_KEY || '',
    response: token,
  });
  if (ip) body.append('remoteip', ip);

  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });

  const data = (await r.json()) as TurnstileVerifyResult;
  return { ok: !!data.success, data };
}
