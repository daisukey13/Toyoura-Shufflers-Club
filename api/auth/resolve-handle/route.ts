// app/api/login/resolve-email/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!; // サーバー専用
const admin = createClient(url, serviceRole, {
  auth: { persistSession: false },
});

const E164 = /^\+[1-9]\d{6,14}$/;

async function verifyTurnstile(token: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return false;

  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
    },
  );
  const json = await res.json();
  return !!json?.success;
}

export async function POST(req: Request) {
  try {
    const { phone, token } = await req.json();

    if (typeof phone !== "string" || !E164.test(phone.trim())) {
      return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
    }
    if (!token || !(await verifyTurnstile(token))) {
      return NextResponse.json({ error: "captcha_failed" }, { status: 400 });
    }

    // players_private から email を取得
    const { data, error } = await admin
      .from("players_private")
      .select("email")
      .eq("phone", phone.trim())
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data?.email) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ email: data.email });
  } catch (e: any) {
    console.error("[resolve-email] error:", e?.message || e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
