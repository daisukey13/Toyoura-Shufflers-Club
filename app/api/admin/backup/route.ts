// app/api/admin/backup/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function env(name: string) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

/**
 * ✅ Cookie セッションが無い環境でも動くように
 * - 1) Cookie で getUser()
 * - 2) だめなら Authorization: Bearer <access_token> で getUser()
 *
 * ✅ 追加（今回の決定打）：
 * - dev(ローカル)では admin 判定をバイパスしてバックアップを許可する
 *   ※本番は絶対にバイパスしない（NODE_ENV === 'production' の時だけ厳格）
 */
async function assertAdmin(req: Request) {
  // ✅ ローカル検証を止めない（DB全消し直後でも backup/restore を回すため）
  // ※ production では絶対に通らない
  if (process.env.NODE_ENV !== 'production') {
    return 'dev-bypass';
  }

  const url = env('NEXT_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL');
  const anon = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !anon) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  // 1) Cookie セッション
  const cookieStore = cookies();
  const sbCookie = createServerClient(url, anon, {
    cookies: { get: (key) => cookieStore.get(key)?.value },
  });

  const r1 = await sbCookie.auth.getUser();
  const cookieUserId = r1?.data?.user?.id ? String(r1.data.user.id) : null;

  // 2) Bearer
  const authz = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const m = authz.match(/^Bearer\s+(.+)$/i);
  const bearer = m?.[1]?.trim() || null;

  let userId: string | null = cookieUserId;
  let sbForQuery: SupabaseClient<any, any, any, any> = sbCookie as any;

  if (!userId) {
    if (!bearer) throw new Error('Auth session missing!');

    const sbBearer = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });

    const r2 = await sbBearer.auth.getUser(bearer);
    userId = r2?.data?.user?.id ? String(r2.data.user.id) : null;

    if (!userId) throw new Error('Not authenticated');
    sbForQuery = sbBearer as any;
  }

  const { data: me, error: pErr } = await (sbForQuery.from('players') as any)
    .select('is_admin')
    .eq('auth_user_id', userId)
    .maybeSingle();

  if (pErr) throw new Error(pErr.message || 'players lookup failed');
  if (!me?.is_admin) throw new Error('Forbidden: admin only');

  return userId;
}

// ✅ バックアップ対象（リーグ/決勝も含む）
// ★ 追加: final_round_entries（決勝生成の材料として使われているため）
const TABLES = [
  'players',
  'teams',
  'team_members',
  'tournaments',
  'tournament_entries',
  'league_blocks',
  'league_block_members',
  'matches',
  'match_entries',
  'final_brackets',
  'final_round_entries',
  'final_matches',
] as const;

async function fetchAll(svc: SupabaseClient<any, any, any, any>, table: string) {
  const { data, error } = await (svc.from(table) as any).select('*');
  if (error) throw new Error(`${table} select failed: ${error.message}`);
  return (data ?? []) as any[];
}

function backupFilename() {
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = new Date();
  return `backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes()
  )}.json`;
}

export async function GET(req: Request) {
  try {
    await assertAdmin(req);

    const url = env('NEXT_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL');
    const service = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_ROLE');
    if (!url || !service) return jsonError('Missing service role env (local only)', 500);

    const svcRaw = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const svc = svcRaw as SupabaseClient<any, any, any, any>;

    const out: Record<string, any[]> = {};
    for (const t of TABLES) out[t] = await fetchAll(svc, t);

    return new NextResponse(JSON.stringify(out, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-disposition': `attachment; filename="${backupFilename()}"`,
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || 'backup failed', 500);
  }
}
