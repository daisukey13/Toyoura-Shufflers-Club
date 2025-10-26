// lib/api/matches-client.ts
export type CreateMatchInput = Record<string, any>; // 既存の送信型をそのまま通す

export async function createMatch(input: CreateMatchInput) {
  const res = await fetch("/api/matches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.message || "登録に失敗しました。");
  }
  return json as { ok: true; id: string };
}
