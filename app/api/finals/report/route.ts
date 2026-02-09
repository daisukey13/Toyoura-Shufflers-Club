// app/api/finals/report/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function normalizeReason(v: unknown) {
  const s = String(v ?? 'normal').trim().toLowerCase();
  if (s === 'time_limit' || s === 'walkover' || s === 'forfeit') return s;
  return 'normal';
}

function toBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return null;
}

function isMissingColumnErrorMessage(msg: string, col: string) {
  const m = String(msg || '').toLowerCase();
  const c = col.toLowerCase();
  return (
    (m.includes('schema cache') && m.includes(`'${c}'`)) ||
    (m.includes('does not exist') && m.includes('column') && m.includes(c)) ||
    (m.includes('could not find the') && m.includes(c))
  );
}

async function safeSelectId(
  supabase: ReturnType<typeof createClient>,
  where: { bracket_id: string; round_no: number; match_no: number },
) {
  // match_no が無いスキーマもあるので match_index も試す
  const candidates: Array<{ keyCol: 'match_no' | 'match_index' }> = [{ keyCol: 'match_no' }, { keyCol: 'match_index' }];

  for (const c of candidates) {
    try {
      const { data, error } = await supabase
        .from('final_matches')
        .select('id')
        .eq('bracket_id', where.bracket_id)
        .eq('round_no', where.round_no)
        .eq(c.keyCol, where.match_no)
        .maybeSingle();

      if (!error) {
  const id = (data as any)?.id ? String((data as any).id) : null;
  return { ok: true as const, id, keyCol: c.keyCol };
}

      const msg = String(error.message || '');
      if (isMissingColumnErrorMessage(msg, c.keyCol)) continue;
      return { ok: false as const, message: msg };
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (isMissingColumnErrorMessage(msg, c.keyCol)) continue;
      return { ok: false as const, message: msg };
    }
  }

  return { ok: false as const, message: 'final_matches: match_no/match_index が見つかりません' };
}

async function safeWriteFinalMatch(
  supabase: ReturnType<typeof createClient>,
  mode: 'insert' | 'update',
  idOrNull: string | null,
  payload: Record<string, any>,
) {
  // 可能性のある列たち（無い場合は落として再試行）
  const removableCols = [
    'affects_rating',
    'end_reason',
    'finish_reason',
    'sets',
    'sets_json',
    'winner_sets',
    'loser_sets',
    'match_no',
    'match_index',
    'updated_at',
  ];

  let current = { ...payload };

  // ✅ insert→duplicate の場合は、既存行を探して update に切り替える
  let writeMode: 'insert' | 'update' = mode;
  let writeId: string | null = idOrNull;

  for (let i = 0; i < 16; i++) {
    const fm = supabase.from('final_matches') as any;

    const q =
      writeMode === 'update'
        ? fm.update(current).eq('id', writeId!)
        : fm.insert(current).select('id').single();

    const { data, error } = await q;

    if (!error) {
      if (writeMode === 'insert') {
        return { ok: true as const, id: data?.id ? String(data.id) : null };
      }
      return { ok: true as const, id: writeId };
    }

    const msg = String(error.message || '');

    // ✅ ここが本件：unique重複なら「既存行idを拾って update」に切り替えてリトライ
    const isDup =
      msg.includes('duplicate key value') ||
      msg.includes('final_matches_unique') ||
      msg.includes('final_matches_bracket_round_match_uk') ||
      msg.includes('final_matches_unique_bracket_round_match');

    if (writeMode === 'insert' && isDup) {
      const bracket_id = String((current as any).bracket_id ?? '');
      const round_no = Number((current as any).round_no);
      const match_no_raw = (current as any).match_no ?? (current as any).match_index;
      const match_no = Number(match_no_raw);

      if (bracket_id && Number.isFinite(round_no) && Number.isFinite(match_no)) {
        const sel = await safeSelectId(supabase, { bracket_id, round_no, match_no });
        if (sel.ok && sel.id) {
          writeMode = 'update';
          writeId = sel.id;
          continue; // ★ update に切り替えて再試行
        }
      }
      // 既存が見つからないなら、そのままエラーとして返す
      return { ok: false as const, message: msg };
    }

    const missing = removableCols.find((c) => c in current && isMissingColumnErrorMessage(msg, c));
    if (!missing) return { ok: false as const, message: msg };

    // 列が無い → その列だけ落としてリトライ
    const rest = Object.fromEntries(Object.entries(current).filter(([k]) => k !== missing));
    current = rest as any;
  }

  return { ok: false as const, message: 'write retry exceeded' };
}


