// lib/supabase/finalMatchesSafe.ts
'use client';

type AnyRow = Record<string, any>;

function isMissingColumnErrorMessage(msg: string, col: string) {
  const m = String(msg || '').toLowerCase();
  const c = col.toLowerCase();
  return (
    (m.includes('schema cache') && m.includes(`'${c}'`)) ||
    (m.includes('does not exist') && m.includes('column') && m.includes(c))
  );
}

/**
 * select の候補を順に試して「存在しない列」で落ちないようにする
 * - PostgREST は存在しない列を select すると 400 になる
 */
async function trySelect<T>(
  baseQuery: { select: (s: string) => any },
  selectCandidates: string[],
) {
  let lastErr: any = null;

  for (const sel of selectCandidates) {
    const q: any = baseQuery.select(sel);
    const { data, error } = await q;
    if (!error) return { data: (data ?? []) as T[], error: null as any, usedSelect: sel };

    const msg = String(error.message || '');
    // どれかの列が無いだけなら候補を変えて続行
    const maybeMissing =
      sel
        .split(',')
        .map((s) => s.trim().split(' ')[0]) // "col as alias" 対策
        .find((c) => isMissingColumnErrorMessage(msg, c)) ?? null;

    if (!maybeMissing) {
      lastErr = error;
      break;
    }

    lastErr = error;
    continue;
  }

  return { data: [] as T[], error: lastErr, usedSelect: '' };
}

/**
 * final_matches を「列が無くても落ちない」形で取得する
 * - bracketId がある場合は eq('bracket_id', bracketId) を付ける
 * - limit/order も共通で扱う
 */
export async function fetchFinalMatchesSafe<T extends AnyRow>(args: {
  db: any; // supabase client
  bracketId?: string | null;
  limit?: number;
}) {
  const { db, bracketId, limit = 200 } = args;

  // delta 系まで含む候補 → 無ければ基本列へフォールバック
  const selectCandidates = [
    // ✅ delta 列がある環境
    'id,bracket_id,round_no,match_no,match_index,created_at,winner_id,loser_id,winner_score,loser_score,end_reason,finish_reason,affects_rating,winner_points_delta,loser_points_delta,winner_handicap_delta,loser_handicap_delta',
    // ✅ delta 列が無い環境
    'id,bracket_id,round_no,match_no,match_index,created_at,winner_id,loser_id,winner_score,loser_score,end_reason,finish_reason,affects_rating',
    // ✅ match_no/match_index が無い環境もあり得る
    'id,bracket_id,round_no,created_at,winner_id,loser_id,winner_score,loser_score,end_reason,finish_reason,affects_rating',
    // ✅ 最小
    'id,created_at,winner_id,loser_id,winner_score,loser_score,end_reason,finish_reason,affects_rating',
    '*',
  ];

  let base: any = db.from('final_matches');
  if (bracketId) base = base.eq('bracket_id', bracketId);

  // order/limit は select 前に付けると supabase-js 的に扱いやすい
  base = base.order('created_at', { ascending: false }).limit(limit);

  return await trySelect<T>(base, selectCandidates);
}
