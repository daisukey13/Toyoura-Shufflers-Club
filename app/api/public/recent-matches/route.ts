// app/api/public/recent-matches/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = Number.parseInt(v ?? '', 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

// “トップページに表示できる試合”だけを通す（DB差分に強い）
function isDisplayableMatch(m: any) {
  const status = String(m?.status ?? '').toLowerCase();
  if (status === 'pending' || status === 'draft') return false;

  // loser_score が入っていれば表示の体裁が成立しやすい
  if (m?.loser_score === null || m?.loser_score === undefined) return false;

  const mode = String(m?.mode ?? '').toLowerCase();
  const isTeam =
    mode === 'teams' ||
    !!m?.winner_team_id ||
    !!m?.loser_team_id ||
    !!m?.winner_team_name ||
    !!m?.loser_team_name;

  if (isTeam) {
    const wOk = !!(m?.winner_team_id || m?.winner_team_name);
    const lOk = !!(m?.loser_team_id || m?.loser_team_name);
    return wOk && lOk;
  }

  // 個人戦は勝者/敗者が揃っていればOK
  return !!(m?.winner_id && m?.loser_id);
}

export async function GET(request: NextRequest) {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { ok: false, message: 'Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' },
        { status: 500 },
      );
    }

    const limit = clampInt(request.nextUrl.searchParams.get('limit'), 6, 1, 20);
    const take = Math.max(limit * 6, 30);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // 1) unified_match_feed（個人/団体混在）
    const feed = await admin
      .from('unified_match_feed')
      .select('*')
      .order('match_date', { ascending: false })
      .limit(take);

    if (!feed.error && feed.data) {
      const completed = (feed.data as any[]).filter(isDisplayableMatch).slice(0, limit);
      if (completed.length > 0) {
        return NextResponse.json({ ok: true, matches: completed }, { headers: { 'Cache-Control': 'no-store' } });
      }

      // 2) フォールバック: match_details（個人戦ビュー）
      const md = await admin.from('match_details').select('*').order('match_date', { ascending: false }).limit(take);
      if (!md.error && md.data) {
        const completed2 = (md.data as any[]).filter(isDisplayableMatch).slice(0, limit);
        if (completed2.length > 0) {
          return NextResponse.json(
            { ok: true, matches: completed2.map((m: any) => ({ ...m, mode: m?.mode ?? 'singles' })) },
            { headers: { 'Cache-Control': 'no-store' } },
          );
        }
      }

      // 3) それでも0件なら “とりあえず最新を返す”（pending しか無い環境の救済）
      return NextResponse.json(
        { ok: true, matches: (feed.data as any[]).slice(0, limit), note: 'no displayable matches found' },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // unified_match_feed が無い/壊れてる場合
    const md = await admin.from('match_details').select('*').order('match_date', { ascending: false }).limit(take);
    if (md.error) {
      return NextResponse.json({ ok: false, message: md.error.message }, { status: 500 });
    }

    const completed = (md.data as any[]).filter(isDisplayableMatch).slice(0, limit);
    return NextResponse.json(
      { ok: true, matches: (completed.length ? completed : (md.data as any[]).slice(0, limit)).map((m: any) => ({ ...m, mode: m?.mode ?? 'singles' })) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: String(e?.message ?? e ?? 'unknown') }, { status: 500 });
  }
}
