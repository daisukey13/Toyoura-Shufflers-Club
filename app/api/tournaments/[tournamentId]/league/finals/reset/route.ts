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

function looksMissingColumn(err: any) {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes('schema cache') || (msg.includes('column') && msg.includes('does not exist'));
}

function looksMissingTable(err: any) {
  // Supabase/PostgREST: undefined_table は 42P01 が多い
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '').toLowerCase();
  return code === '42P01' || msg.includes('relation') && msg.includes('does not exist');
}

// finals の matches を「なるべく正確に」拾う（列差分があっても動くように段階フォールバック）
async function selectFinalMatchIds(tournamentId: string): Promise<string[]> {
  // 1) stage='finals' がある環境
  {
    const r = await supabaseAdmin.from('matches').select('id').eq('tournament_id', tournamentId).eq('stage', 'finals');
    if (!r.error) return (r.data ?? []).map((x: any) => String(x.id));
    if (r.error && !looksMissingColumn(r.error)) {
      // stage列以外の理由で落ちてるならそのまま諦めて次へ
    }
  }

  // 2) kind='finals' / match_type='finals' などがある環境（どれか当たればOK）
  for (const col of ['kind', 'match_type', 'bracket_type', 'phase']) {
    const r = await supabaseAdmin.from('matches').select('id').eq('tournament_id', tournamentId).eq(col as any, 'finals');
    if (!r.error) return (r.data ?? []).map((x: any) => String(x.id));
    if (r.error && looksMissingColumn(r.error)) continue;
  }

  // 3) 最終フォールバック：リーグは league_block_id が入る前提なので、NULL のものを finals 扱い
  {
    const r = await supabaseAdmin
      .from('matches')
      .select('id')
      .eq('tournament_id', tournamentId)
      .is('league_block_id', null);

    if (!r.error) return (r.data ?? []).map((x: any) => String(x.id));
  }

  return [];
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

    // cookie auth（管理者チェック用）
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ ok: false, message: 'Supabase 環境変数が未設定です。' }, { status: 500 });
    }

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

    const requesterId = userData.user.id;
    const admin = await isAdminPlayer(requesterId);
    if (!admin) {
      return NextResponse.json({ ok: false, message: '管理者のみ実行できます。' }, { status: 403 });
    }

    // 1) finals の matchIds を拾う
    const matchIds = await selectFinalMatchIds(tournamentId);

    // 2) match_entries を先に削除（存在しない環境でも止めない）
    if (matchIds.length > 0) {
      const me = await supabaseAdmin.from('match_entries').delete().in('match_id', matchIds);
      if (me.error && !looksMissingTable(me.error)) {
        return NextResponse.json({ ok: false, message: `match_entries 削除に失敗: ${me.error.message}` }, { status: 500 });
      }
    }

    // 3) matches を削除
    if (matchIds.length > 0) {
      const md = await supabaseAdmin.from('matches').delete().in('id', matchIds);
      if (md.error) {
        return NextResponse.json({ ok: false, message: `matches 削除に失敗: ${md.error.message}` }, { status: 500 });
      }
    }

    // 4) finals 専用テーブルがある環境も考慮（あれば消す。無ければ無視）
    //    409 の原因が「finals header テーブル」なことが多いので、ここが効きます。
    for (const table of ['tournament_finals', 'finals', 'tournament_final_brackets', 'tournament_brackets']) {
      const r = await supabaseAdmin.from(table as any).delete().eq('tournament_id', tournamentId);
      if (r.error && !looksMissingTable(r.error)) {
        // 存在するテーブルで削除に失敗した場合だけ止める
        return NextResponse.json({ ok: false, message: `${table} 削除に失敗: ${r.error.message}` }, { status: 500 });
      }
    }

    return NextResponse.json(
      {
        ok: true,
        message: '決勝トーナメント関連データを全削除しました。',
        deleted: { matches: matchIds.length },
      },
      { status: 200 },
    );
  } catch (e: any) {
    console.error('[finals/reset] fatal:', e);
    return NextResponse.json({ ok: false, message: e?.message || 'サーバエラーが発生しました。' }, { status: 500 });
  }
}

