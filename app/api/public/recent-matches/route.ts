// app/api/public/recent-matches/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * 公開API：
 * - 基本は Service Role があればそれで取得（RLS/ビュー差に強い）
 * - 無ければ ANON で取得（RLS次第で取れないことはある）
 */
function getSupabase() {
  if (!SUPABASE_URL) throw new Error('Missing env: NEXT_PUBLIC_SUPABASE_URL');
  const key = SUPABASE_SERVICE || SUPABASE_ANON;
  if (!key) throw new Error('Missing env: SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY');

  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'tsc-public-recent-matches' } },
  });
}

function isFinished(m: any) {
  const status = (m?.status ?? '').toString().toLowerCase();
  if (status) {
    // プロジェクト内で status 名がブレても落ちないようにゆるめに判定
    if (['completed', 'complete', 'finished', 'done', 'confirmed', 'final'].includes(status)) return true;
    if (['pending', 'draft', 'canceled', 'cancelled'].includes(status)) return false;
    // 不明な status は下の条件にフォールバック
  }

  const hasSinglesSides = !!(m?.winner_id && m?.loser_id);
  const hasTeamSides = !!(m?.winner_team_id && m?.loser_team_id);
  const hasAnyScore = m?.loser_score != null || m?.winner_score != null;

  return (hasSinglesSides || hasTeamSides) && hasAnyScore;
}

export async function GET(req: Request) {
  try {
    const url = new globalThis.URL(req.url);
    const limitRaw = Number(url.searchParams.get('limit') || '6');
    const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 6));

    const supabase = getSupabase();

    // ① unified_match_feed をまず試す（個人/団体混在）
    let matches: any[] = [];
    {
      const u = await supabase
        .from('unified_match_feed')
        .select('*')
        .order('match_date', { ascending: false })
        .limit(limit);

      if (!u.error && Array.isArray(u.data)) {
        matches = u.data;
      }
    }

    // ② fallback: match_details_public（個人戦ビュー）
    if (!matches.length) {
      const r = await supabase
        .from('match_details_public')
        // ✅ notes は存在しないので select しない（今回のエラー原因）
        .select(
          [
            'id',
            'match_date',
            'is_tournament',
            'venue',
            'loser_score',
            'winner_id',
            'winner_name',
            'winner_avatar',
            'winner_current_points',
            'winner_current_handicap',
            'winner_points_change',
            'loser_id',
            'loser_name',
            'loser_avatar',
            'loser_current_points',
            'loser_current_handicap',
            'loser_points_change',
            'tournament_name',
          ].join(','),
        )
        .order('match_date', { ascending: false })
        .limit(limit);

      if (r.error) {
        return NextResponse.json({ ok: false, message: r.error.message }, { status: 400 });
      }

      matches = (r.data ?? []).map((m: any) => ({
        ...m,
        mode: 'singles',
        // UI 側は notes を参照しても落ちないように null を付与
        notes: null,
        // UI 側のフォールバックに合わせて *_avatar_url も作っておく
        winner_avatar_url: m?.winner_avatar ?? null,
        loser_avatar_url: m?.loser_avatar ?? null,
      }));
    }

    // ③ pending などを弾いて「最近の試合」らしいものだけにする
    const filtered = (matches ?? []).filter(isFinished).slice(0, limit);

    return NextResponse.json({ ok: true, matches: filtered });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message ?? 'unexpected error' },
      { status: 500 },
    );
  }
}
