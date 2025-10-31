import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const tRes = await supabase.from('tournaments').select('*').eq('id', params.id).single();
  if (tRes.error || !tRes.data) return NextResponse.json({ error: tRes.error?.message ?? 'not found' }, { status: 404 });
  const t = tRes.data;

  const { data: ms, error: me } = await supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', params.id)
    .order('round', { ascending: true })
    .order('match_no', { ascending: true });
  if (me) return NextResponse.json({ error: me.message }, { status: 400 });

  // 参加者→名前/アバター解決
  const { data: parts } = await supabase
    .from('tournament_participants')
    .select('player_id, team_id, seed')
    .eq('tournament_id', params.id);

  const playerIds = Array.from(
    new Set(
      (parts ?? [])
        .map((p: any) => p.player_id)
        .concat((ms ?? []).flatMap((m: any) => [m.player_a_id, m.player_b_id]))
        .filter(Boolean)
    )
  );
  const teamIds = Array.from(
    new Set(
      (parts ?? [])
        .map((p: any) => p.team_id)
        .concat((ms ?? []).flatMap((m: any) => [m.team_a_id, m.team_b_id]))
        .filter(Boolean)
    )
  );

  const players = playerIds.length
    ? (await supabase.from('players').select('id,handle_name,avatar_url').in('id', playerIds)).data ?? []
    : [];
  const teams = teamIds.length
    ? (await supabase.from('teams').select('id,name').in('id', teamIds)).data ?? []
    : [];

  const pMap = new Map(players.map((p: any) => [p.id, p]));
  const tmMap = new Map(teams.map((x: any) => [x.id, x]));
  const label = (id?: string | null) => {
    if (!id) return null;
    const p = pMap.get(id); if (p) return { name: p.handle_name ?? '—', avatar: p.avatar_url ?? '/default-avatar.png', kind: 'player' as const };
    const tm = tmMap.get(id); if (tm) return { name: tm.name ?? '—', avatar: null, kind: 'team' as const };
    return { name: '—', avatar: null, kind: 'unknown' as const };
  };

  const rounds: Record<number, any[]> = {};
  for (const m of ms ?? []) {
    const r = Number(m.round) || 1;
    if (!rounds[r]) rounds[r] = [];
    const a_id = (m as any).player_a_id ?? (m as any).team_a_id ?? null;
    const b_id = (m as any).player_b_id ?? (m as any).team_b_id ?? null;
    rounds[r].push({
      id: m.id,
      match_no: m.match_no,
      status: m.status,
      mode: m.mode,
      a_id, b_id,
      a: label(a_id), b: label(b_id),
      score: m.winner_id ? { winner_id: m.winner_id, winner_score: m.winner_score, loser_score: m.loser_score } : null,
    });
  }

  return NextResponse.json({
    tournament: {
      id: t.id, name: t.name, start_date: t.start_date, mode: t.mode, size: t.size,
      best_of: t.best_of, point_cap: t.point_cap, apply_handicap: t.apply_handicap
    },
    rounds,
  });
}
