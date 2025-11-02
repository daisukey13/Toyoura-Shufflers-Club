// app/api/tournaments/[id]/bracket/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Tournament = {
  id: string;
  name: string;
  start_date: string | null;
  mode: 'singles' | 'teams';
  size: 4 | 8 | 16 | 32;
  best_of: 1 | 3;
  point_cap: number;
  apply_handicap: boolean;
};

type MatchRow = {
  id: string;
  tournament_id: string | null;
  round: number | null;
  match_no: number | null;
  status: 'scheduled' | 'playing' | 'finalized' | string;
  mode: 'singles' | 'teams' | string | null;
  a_id: string | null;
  b_id: string | null;
  winner_id: string | null;
  loser_id: string | null;
  winner_score: number | null;
  loser_score: number | null;
};

type PlayerRow = { id: string; handle_name: string | null; avatar_url: string | null };
type TeamRow   = { id: string; name: string | null; avatar_url: string | null };

function personCard(p?: PlayerRow | null) {
  if (!p) return null;
  return {
    name: p.handle_name ?? '(no name)',
    avatar: p.avatar_url ?? '/default-avatar.png',
    kind: 'player' as const,
  };
}
function teamCard(t?: TeamRow | null) {
  if (!t) return null;
  return {
    name: t.name ?? '(no name)',
    avatar: t.avatar_url ?? '/default-avatar.png',
    kind: 'team' as const,
  };
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const tid = params.id;

  // 1) 大会本体
  const { data: t, error: tErr } = await supabase
    .from('tournaments')
    .select('id,name,start_date,mode,size,best_of,point_cap,apply_handicap')
    .eq('id', tid)
    .maybeSingle<Tournament>();

  if (tErr) {
    return NextResponse.json({ error: 'fetch tournament failed', detail: tErr.message }, { status: 500 });
  }
  if (!t) {
    return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
  }

  // 2) 試合一覧（ここでは外部テーブルJOINを使わない）
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select(
      'id,tournament_id,round,match_no,status,mode,a_id,b_id,winner_id,loser_id,winner_score,loser_score'
    )
    .eq('tournament_id', tid)
    .order('round', { ascending: true })
    .order('match_no', { ascending: true })
    .returns<MatchRow[]>();

  if (mErr) {
    return NextResponse.json({ error: 'fetch matches failed', detail: mErr.message }, { status: 500 });
  }

  // 3) 参加者のメタをまとめて取得（プレイヤー or チーム）
  const idSet = new Set<string>();
  for (const m of matches ?? []) {
    if (m.a_id) idSet.add(m.a_id);
    if (m.b_id) idSet.add(m.b_id);
  }
  const ids = Array.from(idSet);

  let playerMap = new Map<string, PlayerRow>();
  let teamMap   = new Map<string, TeamRow>();

  if (ids.length > 0) {
    if (t.mode === 'singles') {
      const { data: ps, error: pErr } = await supabase
        .from('players')
        .select('id,handle_name,avatar_url')
        .in('id', ids)
        .returns<PlayerRow[]>();
      if (pErr) {
        // プレーヤーがなくてもAPIは返す（UI継続性を優先）
      } else if (ps) {
        for (const p of ps) playerMap.set(p.id, p);
      }
    } else {
      const { data: ts, error: tmErr } = await supabase
        .from('teams')
        .select('id,name,avatar_url')
        .in('id', ids)
        .returns<TeamRow[]>();
      if (tmErr) {
        // チームがなくてもAPIは返す
      } else if (ts) {
        for (const tm of ts) teamMap.set(tm.id, tm);
      }
    }
  }

  // 4) UI 期待形へ整形
  const rounds: Record<string, any[]> = {};
  for (const m of matches ?? []) {
    const a_id = m.a_id ?? null;
    const b_id = m.b_id ?? null;

    // a,b のカード
    let a = null, b = null;
    if (t.mode === 'singles') {
      a = a_id ? personCard(playerMap.get(a_id) ?? null) : null;
      b = b_id ? personCard(playerMap.get(b_id) ?? null) : null;
    } else {
      a = a_id ? teamCard(teamMap.get(a_id) ?? null) : null;
      b = b_id ? teamCard(teamMap.get(b_id) ?? null) : null;
    }

    // スコア表現（UIの互換性: {a: number|null, b: number|null} or null）
    let score: { a: number | null; b: number | null } | null = null;
    if (m.winner_score != null && m.loser_score != null && (m.a_id || m.b_id)) {
      const aSc =
        m.winner_id && m.a_id && m.winner_id === m.a_id
          ? m.winner_score
          : m.loser_id && m.a_id && m.loser_id === m.a_id
          ? m.loser_score
          : null;
      const bSc =
        m.winner_id && m.b_id && m.winner_id === m.b_id
          ? m.winner_score
          : m.loser_id && m.b_id && m.loser_id === m.b_id
          ? m.loser_score
          : null;

      // どちらも null でなければ採用（不整合時は null）
      score = aSc == null && bSc == null ? null : { a: aSc, b: bSc };
    }

    const roundKey = String(m.round ?? 1);
    (rounds[roundKey] ??= []).push({
      id: m.id,
      match_no: m.match_no ?? 0,
      status: m.status,
      mode: (m.mode as 'singles' | 'teams') ?? t.mode,
      a_id, // ← UIで必要
      b_id, // ← UIで必要
      a,    // ← { name, avatar, kind }
      b,
      score, // ← null or {a,b}
    });
  }

  return NextResponse.json({
    tournament: {
      id: t.id,
      name: t.name,
      start_date: t.start_date,
      mode: t.mode,
      size: t.size,
      best_of: t.best_of,
      point_cap: t.point_cap,
      apply_handicap: t.apply_handicap,
    },
    rounds,
  });
}
