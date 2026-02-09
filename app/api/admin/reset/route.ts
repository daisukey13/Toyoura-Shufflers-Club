// app/api/admin/reset/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function env(name: string) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

async function assertAdmin() {
  const url = env('NEXT_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL');
  const anon = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !anon) throw new Error('Missing SUPABASE ENV');

  const cookieStore = cookies();
  const supabase = createServerClient(url, anon, {
    cookies: { get: (key) => cookieStore.get(key)?.value },
  });

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user?.id) throw new Error('Auth session missing!');

  const { data: me } = await supabase
    .from('players')
    .select('is_admin')
    .eq('auth_user_id', auth.user.id)
    .maybeSingle();

  if (!me?.is_admin) throw new Error('admin only');
}

/**
 * ✅ 削除順 = 子→親（FKで安全に消す）
 * ✅ 挿入順 = reverse()（親→子）
 */
const TABLES = [
  'final_matches',
  'match_entries',
  'league_block_members',
  'team_members',
  'tournament_entries',
  'final_brackets',
  'matches',
  'league_blocks',
  'tournaments',
  'teams',
  'players',
] as const;

/**
 * ✅ 全削除（PostgRESTは条件なしdelete不可）
 * 「存在しそうな列」を順に試し、成功した時点で return。
 */
async function deleteAll(svc: any, table: string) {
  const candidates = [
    'id',
    'created_at',
    'updated_at',
    'match_id',
    'tournament_id',
    'league_block_id',
    'bracket_id',
    'player_id',
    'team_id',
    'round_no',
    'match_no',
    'status',
  ];

  for (const col of candidates) {
    try {
      const q: any = (svc.from(table) as any).delete();
      const { error } = await q.not(col, 'is', null);
      if (!error) return;
    } catch {
      // ignore and try next
    }
  }

  throw new Error(`${table} delete failed: no usable filter column (id/created_at/updated_at)`);
}

/**
 * ✅ INSERT（型崩壊 & 重複対策）
 * - players は upsert(id)
 * - final_matches は UNIQUE(bracket_id, round_no, match_no) なので upsert で吸収
 * - 他テーブルは通常 insert
 */
async function insertChunk(svc: any, table: string, rows: any[]) {
  if (!rows?.length) return;

  const chunkSize = 500;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);

    const q: any = svc.from(table);

    const res =
      table === 'players'
        ? await q.upsert(chunk as any, { onConflict: 'id' })
        : table === 'final_matches'
          ? await q.upsert(chunk as any, { onConflict: 'bracket_id,round_no,match_no' })
          : await q.insert(chunk as any);

    if (res?.error) {
      throw new Error(`${table} insert failed: ${res.error.message}`);
    }
  }
}

export async function POST(req: Request) {
  try {
    await assertAdmin();

    const url = env('NEXT_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL');
    const service = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_ROLE');
    if (!url || !service) return jsonError('Missing service role env', 500);

    const svc: any = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => null);
    if (!body) return jsonError('invalid json');

    // 1) 子→親の順で消す
    for (const t of TABLES) {
      await deleteAll(svc, t);
    }

    // 2) 親→子の順で入れる
    const insertOrder = [...TABLES].reverse();
    for (const t of insertOrder) {
      const rows = (body as any)[t];
      if (Array.isArray(rows) && rows.length > 0) {
        await insertChunk(svc, t, rows);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return jsonError(e?.message || 'reset failed', 500);
  }
}
