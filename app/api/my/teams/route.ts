// app/api/my/teams/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Team = { id: string; name: string };

export async function GET(_req: NextRequest) {
  try {
    // 認証ユーザーを確定
    const cookieStore = cookies();
    const supa = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          set: (name, value, options?: CookieOptions) => cookieStore.set({ name, value, ...options }),
          remove: (name, options?: CookieOptions) => cookieStore.set({ name, value: '', ...options }),
        },
      } as any
    );

    const { data: { user }, error: uerr } = await supa.auth.getUser();
    if (uerr || !user) {
      return NextResponse.json({ ok: false, message: '認証が必要です。' }, { status: 401 });
    }

    // 管理者判定（players.is_admin を想定。別名ならここを変える）
    const { data: me } = await supabaseAdmin
      .from('players')
      .select('id, is_admin')
      .eq('id', user.id)
      .single();

    const isAdmin = !!me?.is_admin;

    // 管理者は全チーム
    if (isAdmin) {
      const { data: allTeams, error: tErr } = await supabaseAdmin
        .from('teams')
        .select('id, name')
        .order('name', { ascending: true });
      if (tErr) {
        return NextResponse.json({ ok: false, message: `チーム取得に失敗: ${tErr.message}` }, { status: 500 });
      }
      return NextResponse.json({ ok: true, admin: true, teams: (allTeams ?? []) as Team[] });
    }

    // 一般ユーザー: 所属チームのみ
    // スキーマ差異に対応するため、よくあるテーブル名を順に試す
    const candidates = [
      { table: 'team_members', playerCol: 'player_id', teamCol: 'team_id' },
      { table: 'players_teams', playerCol: 'player_id', teamCol: 'team_id' },
      { table: 'team_players', playerCol: 'player_id', teamCol: 'team_id' },
      { table: 'memberships', playerCol: 'player_id', teamCol: 'team_id' },
    ] as const;

    let teamIds: string[] = [];
    let lastError: string | null = null;

    for (const c of candidates) {
      const { data, error } = await supabaseAdmin
        .from(c.table)
        .select(`${c.teamCol}`)
        .eq(c.playerCol, user.id);

      if (!error && data) {
        teamIds = [...new Set(data.map((r: any) => String(r[c.teamCol])))]
          .filter(Boolean);
        break;
      } else {
        lastError = error?.message ?? lastError;
      }
    }

    if (teamIds.length === 0) {
      // 所属なし（or 上記テーブル名が合っていない）
      // それでも0件として返す（UI側で「所属なし」と表示）
      return NextResponse.json({ ok: true, admin: false, teams: [] as Team[], note: lastError ?? undefined });
    }

    const { data: teams, error: tErr } = await supabaseAdmin
      .from('teams')
      .select('id, name')
      .in('id', teamIds)
      .order('name');
    if (tErr) {
      return NextResponse.json({ ok: false, message: `チーム取得に失敗: ${tErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, admin: false, teams: (teams ?? []) as Team[] });
  } catch (e: any) {
    console.error('[api/my/teams] fatal:', e);
    return NextResponse.json({ ok: false, message: 'サーバエラーが発生しました。' }, { status: 500 });
  }
}