export async function GET() {
  return NextResponse.json({ ok: true, route: '/api/finals/report', methods: ['POST'] });
}

export async function POST(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
    if (!url || !key) {
      return jsonError('Supabase env is missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)', 500);
    }

    const supabase = createClient(url, key, { auth: { persistSession: false } });

    const body = await req.json().catch(() => null);
    if (!body) return jsonError('Invalid JSON');

    const bracket_id = String(body.bracket_id ?? '').trim();
    const round_no = Number(body.round_no ?? NaN);
    const match_no = Number(body.match_no ?? body.matchNo ?? body.match_index ?? body.matchIndex ?? NaN);

    if (!bracket_id) return jsonError('bracket_id is required');
    if (!isUuidLike(bracket_id)) return jsonError('bracket_id must be uuid');
    if (!Number.isFinite(round_no) || round_no <= 0) return jsonError('round_no is invalid');
    if (!Number.isFinite(match_no) || match_no <= 0) return jsonError('match_no is invalid');

    // reason 正規化（DB制約対策）
    const reason = normalizeReason(body.end_reason ?? body.finish_reason ?? body.reason ?? 'normal');

    // body.affects_rating が来ても、special end の場合は必ず false
    const direct = toBool(body.affects_rating ?? body.apply_rating);
    const affects_rating = reason === 'normal' ? (direct ?? true) : false;

    // sets はどっちの列でも入るように両方候補に載せて、無い列は safeWrite が落とす
    const sets = body.sets ?? body.sets_json ?? body.setsJson ?? null;

    // match_no / match_index どちらのスキーマでも行けるように、あとで keyCol を確定して入れる
    const basePayload: any = {
      bracket_id,
      round_no,
      winner_id: body.winner_id ?? null,
      loser_id: body.loser_id ?? null,
      winner_score: body.winner_score ?? null,
      loser_score: body.loser_score ?? null,

      // ✅ 重要：special end の時に rating を動かさない
      affects_rating,

      // ✅ どっちの列があっても良い（無い方は自動で落として再試行）
      end_reason: reason,
      finish_reason: reason,

      // ✅ sets も列名吸収
      sets,
      sets_json: sets,

      winner_sets: body.winner_sets ?? null,
      loser_sets: body.loser_sets ?? null,

      updated_at: new Date().toISOString(),
    };

    // 既存検索（match_no / match_index のどちらかを吸収）
    const found = await safeSelectId(supabase as any, { bracket_id, round_no, match_no });

    if (!found.ok) return jsonError(found.message, 500, { hint: 'finder failed' });

    // keyCol を確定
    const payload = {
      ...basePayload,
      [found.keyCol]: match_no,
    };

    let savedId: string | null = null;

    if (found.id) {
     const wr = await safeWriteFinalMatch(supabase as any, 'insert', null, payload)

 
      if (!wr.ok) return jsonError(wr.message, 500, { hint: 'update failed' });
      savedId = found.id;
    } else {
      const wr = await safeWriteFinalMatch(supabase as any, 'insert', null, payload)

      if (!wr.ok) return jsonError(wr.message, 500, { hint: 'insert failed' });
      savedId = wr.id ?? null;
    }

    // ✅ 決勝なら champion_player_id を更新
    const { data: b, error: bErr } = await supabase
      .from('final_brackets')
      .select('id,max_round')
      .eq('id', bracket_id)
      .maybeSingle();

    if (!bErr && b?.id) {
      const isFinal = Number(round_no) === Number(b.max_round) && Number(match_no) === 1;
      if (isFinal) {
        await supabase
          .from('final_brackets')
          .update({ champion_player_id: payload.winner_id ?? null, updated_at: new Date().toISOString() })
          .eq('id', b.id);
      }
    }

    return NextResponse.json({
      ok: true,
      id: savedId,
      affects_rating,
      end_reason: reason,
    });
  } catch (e: any) {
    return jsonError(e?.message ?? 'Unknown error', 500);
  }
}
