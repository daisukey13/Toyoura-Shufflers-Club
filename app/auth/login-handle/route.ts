// app/api/auth/login-handle/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

function normalizeHandleName(s: string) {
  return (s ?? '')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const handle_name = normalizeHandleName(String(body?.handle_name ?? ''));
    const password = String(body?.password ?? '');

    if (!handle_name) {
      return NextResponse.json({ ok: false, message: 'ハンドルネームを入力してください' }, { status: 400 });
    }
    if (!password) {
      return NextResponse.json({ ok: false, message: 'パスワードを入力してください' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anonKey || !serviceKey) {
      return NextResponse.json(
        { ok: false, message: 'Supabase env が不足しています（URL/ANON/SERVICE_ROLE）' },
        { status: 500 }
      );
    }

    // 1) Service Role で handle_name -> player_id / is_admin を取得
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: p, error: pErr } = await admin
      .from('players')
      .select('id,is_admin')
      .eq('handle_name', handle_name)
      .maybeSingle();

    if (pErr) {
      return NextResponse.json({ ok: false, message: 'プレイヤー検索に失敗しました' }, { status: 500 });
    }
    if (!p?.id) {
      return NextResponse.json({ ok: false, message: 'ハンドルネームが見つかりません' }, { status: 404 });
    }

    const playerId = String(p.id);
    const is_admin = p.is_admin === true;

    // 2) Service Role で players_private から email を取得
    const { data: priv, error: privErr } = await admin
      .from('players_private')
      .select('email')
      .eq('player_id', playerId)
      .maybeSingle();

    if (privErr) {
      return NextResponse.json({ ok: false, message: 'ログイン情報の取得に失敗しました' }, { status: 500 });
    }

    const email = (priv?.email ?? null) as string | null;
    if (!email) {
      return NextResponse.json(
        { ok: false, message: 'このアカウントにはメールアドレスが登録されていません（管理者に確認してください）' },
        { status: 400 }
      );
    }

    // 3) ANON で signInWithPassword（セッションは返すだけ）
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authErr } = await anon.auth.signInWithPassword({ email, password });

    if (authErr || !authData?.session) {
      const msg = authErr?.message ?? 'ログインに失敗しました';
      if (msg.includes('Invalid login credentials')) {
        return NextResponse.json({ ok: false, message: 'パスワードが正しくありません' }, { status: 401 });
      }
      return NextResponse.json({ ok: false, message: msg }, { status: 401 });
    }

    return NextResponse.json({
      ok: true,
      player_id: playerId,
      is_admin,
      session: {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message ?? 'login-handle failed' },
      { status: 500 }
    );
  }
}
