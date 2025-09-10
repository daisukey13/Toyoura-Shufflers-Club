// app/api/matches/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // セッションから User を取得
    const cookieStore = cookies();
    const supa = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          set: (name, value, options) => cookieStore.set({ name, value, ...options }),
          remove: (name, options) => cookieStore.set({ name, value: '', ...options }),
        },
      }
    );

    const { data: auth } = await supa.auth.getUser();
    const user = auth.user;
    if (!user) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }

    // クライアントから来たボディをそのまま活かす（元の登録ページのカラム名を担保）
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, message: 'bad_request' }, { status: 400 });
    }

    // reporter_id をサーバ側で付与（NOT NULL対策）
    const record = { ...body, reporter_id: user.id };

    // INSERT（Service Role）
    const { data, error } = await supabaseAdmin
      .from('matches')
      .insert(record)
      .select('id')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, id: data?.id }, { status: 200 });
  } catch (e: any) {
    console.error('[api/matches] fatal:', e?.message || e);
    return NextResponse.json({ ok: false, message: 'server_error' }, { status: 500 });
  }
}
