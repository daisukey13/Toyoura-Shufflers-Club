// app/api/admin/register/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function str(v: any) {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

async function isRequesterAdmin(accessToken: string) {
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data?.user) return { ok: false, userId: '' };

  const uid = data.user.id;
  const { data: row } = await supabaseAdmin
    .from('players')
    .select('id, is_admin')
    .eq('id', uid)
    .maybeSingle();

  return { ok: !!row?.is_admin, userId: uid };
}

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    if (!token) return NextResponse.json({ ok: false, error: 'missing bearer token' }, { status: 401 });

    const adminCheck = await isRequesterAdmin(token);
    if (!adminCheck.ok) {
      return NextResponse.json({ ok: false, error: 'forbidden (not admin)' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({} as any));

    const email = str(body?.email);
    const password = str(body?.password);
    const handle_name = str(body?.handle_name);

    if (!email) return NextResponse.json({ ok: false, error: 'email is required' }, { status: 400 });
    if (!password) return NextResponse.json({ ok: false, error: 'password is required' }, { status: 400 });
    if (!handle_name) return NextResponse.json({ ok: false, error: 'handle_name is required' }, { status: 400 });

    const full_name = str(body?.full_name);
    const phone = str(body?.phone);
    const address = str(body?.address) || '未設定';
    const avatar_url = str(body?.avatar_url) || '/default-avatar.png';

    const rating_default = Number(body?.ranking_points ?? process.env.NEXT_PUBLIC_RATING_DEFAULT ?? 1000);
    const handicap_default = Number(body?.handicap ?? process.env.NEXT_PUBLIC_HANDICAP_DEFAULT ?? 30);

    // 1) Auth 管理APIでユーザー作成（確認メール不要の運用）
    const created = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { handle_name, full_name },
    });
    if (created.error || !created.data?.user?.id) {
      return NextResponse.json({ ok: false, error: created.error?.message || 'createUser failed' }, { status: 400 });
    }
    const user_id = created.data.user.id;

    // 2) players（公開）
    const { error: pErr } = await supabaseAdmin
      .from('players')
      .upsert(
        {
          id: user_id,
          handle_name,
          avatar_url,
          address,
          is_admin: false,
          is_active: true,
          ranking_points: Number.isFinite(rating_default) ? rating_default : 1000,
          handicap: Number.isFinite(handicap_default) ? handicap_default : 30,
          matches_played: 0,
          wins: 0,
          losses: 0,
        } as any,
        { onConflict: 'id' }
      );
    if (pErr) {
      return NextResponse.json({ ok: false, error: pErr.message }, { status: 400 });
    }

    // 3) players_private（非公開）※無ければスルー
    const tryKeys: Array<'player_id' | 'id' | 'user_id' | 'auth_user_id'> = [
      'player_id',
      'id',
      'user_id',
      'auth_user_id',
    ];

    let saved = false;
    let lastErr: any = null;

    for (const key of tryKeys) {
      const base: Record<string, any> = {
        [key]: user_id,
        full_name: full_name || null,
        email: email || null,
        phone: phone || null,
      };

      const { error } = await supabaseAdmin
        .from('players_private')
        .upsert(base as any, { onConflict: key } as any);

      if (!error) {
        saved = true;
        break;
      }
      lastErr = error;

      const msg = String(error?.message || '');
      if (/does not exist|no unique|exclusion|schema cache/i.test(msg)) continue;
      break;
    }

    if (!saved && lastErr) {
      const msg = String(lastErr?.message || '');
      if (!/relation .* does not exist|42P01/i.test(msg)) {
        return NextResponse.json({ ok: false, error: msg }, { status: 400 });
      }
    }

    return NextResponse.json({ ok: true, user_id }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
