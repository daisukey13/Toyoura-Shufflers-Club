// app/api/admin/restore/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function env(name: string) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, message, ...(extra ? { extra } : {}) }, { status });
}

type AnySB = SupabaseClient<any, any, any, any>;

// ※ restore の順序は「親→子」(FKがあるため)
const TABLES = [
  'players',
  'teams',
  'team_members',
  'tournaments',
  'tournament_entries',
  'league_blocks',
  'league_block_members',
  'matches',
  'match_entries',
  'final_brackets',
  'final_matches',
] as const;

function asArray(v: any): any[] {
  return Array.isArray(v) ? v : [];
}
function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}
function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** insert を分割して投入 */
async function insertChunk(svc: AnySB, table: string, rows: any[], chunkSize = 500) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const part = rows.slice(i, i + chunkSize);
    const { error } = await (svc.from(table) as any).insert(part as any);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

/** players だけ衝突回避（idで upsert） */
async function upsertChunkById(svc: AnySB, table: string, rows: any[], chunkSize = 500) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const part = rows.slice(i, i + chunkSize);
    const { error } = await (svc.from(table) as any).upsert(part as any, { onConflict: 'id' });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

/**
 * ✅ 重要：復元前に「混ざり」を消す
 */
async function cleanupRelatedRows(svc: AnySB, payload: any) {
  const leagueBlocks = asArray(payload.league_blocks);
  const matches = asArray(payload.matches);
  const brackets = asArray(payload.final_brackets);

  const leagueBlockIds = uniq(leagueBlocks.map((r) => (r?.id ? String(r.id) : '')).filter(Boolean));
  const matchIds = uniq(matches.map((r) => (r?.id ? String(r.id) : '')).filter(Boolean));
  const bracketIds = uniq(brackets.map((r) => (r?.id ? String(r.id) : '')).filter(Boolean));

  // 1) league_block_members（子）
  if (leagueBlockIds.length > 0) {
    for (const ids of chunk(leagueBlockIds, 500)) {
      const { error } = await (svc.from('league_block_members') as any).delete().in('league_block_id', ids);
      if (error) throw new Error(`league_block_members cleanup failed: ${error.message}`);
    }
  }

  // 2) match_entries（子）
  if (matchIds.length > 0) {
    for (const ids of chunk(matchIds, 500)) {
      const { error } = await (svc.from('match_entries') as any).delete().in('match_id', ids);
      if (error) throw new Error(`match_entries cleanup failed: ${error.message}`);
    }
  }

  // 3) final_matches（子）
  if (bracketIds.length > 0) {
    const { error } = await (svc.from('final_matches') as any).delete().in('final_bracket_id', bracketIds);
    if (error) {
      const { error: e2 } = await (svc.from('final_matches') as any).delete().in('bracket_id', bracketIds);
      if (e2) throw new Error(`final_matches cleanup failed: ${error.message} / fallback: ${e2.message}`);
    }
  }
}

/**
 * ✅ 整合性チェック
 */
function validatePayload(payload: any) {
  const leagueBlocks = asArray(payload.league_blocks);
  const lbm = asArray(payload.league_block_members);
  const matches = asArray(payload.matches);

  const blockIdSet = new Set(leagueBlocks.map((r) => (r?.id ? String(r.id) : '')).filter(Boolean));

  const missingBlockIds = leagueBlocks.filter((r) => !r?.id).length;
  if (missingBlockIds > 0) throw new Error(`invalid payload: league_blocks has ${missingBlockIds} rows without id`);

  const badMembers = lbm.filter((r) => {
    const bid = r?.league_block_id ? String(r.league_block_id) : '';
    return !bid || !blockIdSet.has(bid);
  });
  if (badMembers.length > 0) {
    throw new Error(`invalid payload: league_block_members has ${badMembers.length} rows with unknown league_block_id`);
  }

  const badMatches = matches.filter((r) => {
    const bid = r?.league_block_id ? String(r.league_block_id) : '';
    if (!bid) return false;
    return !blockIdSet.has(bid);
  });
  if (badMatches.length > 0) throw new Error(`invalid payload: matches has ${badMatches.length} rows with unknown league_block_id`);
}

