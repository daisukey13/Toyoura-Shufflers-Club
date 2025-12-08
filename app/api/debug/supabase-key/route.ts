import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

function maskHead(s: string, n = 10) {
  return s ? s.slice(0, n) + "…" : "(empty)";
}
function sha1(s: string) {
  return crypto.createHash("sha1").update(s).digest("hex");
}
function hasNewline(s: string) {
  return s.includes("\n") || s.includes("\r");
}
function hasSpace(s: string) {
  return /\s/.test(s);
}
function classifyKey(k: string) {
  if (!k) return "empty";
  if (k.startsWith("sb_secret_") || k.startsWith("sb_sec_")) return "sb_secret";
  if (k.startsWith("sb_publishable_") || k.startsWith("sb_pub_")) return "sb_publishable";
  if (k.startsWith("eyJhbGci")) return "legacy_jwt";
  return "unknown";
}
function tooShortSbSecret(k: string) {
  const t = classifyKey(k);
  return t === "sb_secret" && k.length < 80; // 途中切れ/省略表示コピー検知
}

export async function GET() {
  const url =
    (process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      "").trim();

  const anon =
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

  // “生” の値を別々に確認（どれが入ってるか切り分け用）
  const secret =
    (process.env.SUPABASE_SECRET_KEY || "").trim();

  const serviceRole =
    (process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      "").trim();

  // 互換：実際に利用されがちな優先順位（プロジェクト側に合わせて）
  const effective =
    (serviceRole || secret || "").trim();

  return NextResponse.json({
    ok: true,
    env: {
      url_head: maskHead(url, 28),
      url_host: (() => {
        try {
          return url ? new URL(url).host : null;
        } catch {
          return null;
        }
      })(),

      anon_head: maskHead(anon),
      anon_len: anon.length,
      anon_type: classifyKey(anon),
      anon_sha1: anon ? sha1(anon) : null,

      // Secret key（推奨）
      secret_head: maskHead(secret),
      secret_len: secret.length,
      secret_type: classifyKey(secret),
      secret_sha1: secret ? sha1(secret) : null,
      secret_has_newline: hasNewline(secret),
      secret_has_space: hasSpace(secret),
      secret_too_short: tooShortSbSecret(secret),

      // Service role（互換/旧名）
      service_role_head: maskHead(serviceRole),
      service_role_len: serviceRole.length,
      service_role_type: classifyKey(serviceRole),
      service_role_sha1: serviceRole ? sha1(serviceRole) : null,
      service_role_has_newline: hasNewline(serviceRole),
      service_role_has_space: hasSpace(serviceRole),
      service_role_too_short: tooShortSbSecret(serviceRole),

      // 実際に使われる値（どれを参照してるか一発で分かる）
      service_effective_head: maskHead(effective),
      service_effective_len: effective.length,
      service_effective_type: classifyKey(effective),
      service_effective_sha1: effective ? sha1(effective) : null,
      service_effective_has_newline: hasNewline(effective),
      service_effective_has_space: hasSpace(effective),
      service_effective_too_short: tooShortSbSecret(effective),
    },
  });
}
