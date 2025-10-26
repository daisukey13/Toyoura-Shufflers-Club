// lib/supabase/rest.ts
"use client";

import { createClient } from "@/lib/supabase/client";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient();

/** ユーザーの access_token を取得（未ログインなら例外） */
async function getAccessToken() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("not authenticated");
  return { token: session.access_token, userId: session.user.id };
}

/** 認証付きで Supabase REST を叩く共通 fetch */
export async function restFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { token } = await getAccessToken();

  const headers = new Headers(init.headers as HeadersInit);
  headers.set("apikey", SUPABASE_ANON_KEY);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");

  const url = path.startsWith("http")
    ? path
    : `${SUPABASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;

  const res = await fetch(url, { ...init, headers });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
  }
  return res;
}

export async function restGet(path: string) {
  return restFetch(path, { method: "GET" });
}
export async function restPost(path: string, body: unknown) {
  return restFetch(path, { method: "POST", body: JSON.stringify(body) });
}
export async function restPatch(path: string, body: unknown) {
  return restFetch(path, { method: "PATCH", body: JSON.stringify(body) });
}
