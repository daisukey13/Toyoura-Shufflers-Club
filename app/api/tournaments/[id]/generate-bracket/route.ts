// app/api/tournaments/[id]/generate-bracket/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Tournament = {
  id: string;
  name: string;
  mode: 'singles' | 'teams';
  size: 4 | 8 | 16 | 32;
  best_of: 1 | 3;
  point_cap: number;
  apply_handicap: boolean;
};

type Participant = {
  tournament_id: string;
  seed: number;
  player_id: string | null;
  team_id: string | null;
};

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const tid = params.id;

  // --- 0) reporter_id の決定（NOT NULL 環境に備える）
  const { data: auth } = await supabase.auth.getUser();
  const reporterId =
    auth?.user?.id ??
    process.env.SYSTEM_REPORTER_ID ??
    null;

  if (!reporterId) {
    // reporter_id が NOT NULL の環境だと確実に落ちるので明示に弾く
    return NextResponse.json(
      {
        error: 'missing reporter_id',
        detail:
          'ログインユーザーがいないため reporter_id を決定できません。環境変数 SYSTEM_REPORTER_ID に既存ユーザーのUUIDを設定して再実行してください。',
      },
      { status: 422 }
    );
  }

  // --- 1) 大会本体
  const { data: t, error: tErr } = await supabase
    .from('tournaments')
    .select('id,name,mode,size,best_of,point_cap,apply_handicap')
    .eq('id', tid)
    .maybeSingle<Tournament>();

  if (tErr) {
    return NextResponse.json(
      { error: 'fetch tournament failed', detail: tErr.message },
      { status: 500 }
    );
  }
  if (!t) {
    return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
  }

  // --- 2) 参加者取得（seed 昇順）
  const { data: parts, error: pErr } = await supabase
    .from('tournament_participants')
    .select('tournament_id,seed,player_id,team_id')
    .eq('tournament_id', tid)
    .order('seed', { ascending: true })
    .returns<Participant[]>();

  if (pErr) {
    return NextResponse.json(
      { error: 'fetch participants failed', detail: pErr.message },
      { status: 500 }
    );
  }

  // 有効行のみ（modeに応じて片側必須）
  const valid = (parts ?? []).filter((r) =>
    t.mode === 'singles' ? !!r.player_id : !!r.team_id
  );

  if (valid.length < 2) {
    return NextResponse.json(
      { error: 'not enough participants', detail: '2名(組)以上が必要です' },
      { status: 400 }
    );
  }

  // --- 3) ラウンド1のペアリング（1vsN、2vsN-1、…）
  const N = Math.min(t.size, valid.length);
  const seeded = valid
    .slice(0, N)
    .sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));

  const pairings: Array<{ a_id: string; b_id: string; match_no: number }> = [];
  for (let i = 0; i < Math.floor(N / 2); i++) {
    const high = seeded[i];
    const low = seeded[N - 1 - i];
    const a_id = (t.mode === 'singles' ? high.player_id : high.team_id)!;
    const b_id = (t.mode === 'singles' ? low.player_id : low.team_id)!;
    pairings.push({ a_id, b_id, match_no: i + 1 });
  }

  // --- 4) 既存のラウンド1を削除（安全にやり直せるように）
  {
    const { error: delErr } = await supabase
      .from('matches')
      .delete()
      .eq('tournament_id', tid)
      .eq('round', 1);

    if (delErr) {
      return NextResponse.json(
        { error: 'cleanup failed', detail: delErr.message },
        { status: 500 }
      );
    }
  }

  // --- 5) INSERT 用レコード作成（制約を満たす最小カラム）
  const now = new Date().toISOString();

  const rows = pairings.map((p) => ({
    // 重要フィールド
    tournament_id: tid,
    is_tournament: true,
    tournament_name: t.name,
    mode: t.mode,
    status: 'scheduled',
    round: 1,
    match_no: p.match_no,
    a_id: p.a_id,
    b_id: p.b_id,

    // 既存チェックに配慮（winner 決まってないが point_cap を便宜上 winner_score デフォルトに）
    winner_id: null,
    loser_id: null,
    winner_score: t.point_cap ?? 15,
    loser_score: null,

    // メタ（NULL 許可の想定。NOT NULL の可能性があるものは埋める）
    match_date: now,
    played_at: now,
    is_verified: true,

    // NOT NULL で落ちやすい代表格
    reporter_id: reporterId,
  }));

  // --- 6) 挿入
  const { data: inserted, error: insErr } = await supabase
    .from('matches')
    .insert(rows)
    .select('*');

  if (insErr) {
    return NextResponse.json(
      { error: 'insert failed', detail: insErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    inserted_count: inserted?.length ?? 0,
    inserted,
  });
}
