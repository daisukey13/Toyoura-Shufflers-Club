// app/api/matches/feed/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MatchRow = {
  id: string;
  mode: string | null;
  status: string | null;
  match_date: string;
  winner_id: string | null;
  loser_id: string | null;
  winner_score: number | null;
  loser_score: number | null;
  // いくつかのスキーマ差異を吸収
  winner_points_delta?: number | null;
  loser_points_delta?: number | null;
  winner_handicap_delta?: number | null;
  loser_handicap_delta?: number | null;
  winner_rp_delta?: number | null;
  loser_rp_delta?: number | null;
  winner_hc_delta?: number | null;
  loser_hc_delta?: number | null;
  rating_applied?: boolean | null;
};

type PlayerRow = {
  id: string;
  handle_name: string | null;
  avatar_url?: string | null;
  ranking_points?: number | null;
  handicap?: number | null;
};

type MPRow = {
  match_id: string;
  player_id?: string | null;
  side_no?: number | null;
  rp_delta?: number | null;
  hc_delta?: number | null;
  ranking_points_delta?: number | null;
  handicap_delta?: number | null;
};

function pickFirstNumber(...vals: (number | null | undefined)[]) {
  for (const v of vals) if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!url || !anon) {
      return NextResponse.json({ ok: false, message: 'Supabase env missing' }, { status: 500 });
    }

    const limit = Math.max(1, Math.min(100, Number(req.nextUrl.searchParams.get('limit') || 30)));

    const cookieStore = cookies();
    const client = createServerClient(url, anon, {
      cookies: {
        get: (n: string) => cookieStore.get(n)?.value,
        set: (n: string, v: string, o?: any) => cookieStore.set({ name: n, value: v, ...(o || {}) } as any),
        remove: (n: string, o?: any) => cookieStore.set({ name: n, value: '', ...(o || {}) } as any),
      },
    } as any);

    // 1) matches を取得
    const { data: matches, error: mErr } = await client
      .from('matches')
      .select(`
        id, mode, status, match_date,
        winner_id, loser_id,
        winner_score, loser_score,
        winner_points_delta, loser_points_delta,
        winner_handicap_delta, loser_handicap_delta,
        winner_rp_delta, loser_rp_delta,
        winner_hc_delta, loser_hc_delta,
        rating_applied
      `)
      .order('match_date', { ascending: false })
      .limit(limit);

    if (mErr) return NextResponse.json({ ok: false, message: mErr.message }, { status: 400 });

    const mids = Array.from(new Set((matches ?? []).map(m => m.id)));
    const pids = Array.from(
      new Set(
        (matches ?? [])
          .flatMap(m => [m.winner_id, m.loser_id])
          .filter(Boolean) as string[]
      )
    );

    // 2) players をまとめて取得（現在値 = “試合後”値）
    const { data: players } = await client
      .from('players')
      .select('id, handle_name, avatar_url, ranking_points, handicap')
      .in('id', pids);

    const pMap = new Map<string, PlayerRow>();
    (players ?? []).forEach(p => pMap.set(p.id, p));

    // 3) match_players（あれば）を取得 → delta を優先的にここから採用
    let mpRows: MPRow[] = [];
    try {
      const { data: mps, error: mpErr } = await client
        .from('match_players')
        .select('match_id, player_id, side_no, rp_delta, hc_delta, ranking_points_delta, handicap_delta')
        .in('match_id', mids);

      if (!mpErr && Array.isArray(mps)) mpRows = mps as MPRow[];
    } catch {
      // テーブルが無い等は無視（matches 側の冗長カラムで補う）
    }

    // match_id + player_id / side_no の双方で引けるように index を構築
    const mpByMatchPlayer = new Map<string, MPRow>();
    const mpByMatchSide = new Map<string, MPRow>();
    for (const r of mpRows) {
      if (r.match_id && r.player_id) mpByMatchPlayer.set(`${r.match_id}:${r.player_id}`, r);
      if (r.match_id && r.side_no != null) mpByMatchSide.set(`${r.match_id}:${r.side_no}`, r);
    }

    // 4) 整形
    const items = (matches ?? []).map((m: MatchRow) => {
      const wid = m.winner_id || '';
      const lid = m.loser_id || '';
      const wP = pMap.get(wid || '') || ({} as PlayerRow);
      const lP = pMap.get(lid || '') || ({} as PlayerRow);

      // match_players 優先で delta を拾う
      const mpW = mpByMatchPlayer.get(`${m.id}:${wid}`) || mpByMatchSide.get(`${m.id}:1`);
      const mpL = mpByMatchPlayer.get(`${m.id}:${lid}`) || mpByMatchSide.get(`${m.id}:2`);

      const wRpDelta = pickFirstNumber(mpW?.rp_delta, mpW?.ranking_points_delta, m.winner_points_delta, m.winner_rp_delta) ?? 0;
      const lRpDelta = pickFirstNumber(mpL?.rp_delta, mpL?.ranking_points_delta, m.loser_points_delta, m.loser_rp_delta) ?? 0;
      const wHcDelta = pickFirstNumber(mpW?.hc_delta, mpW?.handicap_delta, m.winner_handicap_delta, m.winner_hc_delta) ?? 0;
      const lHcDelta = pickFirstNumber(mpL?.hc_delta, mpL?.handicap_delta, m.loser_handicap_delta, m.loser_hc_delta) ?? 0;

      // rating_applied が null の場合は、delta が両方 0 なら false、どちらか非0なら true と推定
      const ratingApplied =
        typeof m.rating_applied === 'boolean'
          ? m.rating_applied
          : (wRpDelta !== 0 || lRpDelta !== 0 || wHcDelta !== 0 || lHcDelta !== 0);

      const wAfterRP = typeof wP.ranking_points === 'number' ? wP.ranking_points : null;
      const lAfterRP = typeof lP.ranking_points === 'number' ? lP.ranking_points : null;
      const wAfterHC = typeof wP.handicap === 'number' ? wP.handicap : null;
      const lAfterHC = typeof lP.handicap === 'number' ? lP.handicap : null;

      const wBeforeRP = wAfterRP == null ? null : (ratingApplied ? wAfterRP - wRpDelta : wAfterRP);
      const lBeforeRP = lAfterRP == null ? null : (ratingApplied ? lAfterRP - lRpDelta : lAfterRP);
      const wBeforeHC = wAfterHC == null ? null : (ratingApplied ? wAfterHC - wHcDelta : wAfterHC);
      const lBeforeHC = lAfterHC == null ? null : (ratingApplied ? lAfterHC - lHcDelta : lAfterHC);

      return {
        match_id: m.id,
        mode: m.mode,
        match_date: m.match_date,
        score: { winner: m.winner_score ?? 15, loser: m.loser_score ?? 0, diff: (m.winner_score ?? 15) - (m.loser_score ?? 0) },
        rating_applied: ratingApplied,
        winner: {
          id: wid,
          handle_name: wP.handle_name ?? null,
          avatar_url: wP.avatar_url ?? null,
          rp_after: wAfterRP, rp_before: wBeforeRP, rp_delta: wRpDelta,
          hc_after: wAfterHC, hc_before: wBeforeHC, hc_delta: wHcDelta,
        },
        loser: {
          id: lid,
          handle_name: lP.handle_name ?? null,
          avatar_url: lP.avatar_url ?? null,
          rp_after: lAfterRP, rp_before: lBeforeRP, rp_delta: lRpDelta,
          hc_after: lAfterHC, hc_before: lBeforeHC, hc_delta: lHcDelta,
        },
      };
    });

    return NextResponse.json({ ok: true, items }, { status: 200 });
  } catch (e: any) {
    console.error('[api/matches/feed] fatal:', e);
    return NextResponse.json({ ok: false, message: 'Server error' }, { status: 500 });
  }
}