/**
 * ✅ バックアップ形式を抽出（JSON直・ラップ・文字列・FormData(file) 全対応）
 */
function looksLikeBackup(x: any) {
  return (
    x &&
    typeof x === 'object' &&
    (Array.isArray(x.players) ||
      Array.isArray(x.tournaments) ||
      Array.isArray(x.matches) ||
      Array.isArray(x.league_blocks) ||
      Array.isArray(x.final_brackets))
  );
}

function unwrapPayload(body: any) {
  if (!body || typeof body !== 'object') return null;
  if (looksLikeBackup(body)) return body;

  const candidates = [body.payload, body.data, body.backup, body.body, body.json];
  for (const c of candidates) if (looksLikeBackup(c)) return c;

  for (const c of candidates) {
    if (typeof c === 'string') {
      try {
        const parsed = JSON.parse(c);
        if (looksLikeBackup(parsed)) return parsed;
      } catch {}
    }
  }
  return null;
}

async function readRequestPayload(req: Request): Promise<any | null> {
  const ct = req.headers.get('content-type') || '';

  if (ct.includes('application/json')) {
    const raw = await req.json().catch(() => null);
    return unwrapPayload(raw);
  }

  if (ct.includes('multipart/form-data')) {
    const fd = await req.formData().catch(() => null);
    if (!fd) return null;

    const maybe = fd.get('file') || fd.get('backup') || fd.get('payload') || fd.get('data') || fd.get('json');

    if (maybe && typeof maybe === 'object' && 'arrayBuffer' in maybe) {
      const text = await (maybe as File).text().catch(() => '');
      if (!text) return null;
      try {
        return unwrapPayload(JSON.parse(text));
      } catch {
        return null;
      }
    }

    if (typeof maybe === 'string') {
      try {
        return unwrapPayload(JSON.parse(maybe));
      } catch {
        return null;
      }
    }

    return null;
  }

  const text = await req.text().catch(() => '');
  if (!text) return null;
  try {
    return unwrapPayload(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * ✅ 認証：Authorization(Bearer) を最優先
 * ✅ ただし「DB全削除直後に restore できない」ブートストラップ問題があるため、
 *    development(ローカル) では admin判定をバイパスする（production は従来通り厳格）
 */
async function assertAdmin(req: Request): Promise<{ authUserId: string }> {
  // ローカル/dev はバイパス（※本番は必ず admin 必須）
  if (process.env.NODE_ENV !== 'production') {
    return { authUserId: 'dev-bypass' };
  }

  const url = env('NEXT_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL');
  const anon = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !anon) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');

  const authz = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice('Bearer '.length).trim() : '';

  // 1) Bearer token 優先
  if (token) {
    const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: u, error } = await sb.auth.getUser(token);
    if (error) throw new Error(error.message);
    if (!u?.user?.id) throw new Error('Not authenticated');

    const { data: me, error: pErr } = await sb
      .from('players')
      .select('id, is_admin')
      .eq('auth_user_id', u.user.id)
      .maybeSingle();

    if (pErr) throw new Error(pErr.message);
    if (!me?.is_admin) throw new Error('Forbidden: admin only');

    return { authUserId: u.user.id };
  }

  // 2) Cookieセッション（フォールバック）
  const cookieStore = cookies();
  const supabase = createServerClient(url, anon, {
    cookies: { get: (key) => cookieStore.get(key)?.value },
  });

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user?.id) throw new Error('Not authenticated');

  const { data: me, error: pErr } = await supabase
    .from('players')
    .select('id, is_admin')
    .eq('auth_user_id', auth.user.id)
    .maybeSingle();

  if (pErr) throw new Error(pErr.message);
  if (!me?.is_admin) throw new Error('Forbidden: admin only');

  return { authUserId: auth.user.id };
}

/**
 * ✅ players の auth_user_id / user_id は復元時に全員 null に落とす（既存方針）
 * ✅ さらに handle_name を「大小文字無視 + 既存DBも考慮」して強制ユニーク化する
 */
