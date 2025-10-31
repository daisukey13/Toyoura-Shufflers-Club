// app/api/matches/[id]/report/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const matchId = params.id;

  // 受信ボディ
  const body = await req.json().catch(() => null) as {
    winner_id?: string;
    loser_id?: string;
    loser_score?: number;
    a_id?: string; // 画面側が分かっているときだけ送る（任意）
    b_id?: string;
  } | null;

  if (!body?.winner_id || !body?.loser_id || typeof body.loser_score !== 'number') {
    return NextResponse.json(
      { error: 'invalid body: require winner_id, loser_id, loser_score(number)' },
      { status: 400 }
    );
  }

  // 試合取得
  const { data: m, error: me } = await supabase
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .single();

  if (me || !m) {
    return NextResponse.json({ error: 'match not found' }, { status: 404 });
  }

  // point cap 取得（大会があれば優先）
  let pointCap = 15;
  if (m.tournament_id) {
    const { data: t } = await supabase
      .from('tournaments')
      .select('point_cap')
      .eq('id', m.tournament_id)
      .single();
    if (t?.point_cap && Number.isFinite(t.point_cap)) pointCap = Number(t.point_cap);
  }

  // 敗者スコアを安全化
  let loserScore = Math.floor(Number(body.loser_score));
  if (!Number.isFinite(loserScore) || loserScore < 0) loserScore = 0;
  if (loserScore >= pointCap) loserScore = pointCap - 1;

  // モード
  const mode: 'singles' | 'teams' = m.mode === 'teams' ? 'teams' : 'singles';

  // A/B の ID を決定（matches に無ければ body の a_id / b_id で補完）
  const aOnMatch =
    mode === 'singles'
      ? (m as any).player_a_id ?? body.a_id
      : (m as any).team_a_id ?? body.a_id;

  const bOnMatch =
    mode === 'singles'
      ? (m as any).player_b_id ?? body.b_id
      : (m as any).team_b_id ?? body.b_id;

  if (!aOnMatch || !bOnMatch) {
    // ここで止める理由は「A/B どちらか欠けていると winner/loser の正当性確認ができない」ため
    return NextResponse.json(
      {
        error: 'entries incomplete',
        detail: `match ${matchId} needs both A and B ids`,
        need: { a_id_missing: !aOnMatch, b_id_missing: !bOnMatch },
      },
      { status: 400 }
    );
  }

  // winner/loser が A/B に含まれているか検証
  const idsOnCard = new Set([String(aOnMatch), String(bOnMatch)]);
  if (!idsOnCard.has(String(body.winner_id)) || !idsOnCard.has(String(body.loser_id))) {
    return NextResponse.json(
      {
        error: 'winner/loser not on this match card',
        detail: { aOnMatch, bOnMatch, received: { winner_id: body.winner_id, loser_id: body.loser_id } },
      },
      { status: 400 }
    );
  }
  if (body.winner_id === body.loser_id) {
    return NextResponse.json({ error: 'winner and loser must be different' }, { status: 400 });
  }

  // 更新パッチ（足りない A/B はここで補完して保存）
  const patch: any = {
    winner_id: body.winner_id,
    loser_id: body.loser_id,
    winner_score: pointCap,
    loser_score: loserScore,
    status: 'finalized', // 制約: matches_status_check が 'pending' | 'finalized' を許容
    updated_at: new Date().toISOString(),
  };

  if (mode === 'singles') {
    if (!(m as any).player_a_id) patch.player_a_id = aOnMatch;
    if (!(m as any).player_b_id) patch.player_b_id = bOnMatch;
  } else {
    // もし teams モードに移行したらこちら
    if (!(m as any).team_a_id) patch.team_a_id = aOnMatch;
    if (!(m as any).team_b_id) patch.team_b_id = bOnMatch;
  }

  const { error: ue } = await supabase.from('matches').update(patch).eq('id', matchId);
  if (ue) {
    // ここで DB 制約や RLS で落ちた場合に詳細を返す
    return NextResponse.json(
      { error: 'update failed', detail: ue.message, patch, matchId },
      { status: 400 }
    );
  }

  // 次ラウンドへ勝者を流し込み（存在する場合のみ）
  try {
    if (m.tournament_id && Number.isFinite(m.round) && Number.isFinite(m.match_no)) {
      const nextRound = Number(m.round) + 1;
      const nextNo = Math.ceil(Number(m.match_no) / 2);
      const goesToA = (Number(m.match_no) % 2) === 1; // 奇数→A, 偶数→B

      const { data: nextMatch } = await supabase
        .from('matches')
        .select('id, mode, player_a_id, player_b_id')
        .eq('tournament_id', m.tournament_id)
        .eq('round', nextRound)
        .eq('match_no', nextNo)
        .single();

      if (nextMatch?.id) {
        if ((nextMatch as any).mode === 'teams') {
          // 将来 teams 対応に備えた雛形（今回は singles 想定）
          const payload: any = goesToA ? { team_a_id: body.winner_id } : { team_b_id: body.winner_id };
          await supabase.from('matches').update(payload).eq('id', nextMatch.id);
        } else {
          const payload: any = goesToA ? { player_a_id: body.winner_id } : { player_b_id: body.winner_id };
          await supabase.from('matches').update(payload).eq('id', nextMatch.id);
        }
      }
    }
  } catch {
    // R2 未生成などは無視
  }

  return NextResponse.json({ ok: true });
}
