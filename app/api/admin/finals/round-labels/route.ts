// app/api/admin/finals/round-labels/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function getAdminSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  const service =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!url || !service) throw new Error("Missing SUPABASE url/service role key env");
  return createClient(url, service, { auth: { persistSession: false } });
}

async function getSupabaseUser() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) return null;

  // Next の cookies() が async 環境があるので await する
  const cookieStore = await cookies();
  const pending: Array<{ name: string; value: string; options: CookieOptions }> = [];

  const supabase = createServerClient(supabaseUrl, supabaseAnon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        // refresh が必要になった時のために保持（今回はレスポンスに反映は不要でもOK）
        pending.push({ name, value, options });
      },
      remove(name: string, options: CookieOptions) {
        pending.push({ name, value: "", options: { ...options, maxAge: 0 } });
      },
    },
  });

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user ?? null;
  } catch {
    return null;
  }
}

/**
 * 任意: 管理者だけにしたいなら env で絞れます
 * - ADMIN_CLERK_USER_IDS="user_xxx,user_yyy"
 * - ADMIN_SUPABASE_USER_IDS="uuid1,uuid2"
 * 未設定なら「ログインしていればOK」
 */
function isAllowed(clerkUserId: string | null, supabaseUserId: string | null) {
  const c = (process.env.ADMIN_CLERK_USER_IDS || "").trim();
  if (c) {
    const set = new Set(c.split(",").map((s) => s.trim()).filter(Boolean));
    if (clerkUserId && set.has(clerkUserId)) return true;
    // Clerk の allowlist があるなら、Clerk未一致は基本NG（運用方針次第）
    // ただし Supabase allowlist もある場合はそっちで救済
  }

  const s = (process.env.ADMIN_SUPABASE_USER_IDS || "").trim();
  if (s) {
    const set = new Set(s.split(",").map((x) => x.trim()).filter(Boolean));
    if (supabaseUserId && set.has(supabaseUserId)) return true;
  }

  // allowlist がどっちも無ければ「ログインしていればOK」
  if (!c && !s) return !!(clerkUserId || supabaseUserId);

  // allowlist があるのに一致しない
  return false;
}

async function requireAuth() {
  // 1) Clerk
  let clerkUserId: string | null = null;
  try {
    const a: any = await auth(); // await して安全に
    clerkUserId = (a?.userId as string) ?? null;
  } catch {
    clerkUserId = null;
  }

  // 2) Supabase fallback
  const sbUser = await getSupabaseUser();
  const supabaseUserId = sbUser?.id ?? null;

  if (!isAllowed(clerkUserId, supabaseUserId)) {
    return { ok: false as const, clerkUserId, supabaseUserId };
  }

  return { ok: true as const, clerkUserId, supabaseUserId };
}

export async function GET(req: Request) {
  const a = await requireAuth();
  if (!a.ok) return json(401, { ok: false, message: "Unauthorized" });

  const { searchParams } = new URL(req.url);
  const bracketId = searchParams.get("bracketId") || searchParams.get("bracket_id");
  if (!bracketId) return json(400, { ok: false, message: "bracketId is required" });

  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from("final_round_labels")
    .select("round_no,label")
    .eq("bracket_id", bracketId)
    .order("round_no", { ascending: true });

  if (error) return json(500, { ok: false, message: error.message });

  const dict: Record<string, string> = {};
  for (const r of data ?? []) {
    dict[String((r as any).round_no)] = String((r as any).label ?? "");
  }
  return json(200, { ok: true, labels: dict });
}

export async function POST(req: Request) {
  const a = await requireAuth();
  if (!a.ok) return json(401, { ok: false, message: "Unauthorized" });

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, message: "Invalid JSON" });
  }

  const bracketId = String(body?.bracketId ?? body?.bracket_id ?? "").trim();
  const labels =
    (body?.labels && typeof body.labels === "object" ? body.labels : null) ||
    (body?.roundLabels && typeof body.roundLabels === "object" ? body.roundLabels : null);

  if (!bracketId) return json(400, { ok: false, message: "bracketId is required" });
  if (!labels) return json(400, { ok: false, message: "labels is required" });

  const rows = Object.entries(labels)
    .map(([k, v]) => {
      const roundNo = Number(k);
      if (!Number.isFinite(roundNo) || roundNo <= 0) return null;
      return {
        bracket_id: bracketId,
        round_no: roundNo,
        label: String(v ?? "").trim(),
      };
    })
    .filter(Boolean) as { bracket_id: string; round_no: number; label: string }[];

  const admin = getAdminSupabase();
  const { error } = await admin
    .from("final_round_labels")
    .upsert(rows, { onConflict: "bracket_id,round_no" });

  if (error) return json(500, { ok: false, message: error.message });

  return json(200, { ok: true });
}
