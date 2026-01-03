// app/api/admin/players/set-active/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const player_id = String(body?.player_id ?? '').trim();
    const is_active = Boolean(body?.is_active);

    if (!player_id) return json(400, { ok: false, message: 'player_id が必要です。' });

    // セッション（cookie）からログインユーザー取得
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return json(500, { ok: false, message: 'Supabase env が不足しています。' });

    const cookieStore = await cookies();
    const supa = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {}
        },
      },
    });

    const { data: ures, error: uerr } = await supa.auth.getUser();
    if (uerr) return json(401, { ok: false, message: uerr.message });
    const me = ures.user;
    if (!me) return json(401, { ok: false, message: '管理者としてログインしてください。' });

    // 管理者判定（players.is_admin）
    const { data: meRow, error: meErr } = await supabaseAdmin
      .from('players')
      .select('id,is_admin')
      .eq('id', me.id)
      .maybeSingle();

    if (meErr) return json(500, { ok: false, message: `管理者確認に失敗: ${meErr.message}` });
    if (!meRow || !(meRow as any).is_admin) return json(403, { ok: false, message: '管理者権限がありません。' });

    // 反映
    const { error: upErr } = await supabaseAdmin.from('players').update({ is_active }).eq('id', player_id);
    if (upErr) return json(500, { ok: false, message: `更新に失敗: ${upErr.message}` });

    return json(200, { ok: true, player_id, is_active });
  } catch (e: any) {
    return json(500, { ok: false, message: e?.message ?? 'エラーが発生しました' });
  }
}
