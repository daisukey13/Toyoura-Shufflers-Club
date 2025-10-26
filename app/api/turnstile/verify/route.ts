// app/api/turnstile/verify/route.ts
import { NextResponse } from "next/server";
import { verifyTurnstile } from "@/lib/security/verifyTurnstile";

export const runtime = "edge"; // Nodeでも可: 'nodejs'

export async function POST(req: Request) {
  try {
    const { token } = await req.json();
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "NO_TOKEN" },
        { status: 400 },
      );
    }

    const ip =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

    const { success, data } = await verifyTurnstile(token, ip);
    return NextResponse.json(
      { ok: success, ...data },
      { status: success ? 200 : 400, headers: { "cache-control": "no-store" } },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 },
    );
  }
}
