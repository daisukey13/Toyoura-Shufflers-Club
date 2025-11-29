// app/api/finals/[bracketId]/matches/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = Record<string, any>;

function pick<T = any>(r: Row, keys: string[], fallback: T): T {
  for (const k of keys) {
    if (k in r && r[k] !== undefined) return r[k] as T;
  }
  return fallback;
}

export async function GET(_req: NextRequest, ctx: { params: { bracketId: string } }) {
  try {
    const bracketId = String(ctx?.params?.bracketId || '').trim();
    if (!bracketId) {
      return NextResponse.json({ ok: false, message: 'bracketId が未指定です' }, { status: 400 });
    }

    // final_matches の「bracket_id 列名ゆれ」を吸収する
    const filterCols = ['bracket_id', 'final_bracket_id', 'finals_bracket_id', 'final_brackets_id', 'brackets_id'];

    // select も環境差を吸収（存在しない列で落ちる場合がある）
    const selectCandidates = [
      'id,bracket_id,round_no,match_no,match_index,created_at,winner_id,loser_id,winner_score,loser_score,finish_reason,end_reason',
      'id,bracket_id,round_no,match_no,match_index,created_at,winner_id,loser_id,winner_score,loser_score,end_reason',
      'id,bracket_id,round_no,match_no,created_at,winner_id,loser_id,winner_score,loser_score',
      'id,bracket_id,round_no,match_index,created_at,winner_id,loser_id,winner_score,loser_score',
      'id,bracket_id,round_no,created_at,winner_id,loser_id,winner_score,loser_score',
      '*',
    ];

    const orderCandidates: Array<{ col: string; asc: boolean } | null> = [
      { col: 'round_no', asc: true },
      { col: 'match_no', asc: true },
      { col: 'match_index', asc: true },
      { col: 'created_at', asc: true },
      null,
    ];

    let lastErr: any = null;

    for (const filterCol of filterCols) {
      for (const sel of selectCandidates) {
        for (const ord of orderCandidates) {
          let q: any = supabaseAdmin.from('final_matches').select(sel).eq(filterCol, bracketId);
          if (ord) q = q.order(ord.col, { ascending: ord.asc });

          const { data, error } = await q;
          if (!error) {
            const rows = (data ?? []) as Row[];

            // 返却はフロントが必要な形に正規化（存在しない列は null に落とす）
            const normalized = rows.map((r) => {
              const round_no = Number(pick(r, ['round_no'], null) ?? 0) || null;
              const match_no = (pick(r, ['match_no'], null) as number | null) ?? null;
              const match_index = (pick(r, ['match_index'], null) as number | null) ?? null;

              const finish_reason = (pick(r, ['finish_reason'], null) as string | null) ?? null;
              const end_reason = (pick(r, ['end_reason'], null) as string | null) ?? null;

              return {
                id: String(pick(r, ['id'], '')),
                bracket_id: String(pick(r, filterCols, bracketId)),
                round_no,
                match_no,
                match_index,
                created_at: (pick(r, ['created_at'], null) as string | null) ?? null,
                winner_id: (pick(r, ['winner_id'], null) as string | null) ?? null,
                loser_id: (pick(r, ['loser_id'], null) as string | null) ?? null,
                winner_score: (pick(r, ['winner_score'], null) as number | null) ?? null,
                loser_score: (pick(r, ['loser_score'], null) as number | null) ?? null,
                finish_reason,
                end_reason,
              };
            });

            return NextResponse.json({ ok: true, matches: normalized }, { status: 200 });
          }

          lastErr = error;
        }
      }
    }

    // 最終手段：フィルタ無しで少数取得して JS 側で bracketId だけ拾う（件数少前提）
    for (const sel of ['*'] as const) {
      for (const ord of orderCandidates) {
        let q: any = supabaseAdmin.from('final_matches').select(sel).limit(500);
        if (ord) q = q.order(ord.col, { ascending: ord.asc });

        const { data, error } = await q;
        if (!error) {
          const rows = (data ?? []) as Row[];
          const filtered = rows.filter((r) =>
            filterCols.some((k) => String(r?.[k] ?? '') === bracketId)
          );

          const normalized = filtered.map((r) => ({
            id: String(pick(r, ['id'], '')),
            bracket_id: bracketId,
            round_no: Number(pick(r, ['round_no'], null) ?? 0) || null,
            match_no: (pick(r, ['match_no'], null) as number | null) ?? null,
            match_index: (pick(r, ['match_index'], null) as number | null) ?? null,
            created_at: (pick(r, ['created_at'], null) as string | null) ?? null,
            winner_id: (pick(r, ['winner_id'], null) as string | null) ?? null,
            loser_id: (pick(r, ['loser_id'], null) as string | null) ?? null,
            winner_score: (pick(r, ['winner_score'], null) as number | null) ?? null,
            loser_score: (pick(r, ['loser_score'], null) as number | null) ?? null,
            finish_reason: (pick(r, ['finish_reason'], null) as string | null) ?? null,
            end_reason: (pick(r, ['end_reason'], null) as string | null) ?? null,
          }));

          return NextResponse.json({ ok: true, matches: normalized }, { status: 200 });
        }
        lastErr = error;
      }
    }

    return NextResponse.json(
      { ok: false, message: lastErr?.message || 'final_matches 取得に失敗しました' },
      { status: 500 }
    );
  } catch (e: any) {
    console.error('[api/finals/:bracketId/matches] fatal:', e);
    return NextResponse.json({ ok: false, message: 'サーバエラーが発生しました' }, { status: 500 });
  }
}
