// app/api/admin/backup/route.ts
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';

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

async function isAdminByFallback(admin: SupabaseClient<any>, userId: string): Promise<boolean> {
  // 1) players_private.is_admin
  try {
    const { data, error } = await admin
      .from('players_private')
      .select('is_admin')
      .eq('player_id', userId)
      .maybeSingle();

    if (!error) return !!(data as any)?.is_admin;
    if (!looksLikeMissingTableOrColumn(error.message)) return false;
  } catch {
    // next
  }

  // 2) players.is_admin fallback
  try {
    const { data, error } = await admin.from('players').select('id,is_admin').eq('id', userId).maybeSingle();
    if (error) return false;
    return !!(data as any)?.is_admin;
  } catch {
    return false;
  }
}

async function fetchAll(admin: SupabaseClient<any>, table: string) {
  // 大きいテーブルでも落ちないようにページング
  const pageSize = 1000;
  let from = 0;
  const all: any[] = [];

  // テーブルが存在しない dev/prod 差異もあり得るので、存在しない場合は空で返す
  while (true) {
    const { data, error } = await admin.from(table).select('*').range(from, from + pageSize - 1);
    if (error) {
      // テーブルが無い等は “空” 扱い（バックアップを止めない）
      if (looksLikeMissingTableOrColumn(error.message)) return [];
      throw new Error(`${table}: ${error.message}`);
    }
    all.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export async function GET() {
  try {
    const admin = getAdminClient();
    if (!admin) {
      return json(500, { ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel環境変数を確認してください）。' });
    }

    // ✅ 誰が呼んだかは Clerk で判定（Supabase Auth cookie に依存しない）
    const { userId } = await auth();
    if (!userId) return json(401, { ok: false, message: 'ログインしてください（Clerk）。' });

    const okAdmin = await isAdminByFallback(admin, userId);
    if (!okAdmin) return json(403, { ok: false, message: '管理者権限がありません。' });

    // ✅ ここはあなたの既存バックアップ対象に合わせて増減OK（UIには影響なし）
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
        by_user_id: userId,
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
