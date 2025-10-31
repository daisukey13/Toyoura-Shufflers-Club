import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const body = await req.json().catch(() => ({}));
  const entries: Array<{ player_id?: string; team_id?: string; seed: number }> = body.entries ?? [];

  // 無効行排除
  const cleaned = entries
    .map((e) => ({ player_id: e.player_id ?? null, team_id: e.team_id ?? null, seed: Number(e.seed) || 0 }))
    .filter((e) => (e.player_id || e.team_id) && e.seed > 0);

  if (!cleaned.length) return NextResponse.json({ error: 'no valid entries' }, { status: 400 });

  // 既存参加者を一旦削除 → 入れ直し（単純で安全）
  const del = await supabase.from('tournament_participants').delete().eq('tournament_id', params.id);
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 400 });

  const payload = cleaned.map((e) => ({ tournament_id: params.id, player_id: e.player_id, team_id: e.team_id, seed: e.seed }));
  const { error } = await supabase.from('tournament_participants').insert(payload);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
