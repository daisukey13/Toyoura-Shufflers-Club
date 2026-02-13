// app/api/admin/players/set-active/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function parseBool(v: any): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  if (typeof v === 'number') {
    if (v === 1) return true;
    if (v === 0) return false;
  }
  return null;
}

function looksLikeMissingTableOrColumn(msg: string) {
  // PostgREST/Supabaseでありがちな「テーブル/列が無い」系
  return /does not exist/i.test(msg) || /column .* does not exist/i.test(msg) || /relation .* does not exist/i.test(msg);
}

function getAdminClient(): SupabaseClient<any> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // ✅ ここで throw しない（ビルド時に env が無いと落ちるため）
  if (!url || !service) return null;

  return createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function isAdminByFallback(admin: SupabaseClient<any>, userId: string): Promise<boolean> {
  // 1) players_private.is_admin を優先（あなたの構成でよく使う）
  try {
    const { data, error } = await admin
      .from('players_private')
      .select('is_admin')
      .eq('player_id', userId)
      .maybeSingle();

    if (!error) return !!(data as any)?.is_admin;

    // テーブル/列が無いなら次へフォールバック、それ以外は“管理者ではない”扱いで返す
    if (!looksLikeMissingTableOrColumn(error.message)) return false;
  } catch {
    // 次へ
  }

  // 2) players.is_admin へフォールバック
  try {
    const { data, error } = await admin.from('players').select('id,is_admin').eq('id', userId).maybeSingle();
    if (error) return false;
    return !!(data as any)?.is_admin;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const player_id = String(body?.player_id ?? '').trim();
    const is_active_raw = parseBool(body?.is_active);

    if (!player_id) return json(400, { ok: false, message: 'player_id が必要です。' });
    if (is_active_raw === null) return json(400, { ok: false, message: 'is_active は true/false が必要です。' });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return json(500, { ok: false, message: 'Supabase env が不足しています。' });

    const admin = getAdminClient();
    if (!admin) {
      // ✅ ここで初めてエラーとして返す（ビルドを落とさない）
      return json(500, { ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel環境変数を確認してください）。' });
    }

    // セッション（cookie）からログインユーザー取得
    const cookieStore = cookies(); // ✅ await しない（Nextの型差異で落ちるのを防ぐ）
    const supa = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // server component / build 時など書き込み不可があり得るので握り潰す
          }
        },
      },
    });

    const { data: ures, error: uerr } = await supa.auth.getUser();
    if (uerr) return json(401, { ok: false, message: uerr.message });
    const me = ures.user;
    if (!me) return json(401, { ok: false, message: '管理者としてログインしてください。' });

    // 管理者判定（players_private → players の順でフォールバック）
    const okAdmin = await isAdminByFallback(admin, me.id);
    if (!okAdmin) return json(403, { ok: false, message: '管理者権限がありません。' });

    // 反映
    const { error: upErr } = await admin.from('players').update({ is_active: is_active_raw }).eq('id', player_id);
    if (upErr) return json(500, { ok: false, message: `更新に失敗: ${upErr.message}` });

    return json(200, { ok: true, player_id, is_active: is_active_raw });
  } catch (e: any) {
    return json(500, { ok: false, message: e?.message ?? 'エラーが発生しました' });
  }
}
