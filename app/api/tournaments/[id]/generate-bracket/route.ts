import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  // 参加者（seed昇順）
  const { data: parts, error: pe } = await supabase
    .from('tournament_participants')
    .select('player_id,team_id,seed')
    .eq('tournament_id', params.id)
    .order('seed', { ascending: true });

  if (pe) return NextResponse.json({ error: pe.message }, { status: 400 });

  const list = (parts ?? []).filter((p) => p.player_id || p.team_id);
  if (list.length < 2) return NextResponse.json({ error: 'need >= 2 participants' }, { status: 400 });

  // 既存R1を消して作り直し（安全）
  await supabase.from('matches').delete().eq('tournament_id', params.id).eq('round', 1);

  // シードを 1vsN, 2vsN-1… の組合せにする
  const pairs: Array<[any, any]> = [];
  for (let i = 0; i < Math.floor(list.length / 2); i++) pairs.push([list[i], list[list.length - 1 - i]]);
  if (list.length % 2 === 1) pairs.push([list[Math.floor(list.length / 2)], null]); // 不戦勝（相手なし）

  const rows = pairs.map(([A, B], idx) => {
    const base: any = {
      id: crypto.randomUUID(),
      tournament_id: params.id,
      round: 1,
      match_no: idx + 1,
      mode: 'singles',
      status: 'scheduled',
    };
    if (A?.player_id) base.player_a_id = A.player_id;
    if (B?.player_id) base.player_b_id = B?.player_id ?? null;
    if (A?.team_id) base.team_a_id = A.team_id;
    if (B?.team_id) base.team_b_id = B?.team_id ?? null;
    return base;
  });

  const { error: ie } = await supabase.from('matches').insert(rows);
  if (ie) return NextResponse.json({ error: ie.message }, { status: 400 });

  return NextResponse.json({ ok: true, created: rows.length }, { status: 201 });
}
