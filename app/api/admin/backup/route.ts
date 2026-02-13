// app/api/admin/backup/route.ts
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function nowStamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function looksLikeMissingTableOrColumn(msg: string) {
  return /does not exist/i.test(msg) || /column .* does not exist/i.test(msg) || /relation .* does not exist/i.test(msg);
}

function getAdminClient(): SupabaseClient<any> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;

  return createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function fetchAll(admin: SupabaseClient<any>, table: string) {
  const pageSize = 1000;
  let from = 0;
  const all: any[] = [];

  while (true) {
    const { data, error } = await admin.from(table).select('*').range(from, from + pageSize - 1);

    if (error) {
      // テーブル/列が無い環境差は “空” 扱い（バックアップ自体を止めない）
      if (looksLikeMissingTableOrColumn(error.message)) return [];
      throw new Error(`${table}: ${error.message}`);
    }

    all.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export async function GET(req: Request) {
  try {
    const admin = getAdminClient();
    if (!admin) {
      return json(500, {
        ok: false,
        message: 'SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel環境変数を確認してください）。',
      });
    }

    // ✅ ADMIN_API_KEY による保護（Clerkに依存しない）
    const expected = process.env.ADMIN_API_KEY || '';
    if (!expected) {
      return json(500, { ok: false, message: 'ADMIN_API_KEY が未設定です（Vercel環境変数を確認してください）。' });
    }

    const urlObj = new URL(req.url);
    const tokenFromQuery = urlObj.searchParams.get('token') || '';
    const tokenFromHeader = req.headers.get('x-admin-token') || '';

    if (tokenFromQuery !== expected && tokenFromHeader !== expected) {
      return json(401, { ok: false, message: '管理者トークンが必要です。' });
    }

    const tables = [
      'players',
      'players_private',
      'tournaments',
      'tournament_entries',
      'matches',
      'match_entries',
      'league_blocks',
      'league_block_members',
      'final_brackets',
      'final_matches',
    ];

    const backup: Record<string, any> = {
      ok: true,
      meta: {
        created_at: new Date().toISOString(),
        via: 'admin_token',
        tables,
      },
      data: {},
    };

    for (const t of tables) {
      (backup.data as any)[t] = await fetchAll(admin, t);
    }

    const filename = `backup-${nowStamp()}.json`;
    return new NextResponse(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (e: any) {
    return json(500, { ok: false, message: e?.message ?? 'backup failed' });
  }
}
