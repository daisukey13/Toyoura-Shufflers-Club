// app/api/my/teams/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Team = { id: string; name: string };
type TeamMemberRow = { team_id: string | null };

// --- ES5互換で動くユーティリティ（Set/for-of/スプレッド不使用） ---
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

function readCookie(name: string) {
  const store = cookies();
  const c = store.get(name);
  return c ? c.value : undefined;
}

export async function GET(_req: NextRequest) {
  // Supabase SSR クライアント（Cookie連携）
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createServerClient(supabaseUrl, supabaseAnon, {
    cookies: {
      get: readCookie,
      set: (name, value, options) => {
        // App RouterのRoute内ではレスポンス側でSet-Cookieするのが推奨ですが、
        // 今回は読み取り専用用途なので set/remove はno-opで問題ありません。
      },
      remove: () => {},
    },
  });

  // 認証
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;
  if (!user) {
    return NextResponse.json(
      { ok: false, message: 'Unauthorized' },
      { status: 401 }
    );
  }

  // 管理者フラグ（存在しない場合は false にフォールバック）
  let admin = false;
  try {
    const { data: priv, error: privErr } = await supabase
      .from('players_private')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();
    if (!privErr && priv) admin = !!(priv as any).is_admin;
  } catch {
    admin = false;
  }

  // まずはユーザーの所属チームIDを取得
  let teamIds: string[] = [];
  try {
    const { data, error } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('player_id', user.id);

    if (error) throw error;

    const rawIds: string[] = [];
    const rows = (data || []) as TeamMemberRow[];
    for (let i = 0; i < rows.length; i++) {
      const id = rows[i].team_id ? String(rows[i].team_id) : '';
      if (id) rawIds[rawIds.length] = id;
    }
    teamIds = uniqStrings(rawIds);
  } catch (e) {
    // 所属取得に失敗した場合は空のまま続行
    teamIds = [];
  }

  // 返すチーム一覧
  let teams: Team[] = [];

  // 管理者なら全チームを取得（失敗したら所属チームのみにフォールバック）
  if (admin) {
    try {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name')
        .order('name', { ascending: true });
      if (error) throw error;
      teams = (data || []) as Team[];
    } catch {
      // fall back to membership
    }
  }

  // 非管理者 or 管理者の全件取得が失敗 → 所属チームのみ返す
  if (teams.length === 0 && teamIds.length > 0) {
    try {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name')
        .in('id', teamIds);
      if (error) throw error;
      teams = (data || []) as Team[];
    } catch {
      teams = [];
    }
  }

  return NextResponse.json({ ok: true, admin, teams });
}
