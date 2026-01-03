import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE env (URL / SERVICE_ROLE_KEY)");
  return createClient(url, key, { auth: { persistSession: false } });
}

function nextPow2(n: number) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export async function POST(req: Request, ctx: { params: Promise<{ tournamentId: string }> }) {
  try {
    const { tournamentId } = await ctx.params;
    if (!tournamentId) {
      return NextResponse.json({ ok: false, message: "tournamentId is empty" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const title = String(body?.title ?? "決勝トーナメント");
    const nomineesRaw = Array.isArray(body?.nominees) ? body.nominees : [];
    const nominees = nomineesRaw.map(String).filter(Boolean);

    if (nominees.length < 2) {
      return NextResponse.json({ ok: false, message: "nominees must be 2 or more" }, { status: 400 });
    }

    const db = getAdminSupabase();

    // 既に作成済みなら弾く（必要なら後で上書き仕様に変更可）
    const existing = await db
      .from("final_brackets")
      .select("id")
      .eq("tournament_id", tournamentId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (existing.error) throw existing.error;
    if (existing.data?.length) {
      return NextResponse.json({ ok: false, message: "final bracket already exists" }, { status: 409 });
    }

    // def を探す（handle_name='def' or is_dummy=true）
    const defRes = await db
      .from("players")
      .select("id,handle_name,is_dummy")
      .or("handle_name.eq.def,is_dummy.eq.true")
      .limit(1);

    if (defRes.error) throw defRes.error;
    const defId = defRes.data?.[0]?.id ?? null;

    const size = nextPow2(nominees.length);
    const paddedCount = Math.max(0, size - nominees.length);
    const seeded = [...nominees];

    if (paddedCount > 0) {
      if (!defId) {
        return NextResponse.json(
          { ok: false, message: `need def player for padding (${paddedCount}) but not found` },
          { status: 400 }
        );
      }
      for (let i = 0; i < paddedCount; i++) seeded.push(defId);
    }

    // bracket 作成
    const insB = await db
      .from("final_brackets")
      .insert({ tournament_id: tournamentId, title })
      .select("id,tournament_id,title,created_at")
      .single();

    if (insB.error) throw insB.error;
    const bracket = insB.data;

    // entries 作成（全ラウンド分）
    const rounds = Math.log2(size);
    const rows: any[] = [];

    for (let r = 1; r <= rounds; r++) {
      const slots = size / 2 ** (r - 1);
      for (let s = 1; s <= slots; s++) {
        rows.push({
          bracket_id: bracket.id,
          round_no: r,
          slot_no: s,
          player_id: r === 1 ? seeded[s - 1] : null,
        });
      }
    }

    const insE = await db.from("final_round_entries").insert(rows);
    if (insE.error) throw insE.error;

    return NextResponse.json({ ok: true, bracket, size, padded_count: paddedCount });
  } catch (e: any) {
    console.error("[league/finals] error", e);
    return NextResponse.json({ ok: false, message: e?.message ?? "unknown error" }, { status: 500 });
  }
}
