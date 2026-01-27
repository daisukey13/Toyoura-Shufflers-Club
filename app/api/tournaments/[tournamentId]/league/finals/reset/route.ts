// app/api/tournaments/[tournamentId]/league/finals/reset/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tournamentId: string }> } | { params: { tournamentId: string } };

async function readTournamentId(ctx: Ctx): Promise<string> {
  try {
    const p: any = await (ctx as any).params;
    return String(p?.tournamentId ?? '').trim();
  } catch {
    return '';
  }
}

async function isAdminPlayer(playerId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('players').select('is_admin').eq('id', playerId).maybeSingle();
  return Boolean(data?.is_admin);
}

function isMissingRelationOrColumn(err: any) {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '').toLowerCase();
  // 42P01: relation does not exist / 42703: column does not exist など
  return code === '42P01' || code === '42703' || msg.includes('does not exist') || msg.includes('schema cache');
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const tournamentId = await readTournamentId(ctx);
  return NextResponse.json(
    { ok: true, route: '/api/tournaments/[tournamentId]/league/finals/reset', tournamentId },
    { status: 200 },
  );
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const tournamentId = await readTournamentId(ctx);
    if (!tournamentId) {
      return NextResponse.json({ ok: false, message: 'tournamentId が不正です。' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ ok: false, message: 'Supabase 環境変数が未設定です。' }, { status: 500 });
    }

    // ✅ 認証（ブラウザのCookieが必要。curlだと401になるのは正常）
    const cookieStore = await cookies();
    const supa = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // noop
          }
        },
      },
    });

    const { data: userData, error: userErr } = await supa.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, message: '認証が必要です。' }, { status: 401 });
    }

    // ✅ 管理者のみ
    const me = userData.user.id;
    const admin = await isAdminPlayer(me);
    if (!admin) {
      return NextResponse.json({ ok: false, message: '管理者のみ実行できます。' }, { status: 403 });
    }

    // --- ここから削除本体（Service Role = supabaseAdmin） ---
    // 1) まず bracket を拾う
    let bracketIds: string[] = [];
    {
      const r = await supabaseAdmin.from('final_brackets').select('id').eq('tournament_id', tournamentId);
      if (r.error) {
        if (isMissingRelationOrColumn(r.error)) {
          // テーブルが無い環境なら「削除対象なし」でOK返す
          return NextResponse.json(
            { ok: true, message: 'final_brackets が存在しないため、削除対象はありません。', deleted: { brackets: 0, entries: 0 } },
            { status: 200 },
          );
        }
        throw r.error;
      }
      bracketIds = (r.data ?? []).map((x: any) => String(x.id));
    }

    if (bracketIds.length === 0) {
      return NextResponse.json(
        { ok: true, message: '決勝トーナメントは存在しません（削除対象なし）。', deleted: { brackets: 0, entries: 0 } },
        { status: 200 },
      );
    }

    // 2) entries（子）を先に消す
    let deletedEntries = 0;
    {
      const r = await supabaseAdmin.from('final_round_entries').delete().in('bracket_id', bracketIds).select('id');
      if (r.error) {
        if (!isMissingRelationOrColumn(r.error)) throw r.error;
      } else {
        deletedEntries = (r.data ?? []).length;
      }
    }

    // 3) bracket（親）を消す
    let deletedBrackets = 0;
    {
      const r = await supabaseAdmin.from('final_brackets').delete().eq('tournament_id', tournamentId).select('id');
      if (r.error) throw r.error;
      deletedBrackets = (r.data ?? []).length;
    }

    return NextResponse.json(
      {
        ok: true,
        message: '決勝トーナメント関連データを全削除しました。',
        deleted: { brackets: deletedBrackets, entries: deletedEntries },
      },
      { status: 200 },
    );
  } catch (e: any) {
    console.error('[league/finals/reset] error', e);
    return NextResponse.json({ ok: false, message: e?.message ?? 'unknown error' }, { status: 500 });
  }
}