async function sanitizePlayersForLocalRestore(svc: AnySB, players: any[]) {
  const norm = (v: any) => (typeof v === 'string' ? v.trim() : '');
  const keyOf = (name: string) => name.trim().toLowerCase();
  const fallbackBase = (p: any) => {
    const id = p?.id ? String(p.id) : 'unknown';
    return `player-${id.slice(0, 8)}`;
  };

  // 既存DBの handle_name を先に読む（途中失敗で残った行・admin行が居ても衝突回避できる）
  const existingKeys = new Set<string>();
  try {
    const { data, error } = await (svc.from('players') as any).select('handle_name').limit(10000);
    if (!error && Array.isArray(data)) {
      for (const r of data) {
        const hn = norm(r?.handle_name);
        if (hn) existingKeys.add(keyOf(hn));
      }
    }
  } catch {
    // ローカル最優先：読めなくても payload 内 dedupe は効く
  }

  const seen = new Set<string>();
  const outPlayers: any[] = [];

  for (const p of players) {
    const out = { ...p };

    // auth系は必ず null
    if ('auth_user_id' in out) out.auth_user_id = null;
    if ('user_id' in out) out.user_id = null;

    // base を作る（空ならfallback）
    const baseRaw = norm(out.handle_name) || fallbackBase(out);

    // 既存 + payload内 の両方と衝突しない名前を作る
    let candidate = baseRaw;
    let k = keyOf(candidate);
    let n = 1;

    while (existingKeys.has(k) || seen.has(k)) {
      n += 1;
      candidate = `${baseRaw}__r${n}`;
      k = keyOf(candidate);
    }

    out.handle_name = candidate;
    seen.add(k);
    outPlayers.push(out);
  }

  return outPlayers;
}

export async function POST(req: Request) {
  try {
    await assertAdmin(req);

    const url = env('NEXT_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL');
    const service = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_ROLE');
    if (!url || !service) return jsonError('Missing service role env (local only)', 500);

    const svc = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

    const payload = await readRequestPayload(req);
    if (!payload) return jsonError('Restore payload is empty or unreadable. (Wrong key / missing file / not JSON)', 400);

    // 期待する keys をざっくりチェック
    for (const t of TABLES) {
      const rows = (payload as any)[t];
      if (rows != null && !Array.isArray(rows)) return jsonError(`invalid payload: ${t} must be an array`, 400);
    }

    validatePayload(payload);
    await cleanupRelatedRows(svc as AnySB, payload);

    const inserted: Record<string, number> = {};

    for (const t of TABLES) {
      let rows = (payload as any)[t] as any[] | undefined;
      const n = Array.isArray(rows) ? rows.length : 0;
      inserted[t] = n;
      if (n <= 0) continue;

      if (t === 'players') {
        rows = await sanitizePlayersForLocalRestore(svc as AnySB, rows!);

        // デバッグ補助：payload内のlower重複が残ってないか（理論上は0のはず）
        const keys = rows.map((r) =>
          typeof r?.handle_name === 'string' ? r.handle_name.trim().toLowerCase() : ''
        );
        const dupKeys = keys.filter((k, i) => k && keys.indexOf(k) !== i);
        if (dupKeys.length > 0) {
          return jsonError('players sanitize failed: still has duplicate handle_name (case-insensitive)', 500, {
            sample: dupKeys.slice(0, 20),
          });
        }

        await upsertChunkById(svc as AnySB, t, rows!, 500);
      } else {
        await insertChunk(svc as AnySB, t, rows!, 500);
      }
    }

    const sum = Object.values(inserted).reduce((a, b) => a + b, 0);
    if (sum === 0) return jsonError('Restore payload contained 0 rows. Aborted.', 400, { inserted });

    return NextResponse.json({
      ok: true,
      inserted,
      note: {
        auth: process.env.NODE_ENV !== 'production' ? 'dev-bypass enabled for restore bootstrap' : 'admin required',
        players:
          'auth_user_id/user_id nulled; handle_name forced unique case-insensitively; existing DB handle_names were also considered.',
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || 'restore failed', 500);
  }
}
