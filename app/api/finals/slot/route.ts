import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AnyBody = Record<string, any>;
type AdminRow = { user_id: string };
type PlayerFlagRow = { is_admin: boolean | null };

async function isAdminUser(userId: string): Promise<boolean> {
  const [adminResp, playerResp] = await Promise.all([
    (supabaseAdmin.from('app_admins') as any).select('user_id').eq('user_id', userId).maybeSingle(),
    (supabaseAdmin.from('players') as any).select('is_admin').eq('id', userId).maybeSingle(),
  ]);

  const adminRow = (adminResp?.data ?? null) as AdminRow | null;
  const playerRow = (playerResp?.data ?? null) as PlayerFlagRow | null;

  if (adminRow?.user_id) return true;
  if (playerRow?.is_admin === true) return true;
  return false;
}

const toInt = (v: unknown, fallback = 0) => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
};

export async function POST(req: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json({ ok: false, message: 'Supabase 環境変数が未設定です。' }, { status: 500 });
    }

    const cookieStore = await cookies();
    const supa = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options?: any) {
            cookieStore.set({ name, value, ...(options || {}) } as any);
          },
          remove(name: string, options?: any) {
            cookieStore.set({ name, value: '', ...(options || {}) } as any);
          },
        },
      } as any
    );

    const { data: userData, error: userErr } = await supa.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, message: '認証が必要です。' }, { status: 401 });
    }

    const userId = userData.user.id;
    const ok = await isAdminUser(userId);
    if (!ok) {
      return NextResponse.json({ ok: false, message: '権限がありません。' }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as AnyBody | null;
    if (!body) return NextResponse.json({ ok: false, message: '不正なリクエストです。' }, { status: 400 });

    const bracket_id = String(body.bracket_id || '').trim();
    const round_no = toInt(body.round_no, 0);
    const slot_no = toInt(body.slot_no, 0);
    const player_id_raw = body.player_id;
    const player_id = player_id_raw ? String(player_id_raw).trim() : null;

    if (!bracket_id || round_no <= 0 || slot_no <= 0) {
      return NextResponse.json({ ok: false, message: '必須パラメータが不足しています。' }, { status: 400 });
    }

    // ✅ 保存先は final_round_entries
    const { error } = await supabaseAdmin
      .from('final_round_entries')
      .upsert(
        { bracket_id, round_no, slot_no, player_id },
        { onConflict: 'bracket_id,round_no,slot_no' }
      );

    if (error) {
      return NextResponse.json({ ok: false, message: `保存に失敗しました: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    console.error('[api/finals/slot] fatal:', e);
    return NextResponse.json({ ok: false, message: 'サーバエラーが発生しました。' }, { status: 500 });
  }
}
