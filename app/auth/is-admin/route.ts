// app/api/auth/is-admin/route.ts
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET() {
  try {
    // Cookie から現在の Supabase ユーザーを取得
    const supa = createServerSupabase();
    const { data: { user } } = await supa.auth.getUser();
    if (!user) {
      return NextResponse.json({ isAdmin: false }, { status: 401 });
    }
    const uid = user.id;

    // service role で RLS を回避してチェック
    const [adminResp, playerResp] = await Promise.all([
      supabaseAdmin.from('app_admins').select('user_id').eq('user_id', uid).maybeSingle(),
      supabaseAdmin.from('players').select('is_admin').eq('id', uid).maybeSingle(),
    ]);

    const isAdmin = !!adminResp.data?.user_id || !!playerResp.data?.is_admin;
    return NextResponse.json({ isAdmin });
  } catch (e) {
    // 失敗時は保守的に false
    return NextResponse.json({ isAdmin: false }, { status: 500 });
  }
}
