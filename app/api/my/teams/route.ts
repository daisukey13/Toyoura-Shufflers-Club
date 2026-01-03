// app/api/my/teams/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Team = { id: string; name: string };
type TeamMemberRow = { team_id: string | null };

type PendingCookie = { name: string; value: string; options: CookieOptions };

// --- ES5互換（Set/for-of/スプレッド不使用） ---
function uniqStrings(input: string[]): string[] {
  const seen: { [k: string]: 1 } = Object.create(null);
  const out: string[] = [];
  for (let i = 0; i < input.length; i++) {
    const v = input[i];
    if (!v) continue;
    if (seen[v]) continue;
    seen[v] = 1;
    out[out.length] = v;
  }
  return out;
}

function withMaxAgeZero(options: CookieOptions): CookieOptions {
  // スプレッド禁止のため Object.assign
  return Object.assign({}, options, { maxAge: 0 });
}

export async function GET(_req: NextRequest) {
  const cookieStore = await cookies();
  const pending: PendingCookie[] = [];

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createServerClient(supabaseUrl, supabaseAnon, {
    cookies: {
      // ✅ 同期で返す（重要）
      get(name: string) {
        const c = cookieStore.get(name);
        return c ? c.value : undefined;
      },
      // ✅ Supabase が更新したい Cookie を溜めておく（最後にレスポンスへ反映）
      set(name: string, value: string, options: CookieOptions) {
        pending[pending.length] = { name, value, options };
      },
      remove(name: string, options: CookieOptions) {
        pending[pending.length] = { name, value: "", options: withMaxAgeZero(options) };
      },
    },
  });

  // 認証
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;
  if (!user) {
    const res = NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
    for (let i = 0; i < pending.length; i++) {
      const c = pending[i];
      res.cookies.set(c.name, c.value, c.options);
    }
    return res;
  }

  // 管理者フラグ（無ければ false）
  let admin = false;
  try {
    const { data: priv, error: privErr } = await supabase
      .from("players_private")
      .select("is_admin")
      .eq("player_id", user.id)
      .maybeSingle();

    if (!privErr && priv) admin = !!(priv as any).is_admin;
  } catch {
    admin = false;
  }

  // 所属チームID取得
  let teamIds: string[] = [];
  try {
    const { data, error } = await supabase
      .from("team_members")
      .select("team_id")
      .eq("player_id", user.id);

    if (error) throw error;

    const rawIds: string[] = [];
    const rows = (data || []) as TeamMemberRow[];
    for (let i = 0; i < rows.length; i++) {
      const id = rows[i].team_id ? String(rows[i].team_id) : "";
      if (id) rawIds[rawIds.length] = id;
    }
    teamIds = uniqStrings(rawIds);
  } catch {
    teamIds = [];
  }

  // チーム一覧
  let teams: Team[] = [];

  // 管理者なら全件（失敗したら所属だけにフォールバック）
  if (admin) {
    try {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name")
        .order("name", { ascending: true });

      if (error) throw error;
      teams = (data || []) as Team[];
    } catch {
      // fall back
    }
  }

  // 非管理者 or 全件取得失敗 → 所属のみ
  if (teams.length === 0 && teamIds.length > 0) {
    try {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name")
        .in("id", teamIds);

      if (error) throw error;
      teams = (data || []) as Team[];
    } catch {
      teams = [];
    }
  }

  const res = NextResponse.json({ ok: true, admin, teams });

  // Supabase が更新した Cookie をレスポンスへ反映
  for (let i = 0; i < pending.length; i++) {
    const c = pending[i];
    res.cookies.set(c.name, c.value, c.options);
  }

  return res;
}
