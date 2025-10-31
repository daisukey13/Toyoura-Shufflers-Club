import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Round1 の試合を生成する
 * - tournament_participants から seed 順に対戦カードを作成
 * - matches に player_a_id / player_b_id を確実に埋めて登録
 */
export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const tournamentId = params.id;

  // --- 大会情報 ---
  const { data: t, error: te } = await supabase
    .from('tournaments')
    .select('id, mode, size, point_cap')
    .eq('id', tournamentId)
    .single();
  if (te || !t) {
    return NextResponse.json({ error: 'tournament not found' }, { status: 404 });
  }

  // --- 参加者 ---
  const { data: parts, error: pe } = await supabase
    .from('tournament_participants')
    .select('player_id, team_id, seed')
    .eq('tournament_id', tournamentId)
    .order('seed', { ascending: true });
  if (pe) return NextResponse.json({ error: pe.message }, { status: 400 });

  if (!parts?.length) {
    return NextResponse.json({ error: 'no participants' }, { status: 400 });
  }

  // --- Round1 マッチ生成 ---
  const pairCount = Math.floor(parts.length / 2);
  const inserts: any[] = [];
  for (let i = 0; i < pairCount; i++) {
    const a = parts[i * 2];
    const b = parts[i * 2 + 1];

    inserts.push({
      tournament_id: tournamentId,
      round: 1,
      match_no: i + 1,
      status: 'pending',
      mode: t.mode,
      winner_score: null,
      loser_score: null,
      player_a_id: t.mode === 'singles' ? a.player_id : null,
      player_b_id: t.mode === 'singles' ? b.player_id : null,
      team_a_id: t.mode === 'teams' ? a.team_id : null,
      team_b_id: t.mode === 'teams' ? b.team_id : null,
    });
  }

  const { error: ie } = await supabase.from('matches').insert(inserts);
  if (ie) return NextResponse.json({ error: ie.message }, { status: 400 });

  return NextResponse.json({ ok: true, created: inserts.length });
}
