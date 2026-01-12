'use client';

import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FaShieldAlt, FaTrophy } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

type MatchFormat = 'single' | 'bo3';

type FinalBracket = {
  id: string;
  tournament_id: string;
  title: string | null;
  created_at: string | null;
};

type FinalRoundEntry = {
  id: string;
  bracket_id: string;
  round_no: number;
  slot_no: number;
  player_id: string | null;
};

type FinalMatchRow = {
  id: string;
  bracket_id?: string | null;
  round_no?: number | null;

  match_no?: number | null;
  match_index?: number | null;
  created_at?: string | null;

  winner_id?: string | null;
  loser_id?: string | null;
  winner_score?: number | null; // single: 点 / bo3: 勝数（Adv込み）
  loser_score?: number | null; // single: 点 / bo3: 勝数（Adv込み）

  finish_reason?: string | null;
  end_reason?: string | null;

  // sets: 旧 = [{a,b},{a,b}...] / 新 = {format, advantage, games:[{a,b}...]}
  sets?: any;

  [key: string]: any;
};

type Player = {
  id: string;
  handle_name: string | null;
  avatar_url: string | null;
  ranking_points: number | null;
  handicap: number | null;
  is_admin?: boolean | null;
  is_dummy?: boolean | null; // def 判定
};

type AdminRow = { user_id: string };
type PlayerFlagRow = { is_admin: boolean | null };

type LeagueCandidateRow = {
  block_id: string;
  block_label: string;
  player_id: string;
  rank?: number | null;
  wins?: number | null;
  losses?: number | null;
  point_diff?: number | null;
  played?: number | null;
};

type LeagueCandidateBlock = {
  block_id: string;
  block_label: string;
  rows: LeagueCandidateRow[];
};

type LeagueCandidates = {
  source: string;
  blocks: LeagueCandidateBlock[];
};

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const s = String(v ?? '').trim();
  if (s === '') return fallback;
  const n = typeof v === 'number' ? v : parseInt(s, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const normalizeReason = (m: FinalMatchRow) =>
  String(m.finish_reason ?? m.end_reason ?? 'normal').trim().toLowerCase();

const isMissingColumnError = (err: any) => {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '');
  return code === '42703' || msg.includes('does not exist') || msg.toLowerCase().includes('column');
};

const isMissingTableError = (err: any) => {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '').toLowerCase();
  const status = Number(err?.status ?? err?.statusCode ?? err?.status_code ?? NaN);
  return (
    status === 404 ||
    code === '42P01' ||
    code === 'PGRST116' ||
    msg.includes('does not exist') ||
    msg.includes('relation') ||
    msg.includes('not found') ||
    msg.includes('could not find the relation')
  );
};

const isPowerOfTwo = (n: number) => n >= 2 && (n & (n - 1)) === 0;

const pick = (obj: any, keys: string[]) => {
  for (const k of keys) {
    if (obj?.[k] != null) return obj[k];
  }
  return null;
};

const toNum = (v: any, fb: number | null = null) => {
  const s = String(v ?? '').trim();
  if (s === '') return fb;
  const n = typeof v === 'number' ? v : parseInt(s, 10);
  return Number.isFinite(n) ? n : fb;
};

type SetsMetaParsed = {
  format: MatchFormat | null;
  advantageA: number;
  advantageB: number;
  games: Array<{ a: number | null; b: number | null }>;
};

function parseSetsMeta(sets: any): SetsMetaParsed {
  // 旧形式: 配列 [{a,b}...]
  if (Array.isArray(sets)) {
    const games = (sets as any[]).slice(0, 3).map((x) => ({
      a: typeof x?.a === 'number' ? x.a : toNum(x?.a, null),
      b: typeof x?.b === 'number' ? x.b : toNum(x?.b, null),
    }));
    return { format: 'bo3', advantageA: 0, advantageB: 0, games };
  }

  // 新形式: { format, advantage, games }
  if (sets && typeof sets === 'object') {
    const fmtRaw = String((sets as any)?.format ?? '').trim().toLowerCase();
    const format: MatchFormat | null =
      fmtRaw === 'single' ? 'single' : fmtRaw === 'bo3' || (sets as any)?.games ? 'bo3' : null;

    const adv = (sets as any)?.advantage ?? {};
    const advantageA = Math.max(0, toNum(adv?.a, 0) ?? 0);
    const advantageB = Math.max(0, toNum(adv?.b, 0) ?? 0);

    const arr = Array.isArray((sets as any)?.games) ? (sets as any).games : [];
    const games = (arr as any[]).slice(0, 3).map((x) => ({
      a: x?.a == null ? null : toNum(x.a, null),
      b: x?.b == null ? null : toNum(x.b, null),
    }));

    return { format, advantageA, advantageB, games };
  }

  return { format: null, advantageA: 0, advantageB: 0, games: [] };
}

function inferFormatFromMatch(m: FinalMatchRow | null, forcedBo3: boolean): MatchFormat {
  if (forcedBo3) return 'bo3';
  if (m?.sets != null) {
    const p = parseSetsMeta(m.sets);
    if (p.format) return p.format;
    return 'bo3';
  }

  const ws = typeof m?.winner_score === 'number' ? m?.winner_score : null;
  const ls = typeof m?.loser_score === 'number' ? m?.loser_score : null;
  if (ws != null && ls != null) {
    if (ws <= 3 && ls <= 3) return 'bo3';
    return 'single';
  }

  return 'bo3';
}

function calcBo3Wins(
  pidA: string,
  pidB: string,
  games: Array<{ a: number | null; b: number | null }>,
  advantageA: number,
  advantageB: number
) {
  let setWinsA = 0;
  let setWinsB = 0;

  for (const g of games.slice(0, 3)) {
    const a = g.a;
    const b = g.b;
    if (a == null || b == null) continue;
    if (a < 0 || b < 0) continue;
    if (a === b) continue;
    if (a > b) setWinsA++;
    else setWinsB++;
  }

  const totalA = setWinsA + advantageA;
  const totalB = setWinsB + advantageB;

  const winner_id =
    totalA >= 2 && totalA > totalB ? pidA : totalB >= 2 && totalB > totalA ? pidB : null;

  const loser_id = winner_id === pidA ? pidB : winner_id === pidB ? pidA : null;

  return {
    setWinsA,
    setWinsB,
    totalA,
    totalB,
    winner_id,
    loser_id,
  };
}

function normalizeLeagueCandidateRows(source: string, rows: any[], tournamentId: string): LeagueCandidates {
  const filtered = rows.filter((r) => {
    const tid = pick(r, ['tournament_id', 'tournamentId', 't_id', 'tournament']);
    return tid == null ? true : String(tid) === tournamentId;
  });

  const byBlock = new Map<string, LeagueCandidateBlock>();

  for (const r of filtered) {
    const bid = String(pick(r, ['block_id', 'league_block_id', 'group_id', 'block']) ?? '');
    const pid = String(pick(r, ['player_id', 'player', 'entrant_id', 'winner_id', 'winner_player_id']) ?? '');
    if (!bid || !pid) continue;

    const blockNo = pick(r, ['block_no', 'group_no']);
    const name = pick(r, ['block_name', 'block_label', 'block_title', 'name', 'label']);
    const label = String(name ?? '') || (blockNo !=null ? `Block ${blockNo}` : `Block ${bid.slice(0, 6)}`);

    if (!byBlock.has(bid)) byBlock.set(bid, { block_id: bid, block_label: label, rows: [] });

    byBlock.get(bid)!.rows.push({
      block_id: bid,
      block_label: label,
      player_id: pid,
      rank: toNum(pick(r, ['rank', 'position', 'place']), null),
      wins: toNum(pick(r, ['wins', 'win', 'w']), null),
      losses: toNum(pick(r, ['losses', 'loss', 'l']), null),
      point_diff: toNum(pick(r, ['point_diff', 'diff', 'score_diff', 'pt_diff']), null),
      played: toNum(pick(r, ['played', 'games', 'matches']), null),
    });
  }

  const blocks = Array.from(byBlock.values());

  for (const b of blocks) {
    b.rows.sort((a, c) => {
      const ar = a.rank ?? 9999;
      const cr = c.rank ?? 9999;
      if (ar !== cr) return ar - cr;

      const aw = a.wins ?? -9999;
      const cw = c.wins ?? -9999;
      if (cw !== aw) return cw - aw;

      const ad = a.point_diff ?? -9999;
      const cd = c.point_diff ?? -9999;
      if (cd !== ad) return cd - ad;

      return String(a.player_id).localeCompare(String(c.player_id));
    });
  }

  blocks.sort((a, b) => a.block_label.localeCompare(b.block_label, 'ja'));
  return { source, blocks };
}

/**
 * ✅ ブロック勝者の取得方針
 * 1) league_block_winners_v があればそれを最優先
 * 2) それが使えない時だけ league_blocks + league_block_members で「手動選択用候補」
 */
async function loadLeagueCandidates(db: any, tournamentId: string): Promise<LeagueCandidates | null> {
  // --- 1) winners view を最優先 ---
  try {
    const r1 = await (db.from('league_block_winners_v') as any).select('*').eq('tournament_id', tournamentId);
    if (!r1?.error && Array.isArray(r1?.data) && r1.data.length > 0) {
      const mapped = (r1.data as any[]).map((r) => ({
        tournament_id: tournamentId,
        block_id: pick(r, ['league_block_id', 'block_id', 'id']),
        block_label: pick(r, ['block_label', 'label', 'block_name', 'name']),
        player_id: pick(r, ['winner_id', 'winner_player_id', 'player_id', 'winner']),
        rank: 1,
      }));
      const out = normalizeLeagueCandidateRows('league_block_winners_v', mapped, tournamentId);
      out.blocks.forEach((b) => (b.rows = b.rows.slice(0, 1)));
      return out;
    }

    if (r1?.error && (isMissingColumnError(r1.error) || isMissingTableError(r1.error))) {
      // fallthrough
    }
  } catch {
    // fallthrough
  }

  // --- 2) blocks + members ---
  try {
    const blockTables = ['league_blocks', 'tournament_league_blocks'];
    let blocks: any[] | null = null;
    let blockSource = '';

    for (const bt of blockTables) {
      const rb1 = await (db.from(bt) as any)
        .select('*')
        .eq('tournament_id', tournamentId)
        .order('block_no', { ascending: true });

      if (!rb1?.error && Array.isArray(rb1?.data)) {
        blocks = rb1.data as any[];
        blockSource = bt;
        if (blocks.length) break;
      }

      if (rb1?.error && isMissingColumnError(rb1.error)) {
        const rb2 = await (db.from(bt) as any).select('*').limit(5000);
        if (!rb2?.error && Array.isArray(rb2?.data)) {
          const all = rb2.data as any[];
          blocks = all.filter((x) => String(pick(x, ['tournament_id', 'tournamentId', 't_id']) ?? '') === tournamentId);
          blockSource = bt;
          if (blocks.length) break;
        }
      }

      if (rb1?.error && isMissingTableError(rb1.error)) continue;
    }

    if (!blocks || blocks.length === 0) return null;

    const blockIds = blocks.map((b) => String(pick(b, ['id', 'league_block_id', 'block_id']) ?? '')).filter(Boolean);
    if (!blockIds.length) return null;

    const memberTables = ['league_block_members', 'tournament_league_block_members'];
    let members: any[] | null = null;
    let memberSource = '';

    for (const mt of memberTables) {
      const rm1 = await (db.from(mt) as any).select('*').in('league_block_id', blockIds);
      if (!rm1?.error && Array.isArray(rm1?.data)) {
        members = rm1.data as any[];
        memberSource = mt;
        break;
      }

      if (rm1?.error && isMissingColumnError(rm1.error)) {
        const rm2 = await (db.from(mt) as any).select('*').in('block_id', blockIds);
        if (!rm2?.error && Array.isArray(rm2?.data)) {
          members = rm2.data as any[];
          memberSource = `${mt} (block_id)`;
          break;
        }
      }

      if (rm1?.error && isMissingTableError(rm1.error)) continue;
    }

    if (!members || members.length === 0) return null;

    const byBlock = new Map<string, LeagueCandidateBlock>();

    for (const b of blocks) {
      const bid = String(pick(b, ['id', 'league_block_id', 'block_id']) ?? '');
      if (!bid) continue;
      const label =
        String(pick(b, ['name', 'title', 'label', 'block_label', 'block_name']) ?? '') ||
        (pick(b, ['block_no']) != null ? `Block ${pick(b, ['block_no'])}` : `Block ${bid.slice(0, 6)}`);
      byBlock.set(bid, { block_id: bid, block_label: label, rows: [] });
    }

    for (const m of members) {
      const bid = String(pick(m, ['league_block_id', 'block_id']) ?? '');
      const pid = String(pick(m, ['player_id']) ?? '');
      if (!bid || !pid) continue;
      const blk = byBlock.get(bid);
      if (!blk) continue;
      blk.rows.push({ block_id: bid, block_label: blk.block_label, player_id: pid });
    }

    const blocksOut = Array.from(byBlock.values()).filter((b) => b.rows.length > 0);
    blocksOut.sort((a, b) => a.block_label.localeCompare(b.block_label, 'ja'));

    return { source: `${blockSource} + ${memberSource} (manual winner select)`, blocks: blocksOut };
  } catch {
    return null;
  }
}

async function fetchFinalMatchesOnce(db: any, bracketId: string): Promise<FinalMatchRow[]> {
  const { data, error } = await (db.from('final_matches') as any)
    .select('*')
    .eq('bracket_id', bracketId)
    .order('round_no', { ascending: true });

  if (!error) return (data ?? []) as FinalMatchRow[];

  const { data: data2, error: error2 } = await (db.from('final_matches') as any).select('*').eq('bracket_id', bracketId);
  if (error2) throw new Error(String(error2.message || 'final_matches fetch failed'));
  return (data2 ?? []) as FinalMatchRow[];
}

async function postFinalReport(payload: {
  bracket_id: string;
  round_no: number;
  match_no: number;
  winner_id: string | null;
  loser_id: string | null;
  winner_score: number | null;
  loser_score: number | null;
  end_reason?: string | null;
  finish_reason?: string | null;
  reason?: string | null;
  sets?: any;
}) {
  const res = await fetch('/api/finals/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await res.text();

  // JSON優先、ダメならテキスト
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {}

  if (!res.ok || parsed?.ok === false) {
    const msg = parsed?.error || parsed?.message || text.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }

  return parsed ?? { ok: true };
}

async function clearFinalMatchesFromRound(db: any, bracketId: string, fromRoundNo: number) {
  const candidates: Record<string, any>[] = [
    {
      winner_id: null,
      loser_id: null,
      winner_score: null,
      loser_score: null,
      finish_reason: 'normal',
      end_reason: 'normal',
      sets: null,
    },
    {
      winner_id: null,
      loser_id: null,
      winner_score: null,
      loser_score: null,
      finish_reason: null,
      end_reason: null,
      sets: null,
    },
    {
      winner_id: null,
      loser_id: null,
      winner_score: null,
      loser_score: null,
      finish_reason: null,
      end_reason: null,
    },
    { winner_id: null, loser_id: null, winner_score: null, loser_score: null },
    { winner_id: null, loser_id: null },
  ];

  let lastErr: any = null;

  for (const payload of candidates) {
    const { error } = await (db.from('final_matches') as any)
      .update(payload as any)
      .eq('bracket_id', bracketId)
      .gte('round_no', fromRoundNo);

    if (!error) return;
    lastErr = error;

    if (isMissingColumnError(error)) continue;
    break;
  }

  throw new Error(String(lastErr?.message || 'final_matches clear failed'));
}

async function deleteFinalRoundsFrom(db: any, bracketId: string, fromRoundNo: number) {
  const r1 = await (db.from('final_matches') as any).delete().eq('bracket_id', bracketId).gte('round_no', fromRoundNo);
  if (r1?.error) throw new Error(String(r1.error?.message || 'final_matches delete failed'));

  const r2 = await (db.from('final_round_entries') as any)
    .delete()
    .eq('bracket_id', bracketId)
    .gte('round_no', fromRoundNo);
  if (r2?.error) throw new Error(String(r2.error?.message || 'final_round_entries delete failed'));
}

const paramToString = (v: any) => {
  if (Array.isArray(v)) return String(v[0] ?? '').trim();
  return String(v ?? '').trim();
};

// ✅ /api/finals/report が無い/死んでる時のフォールバック：clientから final_matches を安全に upsert
async function upsertFinalMatchSafe(
  db: any,
  row: {
    bracket_id: string;
    round_no: number;
    match_no: number;
    winner_id: string | null;
    loser_id: string | null;
    winner_score: number | null;
    loser_score: number | null;
    reason: string; // normal/time_limit/forfeit
    sets?: any;
  }
) {
  // key列が match_no か match_index かを吸収
  const tryFind = async (keyCol: 'match_no' | 'match_index') => {
    const { data, error } = await (db.from('final_matches') as any)
      .select('id')
      .eq('bracket_id', row.bracket_id)
      .eq('round_no', row.round_no)
      .eq(keyCol, row.match_no)
      .maybeSingle();
    if (error) throw error;
    return { id: data?.id ? String(data.id) : null, keyCol };
  };

  let found: { id: string | null; keyCol: 'match_no' | 'match_index' } = { id: null, keyCol: 'match_no' };
  try {
    found = await tryFind('match_no');
  } catch (e: any) {
    if (isMissingColumnError(e)) {
      found = await tryFind('match_index');
    } else {
      throw e;
    }
  }

  const basePayload: any = {
    bracket_id: row.bracket_id,
    round_no: row.round_no,
    [found.keyCol]: row.match_no,
    winner_id: row.winner_id,
    loser_id: row.loser_id,
    winner_score: row.winner_score,
    loser_score: row.loser_score,
  };

  const payloads: any[] = [
    { ...basePayload, end_reason: row.reason, sets: row.sets ?? null },
    { ...basePayload, finish_reason: row.reason, sets: row.sets ?? null },
    { ...basePayload, end_reason: row.reason },
    { ...basePayload, finish_reason: row.reason },
    { ...basePayload, sets: row.sets ?? null },
    { ...basePayload },
  ];

  const tryUpdate = async (id: string, payload: any) => {
    const { error } = await (db.from('final_matches') as any).update(payload).eq('id', id);
    if (error) throw error;
  };

  const tryInsert = async (payload: any) => {
    const { error } = await (db.from('final_matches') as any).insert(payload);
    if (error) throw error;
  };

  if (found.id) {
    let lastErr: any = null;
    for (const p of payloads) {
      try {
        await tryUpdate(found.id, p);
        return;
      } catch (e: any) {
        lastErr = e;
        if (isMissingColumnError(e)) continue;
        throw e;
      }
    }
    throw new Error(String(lastErr?.message || 'final_matches update failed'));
  } else {
    let lastErr: any = null;
    for (const p of payloads) {
      try {
        await tryInsert(p);
        return;
      } catch (e: any) {
        lastErr = e;
        if (isMissingColumnError(e)) continue;
        throw e;
      }
    }
    throw new Error(String(lastErr?.message || 'final_matches insert failed'));
  }
}

export default function AdminTournamentFinalsPage() {
  const router = useRouter();
  const params = useParams();

  // ✅ Supabaseは「コンポーネント内で」生成（最重要：UI変更なし）
  const supabase = useMemo(() => createClient(), []);
  const db: any = supabase;

  const tournamentId = useMemo(() => {
    const p = params as any;
    return paramToString(p?.tournamentId ?? p?.id ?? '');
  }, [params]);

  const [authz, setAuthz] = useState<'checking' | 'ok' | 'no'>('checking');

  const [bracket, setBracket] = useState<FinalBracket | null>(null);
  const [entries, setEntries] = useState<FinalRoundEntry[]>([]);
  const [matches, setMatches] = useState<FinalMatchRow[]>([]);
  const [players, setPlayers] = useState<Record<string, Player>>({});

  const [leagueCandidates, setLeagueCandidates] = useState<LeagueCandidates | null>(null);

  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState('決勝トーナメント');
  const [creating, setCreating] = useState(false);

  const [winnerByBlock, setWinnerByBlock] = useState<Record<string, string>>({});

  // ✅ 形式（1回/3回）を各試合ごとに保持
  const [formatByKey, setFormatByKey] = useState<Record<string, MatchFormat>>({});

  const storageKey = useMemo(
    () => (tournamentId ? `admin_finals_visible_round_max:${tournamentId}` : 'admin_finals_visible_round_max'),
    [tournamentId]
  );
  const [manualMaxRound, setManualMaxRound] = useState<number | null>(null);

  useEffect(() => {
    if (manualMaxRound != null) return;
    try {
      const raw = localStorage.getItem(storageKey);
      const n = parseInt(String(raw ?? ''), 10);
      setManualMaxRound(Number.isFinite(n) ? n : 0);
    } catch {
      setManualMaxRound(0);
    }
  }, [manualMaxRound, storageKey]);

  const setManualMaxRoundAndPersist = (n: number) => {
    setManualMaxRound(n);
    try {
      localStorage.setItem(storageKey, String(n));
    } catch {}
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const redirectTo = tournamentId ? `/admin/tournaments/${tournamentId}/finals` : '/admin/dashboard';

        const r = await fetch('/auth/whoami', { cache: 'no-store' });
        const j = r.ok ? await r.json() : { authenticated: false };
        if (!j?.authenticated) {
          router.replace(`/login?redirect=${encodeURIComponent(redirectTo)}`);
          return;
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace(`/login?redirect=${encodeURIComponent(redirectTo)}`);
          return;
        }

        const [adminResp, playerResp] = await Promise.all([
          (db.from('app_admins') as any).select('user_id').eq('user_id', user.id).maybeSingle(),
          (db.from('players') as any).select('is_admin').eq('id', user.id).maybeSingle(),
        ]);

        const adminRow = (adminResp?.data ?? null) as AdminRow | null;
        const playerRow = (playerResp?.data ?? null) as PlayerFlagRow | null;
        const isAdmin = Boolean(adminRow?.user_id) || playerRow?.is_admin === true;

        if (!isAdmin) {
          if (!cancelled) setAuthz('no');
          return;
        }

        if (!cancelled) {
          setAuthz('ok');
          void loadAll();
        }
      } catch (e) {
        console.error('[admin/finals] auth error:', e);
        if (!cancelled) setAuthz('no');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, tournamentId, supabase]);

  const loadAll = async () => {
    if (!tournamentId) return;

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { data: allPlayers, error: apErr } = await (db.from('players') as any)
        .select('id,handle_name,avatar_url,ranking_points,handicap,is_dummy')
        .order('handle_name', { ascending: true });

      if (apErr) console.warn('[admin/finals] players(all) fetch error:', apErr);

      const dict: Record<string, Player> = {};
      (allPlayers ?? []).forEach((p: any) => {
        dict[p.id] = {
          id: p.id,
          handle_name: p.handle_name,
          avatar_url: p.avatar_url,
          ranking_points: p.ranking_points,
          handicap: p.handicap,
          is_dummy: p.is_dummy ?? null,
        };
      });
      setPlayers(dict);

      const c = await loadLeagueCandidates(db, tournamentId);
      setLeagueCandidates(c);

      if (c?.blocks?.length) {
        setWinnerByBlock((prev) => {
          const next = { ...prev };
          for (const b of c.blocks) {
            if (!next[b.block_id]) next[b.block_id] = b.rows[0]?.player_id ?? '';
          }
          return next;
        });
      }

      const { data: bRows, error: bErr } = await (db.from('final_brackets') as any)
        .select('id,tournament_id,title,created_at')
        .eq('tournament_id', tournamentId)
        .order('created_at', { ascending: false });

      if (bErr) {
        setError('決勝トーナメントの取得に失敗しました');
        setBracket(null);
        setEntries([]);
        setMatches([]);
        setLoading(false);
        return;
      }

      if (!bRows || bRows.length === 0) {
        setBracket(null);
        setEntries([]);
        setMatches([]);
        setLoading(false);
        return;
      }

      const b = bRows[0] as FinalBracket;
      setBracket(b);

      const { data: eRows, error: eErr } = await (db.from('final_round_entries') as any)
        .select('id,bracket_id,round_no,slot_no,player_id')
        .eq('bracket_id', b.id)
        .order('round_no', { ascending: true })
        .order('slot_no', { ascending: true });

      if (eErr) {
        setError('決勝トーナメント枠の取得に失敗しました');
        setLoading(false);
        return;
      }
      const es = (eRows ?? []) as FinalRoundEntry[];
      setEntries(es);

      let ms: FinalMatchRow[] = [];
      try {
        ms = await fetchFinalMatchesOnce(db, b.id);
      } catch (e) {
        console.error('[admin/finals] final_matches fetch error:', e);
        setError('決勝トーナメント試合結果の取得に失敗しました');
        setLoading(false);
        return;
      }
      setMatches(ms);

      setLoading(false);
    } catch (e: any) {
      console.error('[admin/finals] fatal:', e);
      setError(e?.message || 'データ取得に失敗しました');
      setLoading(false);
    }
  };

  const entryMap = useMemo(() => {
    const map = new Map<string, FinalRoundEntry>();
    for (const e of entries) map.set(`${e.round_no}:${e.slot_no}`, e);
    return map;
  }, [entries]);

  const matchByRoundMatch = useMemo(() => {
    const map = new Map<string, FinalMatchRow>();
    const groups = new Map<number, FinalMatchRow[]>();

    for (const m of matches) {
      const r = Number(m.round_no ?? 0);
      if (!r) continue;
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r)!.push(m);
    }

    groups.forEach((list, r) => {
      const sorted = [...list].sort((a, b) => {
        const aNo = Number(a.match_no ?? a.match_index ?? 0);
        const bNo = Number(b.match_no ?? b.match_index ?? 0);
        if (aNo && bNo && aNo !== bNo) return aNo - bNo;

        const ac = String(a.created_at ?? '');
        const bc = String(b.created_at ?? '');
        if (ac && bc && ac !== bc) return ac < bc ? -1 : 1;

        return String(a.id).localeCompare(String(b.id));
      });

      sorted.forEach((m, i) => {
        const within = i + 1;
        map.set(`${r}:${within}`, m);

        const idx = Number(m.match_index ?? 0);
        if (idx > 0 && !map.has(`${r}:${idx}`)) map.set(`${r}:${idx}`, m);

        const no = Number(m.match_no ?? 0);
        if (no > 0 && !map.has(`${r}:${no}`)) map.set(`${r}:${no}`, m);
      });
    });

    return map;
  }, [matches]);

  const structuralMaxRound = useMemo(() => {
    let max = 1;
    entries.forEach((e) => {
      const r = Number(e.round_no ?? 0);
      if (r > max) max = r;
    });
    matches.forEach((m) => {
      const r = Number(m.round_no ?? 0);
      if (r > max) max = r;
    });
    return max;
  }, [entries, matches]);

  const visibleMaxRound = Math.max(structuralMaxRound, manualMaxRound ?? 0, 1);
  const visibleRounds = useMemo(() => Array.from({ length: visibleMaxRound }, (_, i) => i + 1), [visibleMaxRound]);

  const getMatchCountForRound = (roundNo: number) => {
    const maxSlot = entries.filter((e) => e.round_no === roundNo).reduce((mx, e) => Math.max(mx, e.slot_no), 0);
    const fromEntries = Math.max(1, Math.floor(maxSlot / 2));
    const fromMatches = matches.filter((m) => Number(m.round_no ?? 0) === roundNo).length;
    return Math.max(fromEntries, fromMatches, 1);
  };

  const defIds = useMemo(() => {
    const s = new Set<string>();
    Object.values(players).forEach((p) => {
      const name = String(p.handle_name ?? '').trim().toLowerCase();
      if (name === 'def' || p.is_dummy === true) s.add(p.id);
    });
    return s;
  }, [players]);

  const hadDefByeBefore = (playerId: string, beforeRound: number) => {
    if (!playerId) return false;
    if (beforeRound <= 1) return false;

    for (let r = 1; r < beforeRound; r++) {
      const maxSlot = entries.filter((e) => e.round_no === r).reduce((mx, e) => Math.max(mx, e.slot_no), 0);
      const mc = Math.max(1, Math.floor(maxSlot / 2));
      for (let m = 1; m <= mc; m++) {
        const pidA = entryMap.get(`${r}:${m * 2 - 1}`)?.player_id ?? null;
        const pidB = entryMap.get(`${r}:${m * 2}`)?.player_id ?? null;
        if (!pidA || !pidB) continue;

        const aDef = defIds.has(pidA);
        const bDef = defIds.has(pidB);
        if (aDef === bDef) continue;

        const real = aDef ? pidB : pidA;
        if (real === playerId) return true;
      }
    }
    return false;
  };

  const computeAdvantage = (roundNo: number, pidA: string | null, pidB: string | null) => {
    if (!pidA || !pidB) return { advA: 0, advB: 0, forcedBo3: false, aHadBye: false, bHadBye: false };
    if (defIds.has(pidA) || defIds.has(pidB)) {
      return { advA: 0, advB: 0, forcedBo3: false, aHadBye: false, bHadBye: false };
    }

    const aHadBye = hadDefByeBefore(pidA, roundNo);
    const bHadBye = hadDefByeBefore(pidB, roundNo);

    let advA = 0;
    let advB = 0;

    if (aHadBye !== bHadBye) {
      if (aHadBye) advB = 1;
      if (bHadBye) advA = 1;
    }

    const forcedBo3 = advA > 0 || advB > 0;
    return { advA, advB, forcedBo3, aHadBye, bHadBye };
  };

  const formatPlayerOption = (p: Player) => {
    const name = p.handle_name ?? '(名前未設定)';
    return `${name}  (RP:${p.ranking_points ?? 0} / HC:${p.handicap ?? 0})`;
  };

  const hasDef = useMemo(() => defIds.size > 0, [defIds]);

  const nominees = useMemo(() => {
    const ids = leagueCandidates?.blocks?.map((b) => winnerByBlock[b.block_id]).filter(Boolean) ?? [];
    return Array.from(new Set(ids.map(String)));
  }, [leagueCandidates, winnerByBlock]);

  const duplicateWarn = useMemo(() => {
    if (!leagueCandidates?.blocks?.length) return null;
    const picked = leagueCandidates.blocks.map((b) => winnerByBlock[b.block_id]).filter(Boolean);
    const uniq = new Set(picked);
    if (picked.length !== uniq.size) return '同じ人が複数ブロックで選択されています（重複を解消してください）';
    return null;
  }, [leagueCandidates, winnerByBlock]);

  const allBlocksChosen = useMemo(() => {
    if (!leagueCandidates?.blocks?.length) return false;
    return leagueCandidates.blocks.every((b) => Boolean(String(winnerByBlock[b.block_id] ?? '').trim()));
  }, [leagueCandidates, winnerByBlock]);

  const hint = useMemo(() => {
    const n = nominees.length;
    if (!leagueCandidates?.blocks?.length) return 'ブロック情報未取得（league_block_winners_v を確認）';
    if (!allBlocksChosen) return '各ブロックの勝者を選択してください';
    if (duplicateWarn) return '重複があります';
    if (n < 2) return `勝者が2ブロック以上必要です（現在 ${n}人）`;
    if (isPowerOfTwo(n)) return `OK（${n}人）`;
    return `OK（${n}人：不足分は def 自動補完）`;
  }, [nominees.length, leagueCandidates, allBlocksChosen, duplicateWarn]);

  const resetWinnersToTop = () => {
    if (!leagueCandidates?.blocks?.length) return;
    setWinnerByBlock(() => {
      const next: Record<string, string> = {};
      for (const b of leagueCandidates.blocks) next[b.block_id] = b.rows[0]?.player_id ?? '';
      return next;
    });
  };

  const handleCreateBracket = async () => {
    setError(null);
    setMessage(null);

    if (!leagueCandidates?.blocks?.length) {
      setError('予選ブロック勝者を取得できません（league_block_winners_v を確認してください）');
      return;
    }
    if (!allBlocksChosen) {
      setError('各ブロックの勝者を選択してください');
      return;
    }
    if (duplicateWarn) {
      setError(duplicateWarn);
      return;
    }
    if (nominees.length < 2) {
      setError('勝者が2ブロック以上必要です');
      return;
    }

    setSavingKey('create');
    setCreating(true);

    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/league/finals`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: createTitle,
          nominees,
        }),
      });

      const j = await res.json().catch(() => null);
      if (!res.ok || j?.ok === false) throw new Error(j?.message || `HTTP ${res.status}`);

      let newBracketId = String(j?.bracket_id ?? j?.bracketId ?? '').trim();

      if (!newBracketId) {
        const rb = await (db.from('final_brackets') as any)
          .select('id')
          .eq('tournament_id', tournamentId)
          .order('created_at', { ascending: false })
          .limit(1);
        if (!rb?.error && Array.isArray(rb?.data) && rb.data[0]?.id) newBracketId = String(rb.data[0].id);
      }

      if (newBracketId) {
        try {
          await deleteFinalRoundsFrom(db, newBracketId, 2); // R1だけ残す
          setManualMaxRoundAndPersist(1);
        } catch (e) {
          console.warn('[admin/finals] trim to R1 failed:', e);
        }
      }

      const padded = Number(j?.padded_count ?? 0);
      const baseMsg =
        padded > 0 ? `決勝トーナメントを作成しました（defを${padded}枠自動追加）` : '決勝トーナメントを作成しました';
      setMessage(`${baseMsg} / R2以降は手動追加のため削除しました`);
      setShowCreate(false);

      await loadAll();
    } catch (e: any) {
      setError(`新規作成に失敗しました: ${e?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
      setCreating(false);
    }
  };

  const handleChangeEntry = async (entry: FinalRoundEntry, nextPlayerId: string) => {
    setError(null);
    setMessage(null);
    setSavingKey(`entry:${entry.id}`);

    try {
      const next = nextPlayerId ? nextPlayerId : null;

      const { error } = await (db.from('final_round_entries') as any).update({ player_id: next } as any).eq('id', entry.id);
      if (error) throw new Error(error.message);

      if (bracket?.id) {
        await clearFinalMatchesFromRound(db, bracket.id, entry.round_no);
      }

      setMessage('枠を更新しました（このラウンド以降の試合結果をクリアしました）');
      await loadAll();
    } catch (e: any) {
      console.error('[admin/finals] entry update error:', e);
      setError(`枠の更新に失敗しました: ${e?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
    }
  };

  const handleDeleteFromRound = async (fromRound: number) => {
    if (!bracket?.id) return;

    setError(null);
    setMessage(null);

    const key = `delete:${fromRound}`;
    setSavingKey(key);

    try {
      const ok = window.confirm(
        `R${fromRound}以降のラウンドを削除します。\n（R${fromRound}以降の枠と試合結果が削除されます）\n\n本当に削除しますか？`
      );
      if (!ok) {
        setSavingKey(null);
        return;
      }

      await deleteFinalRoundsFrom(db, bracket.id, fromRound);

      if ((manualMaxRound ?? 0) >= fromRound) setManualMaxRoundAndPersist(Math.max(fromRound - 1, 0));

      setMessage(`R${fromRound}以降のラウンドを削除しました`);
      await loadAll();
    } catch (e: any) {
      console.error('[admin/finals] delete rounds error:', e);
      setError(`削除に失敗しました: ${e?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
    }
  };

  const handleAddSlots = async (roundNo: number, addCount = 2) => {
    if (!bracket?.id) return;
    setError(null);
    setMessage(null);
    const key = `addslots:${roundNo}`;
    setSavingKey(key);

    try {
      const currentMax = entries.filter((e) => e.round_no === roundNo).reduce((mx, e) => Math.max(mx, e.slot_no), 0);
      const rows = Array.from({ length: addCount }).map((_, i) => ({
        bracket_id: bracket.id,
        round_no: roundNo,
        slot_no: currentMax + i + 1,
        player_id: null,
      }));

      const { error: insErr } = await (db.from('final_round_entries') as any).insert(rows as any);
      if (insErr) throw new Error(insErr.message);

      await clearFinalMatchesFromRound(db, bracket.id, roundNo);

      setMessage(`R${roundNo}に枠を追加しました（以降の試合結果をクリア）`);
      await loadAll();
    } catch (e: any) {
      console.error('[admin/finals] add slots error:', e);
      setError(`枠追加に失敗しました: ${e?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
    }
  };

  const handleAddRound = async () => {
    const next = visibleMaxRound + 1;
    setManualMaxRoundAndPersist(next);
    await handleAddSlots(next, 2);
  };

  // ✅ 形式の初期値（読み込み時）
  useEffect(() => {
    if (!bracket?.id) return;

    setFormatByKey((prev) => {
      const next = { ...prev };

      for (const r of visibleRounds) {
        const matchCount = getMatchCountForRound(r);

        for (let i = 0; i < matchCount; i++) {
          const matchNo = i + 1;
          const slotA = matchNo * 2 - 1;
          const slotB = matchNo * 2;
          const pidA = entryMap.get(`${r}:${slotA}`)?.player_id ?? null;
          const pidB = entryMap.get(`${r}:${slotB}`)?.player_id ?? null;

          const { forcedBo3 } = computeAdvantage(r, pidA, pidB);

          const key = `${r}:${matchNo}`;
          if (next[key]) continue;

          const m = matchByRoundMatch.get(`${r}:${matchNo}`) ?? null;
          next[key] = inferFormatFromMatch(m, forcedBo3);
        }
      }

      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bracket?.id, visibleRounds, entries, matches, players]);

  const handleReportSingle = async (
    e: FormEvent<HTMLFormElement>,
    roundNo: number,
    matchNo: number,
    pidA: string | null,
    pidB: string | null
  ) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!bracket?.id) {
      setError('bracket_id が取得できません');
      return;
    }

    if (!pidA || !pidB) {
      setError('参加者が未設定です（枠を先に設定してください）');
      return;
    }

    const form = e.currentTarget;
    const end_reason = String((form.elements.namedItem('end_reason') as HTMLSelectElement)?.value || 'normal')
      .trim()
      .toLowerCase();

    const winner_id = String((form.elements.namedItem('winner_id') as HTMLSelectElement)?.value || '').trim();
    if (!winner_id) {
      setError('勝者を選択してください');
      return;
    }
    if (winner_id !== pidA && winner_id !== pidB) {
      setError('勝者が不正です');
      return;
    }

    const loser_id = winner_id === pidA ? pidB : pidA;

    const winner_score = clampInt((form.elements.namedItem('winner_score') as HTMLInputElement)?.value, 0, 99, 15);
    const loser_score = clampInt((form.elements.namedItem('loser_score') as HTMLInputElement)?.value, 0, 99, 0);
    if (winner_score <= loser_score) {
      setError('スコアが不正です（勝者スコア > 敗者スコア）');
      return;
    }

    const saveKey = `match:${roundNo}:${matchNo}`;
    setSavingKey(saveKey);

    try {
      // まずはAPI（既存運用を維持）
      try {
        await postFinalReport({
          bracket_id: bracket.id,
          round_no: roundNo,
          match_no: matchNo,
          winner_id,
          loser_id,
          winner_score,
          loser_score,
          end_reason,
          sets: { format: 'single' },
        });
      } catch (apiErr: any) {
        // APIが無い/落ちる場合はフォールバック
        console.warn('[admin/finals] report(single) api failed -> fallback', apiErr);
        await upsertFinalMatchSafe(db, {
          bracket_id: bracket.id,
          round_no: roundNo,
          match_no: matchNo,
          winner_id,
          loser_id,
          winner_score,
          loser_score,
          reason: end_reason,
          sets: { format: 'single' },
        });
      }

      setMessage('保存しました');
      await loadAll();
    } catch (e2: any) {
      console.error('[admin/finals] report(single) error:', e2);
      setError(`保存に失敗しました: ${e2?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
    }
  };

  const handleReportBestOf3 = async (
    e: FormEvent<HTMLFormElement>,
    roundNo: number,
    matchNo: number,
    pidA: string | null,
    pidB: string | null,
    advA: number,
    advB: number
  ) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!bracket?.id) {
      setError('bracket_id が取得できません');
      return;
    }
    if (!pidA || !pidB) {
      setError('参加者が未設定です（枠を先に設定してください）');
      return;
    }

    const form = e.currentTarget;
    const end_reason = String((form.elements.namedItem('end_reason') as HTMLSelectElement)?.value || 'normal')
      .trim()
      .toLowerCase();

    const s1a = clampInt((form.elements.namedItem('set1_a') as HTMLInputElement)?.value, 0, 99, -1);
    const s1b = clampInt((form.elements.namedItem('set1_b') as HTMLInputElement)?.value, 0, 99, -1);
    const s2a = clampInt((form.elements.namedItem('set2_a') as HTMLInputElement)?.value, 0, 99, -1);
    const s2b = clampInt((form.elements.namedItem('set2_b') as HTMLInputElement)?.value, 0, 99, -1);
    const s3a = clampInt((form.elements.namedItem('set3_a') as HTMLInputElement)?.value, 0, 99, -1);
    const s3b = clampInt((form.elements.namedItem('set3_b') as HTMLInputElement)?.value, 0, 99, -1);

    const games: Array<{ a: number | null; b: number | null }> = [
      { a: s1a < 0 ? null : s1a, b: s1b < 0 ? null : s1b },
      { a: s2a < 0 ? null : s2a, b: s2b < 0 ? null : s2b },
      { a: s3a < 0 ? null : s3a, b: s3b < 0 ? null : s3b },
    ];

    const manualWinner = String((form.elements.namedItem('winner_id') as HTMLSelectElement)?.value || '').trim();

    const win = calcBo3Wins(pidA, pidB, games, advA, advB);

    let winner_id = win.winner_id;
    let loser_id = win.loser_id;

    if (!winner_id && manualWinner) {
      if (manualWinner !== pidA && manualWinner !== pidB) {
        setError('勝者が不正です');
        return;
      }
      if (win.totalA < 2 && win.totalB < 2) {
        setError('勝者を確定できません（セット結果が不足）。少なくともどちらかが2勝に到達するよう入力してください。');
        return;
      }
      winner_id = manualWinner;
      loser_id = manualWinner === pidA ? pidB : pidA;
    }

    if (!winner_id || !loser_id) {
      setError('勝者を確定できません（セット結果が不足）。');
      return;
    }

    const winner_score = winner_id === pidA ? win.totalA : win.totalB;
    const loser_score = winner_id === pidA ? win.totalB : win.totalA;

    const saveKey = `match:${roundNo}:${matchNo}`;
    setSavingKey(saveKey);

    try {
      const setsPayload = {
        format: 'bo3',
        advantage: { a: advA, b: advB },
        games,
      };

      try {
        await postFinalReport({
          bracket_id: bracket.id,
          round_no: roundNo,
          match_no: matchNo,
          winner_id,
          loser_id,
          winner_score,
          loser_score,
          end_reason,
          sets: setsPayload,
        });
      } catch (apiErr: any) {
        console.warn('[admin/finals] report(bo3) api failed -> fallback', apiErr);
        await upsertFinalMatchSafe(db, {
          bracket_id: bracket.id,
          round_no: roundNo,
          match_no: matchNo,
          winner_id,
          loser_id,
          winner_score,
          loser_score,
          reason: end_reason,
          sets: setsPayload,
        });
      }

      setMessage('保存しました');
      await loadAll();
    } catch (e2: any) {
      console.error('[admin/finals] report(bo3) error:', e2);
      setError(`保存に失敗しました: ${e2?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
    }
  };

  if (authz === 'checking') {
    return <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">認証を確認しています...</div>;
  }
  if (authz === 'no') {
    return <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">アクセス権限がありません</div>;
  }
  if (!tournamentId) {
    return <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">大会IDが指定されていません</div>;
  }

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8">
        {/* header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full">
              <FaShieldAlt className="text-2xl" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">決勝トーナメント管理</h1>
              <div className="text-sm text-gray-300 mt-1">
                {bracket?.title ?? '（未作成）'}
                <span className="ml-2 text-xs text-gray-400">（大会ID: {tournamentId}）</span>
              </div>
              <div className="text-[11px] text-gray-400 mt-1">
                ✅ 基本は3回勝負（2勝先取）。試合ごとに「1回勝負」も選択できます。<br />
                ✅ 過去に def 勝ち上がりした選手と当たる場合は、通常勝ち上がり側に「+1勝」アドバンテージがつき、3回勝負固定になります。
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <button type="button" onClick={() => setShowCreate((v) => !v)} className="text-blue-300 underline">
              {showCreate ? '新規作成を閉じる' : '決勝を新規作成'}
            </button>

            <Link href={`/admin/tournaments/${tournamentId}/league`} className="text-blue-300 underline">
              ← 予選（リーグ）へ
            </Link>
            <Link href={`/tournaments/${tournamentId}/finals`} className="text-blue-300 underline">
              表画面で確認 →
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-4 rounded-md border border-green-500/50 bg-green-500/10 px-4 py-2 text-sm text-green-200">
            {message}
          </div>
        )}

        {/* ===== 新規作成UI ===== */}
        {showCreate && (
          <div className="mb-8 bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-4 md:p-6">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <FaTrophy className="text-yellow-300" />
                決勝トーナメントを新規作成（ブロック勝者）
              </h2>
              <div className="text-xs text-gray-300">
                選択: <span className="text-yellow-200 font-bold">{hint}</span>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3 mb-3">
              <div className="space-y-1">
                <div className="text-xs text-gray-300">タイトル（任意）</div>
                <input
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-purple-500/40 bg-gray-900/80 text-sm"
                  placeholder="決勝トーナメント"
                />
              </div>

              <div className="space-y-1">
                <div className="text-xs text-gray-300">取得元</div>
                <div className="w-full px-3 py-2 rounded border border-white/10 bg-black/20 text-sm text-gray-200">
                  {leagueCandidates?.source ?? '（未取得）'}
                </div>
              </div>
            </div>

            {!hasDef && (
              <div className="mb-3 rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-[12px] text-amber-200">
                ※ players に <b>handle_name =&quot;def&quot;</b> または <b>is_dummy = true</b> が見つかりません。人数が 2/4/8... にならない場合の
                <b>自動補完(def)</b> が失敗する可能性があります。
              </div>
            )}

            {duplicateWarn && (
              <div className="mb-3 rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-[12px] text-amber-200">
                {duplicateWarn}
              </div>
            )}

            <div className="flex items-center justify-between mb-3">
              <button type="button" onClick={resetWinnersToTop} className="text-xs text-gray-300 underline">
                勝者を「先頭」に戻す
              </button>

              <button
                type="button"
                disabled={creating || !allBlocksChosen || !!duplicateWarn || nominees.length < 2 || savingKey === 'create'}
                onClick={handleCreateBracket}
                className="px-4 py-2 rounded bg-purple-600 text-white text-xs md:text-sm disabled:opacity-50"
              >
                {savingKey === 'create' ? '作成中...' : '作成する'}
              </button>
            </div>

            <div className="text-xs text-gray-300 mb-2">
              ※ 候補は「各ブロック勝者のみ」です。不足分は <b>作成APIが def を自動補完</b>します。
            </div>

            {!leagueCandidates?.blocks?.length ? (
              <div className="text-gray-300 text-sm">
                ブロック勝者を取得できませんでした。<br />
                （league_block_winners_v が tournament_id で絞れない/データが無い等の可能性があります）
              </div>
            ) : (
              <div className="space-y-3">
                {leagueCandidates.blocks.map((b) => {
                  const chosen = winnerByBlock[b.block_id] ?? b.rows[0]?.player_id ?? '';
                  const chosenRow = b.rows.find((r) => r.player_id === chosen) ?? null;
                  const p = chosen ? players[chosen] : null;

                  return (
                    <div key={b.block_id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm font-bold">{b.block_label}</div>
                        <div className="text-[11px] text-gray-400">ブロック勝者を1名</div>
                      </div>

                      <div className="grid md:grid-cols-2 gap-3">
                        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                          <div className="text-xs text-gray-300 mb-2">勝者</div>
                          <select
                            value={chosen}
                            onChange={(e) =>
                              setWinnerByBlock((prev) => ({
                                ...prev,
                                [b.block_id]: e.target.value,
                              }))
                            }
                            className="w-full px-2 py-2 rounded border border-purple-500/40 bg-gray-900/80 text-xs md:text-sm"
                          >
                            <option value="">（未設定）</option>
                            {b.rows.map((r) => {
                              const pl = players[r.player_id];
                              const nm = pl?.handle_name ?? '未設定';
                              const extra =
                                r.rank != null || r.wins != null || r.point_diff != null
                                  ? ` (Rank:${r.rank ?? '-'} W:${r.wins ?? '-'} Diff:${r.point_diff ?? '-'})`
                                  : '';
                              return (
                                <option key={r.player_id} value={r.player_id}>
                                  {nm}
                                  {extra}
                                </option>
                              );
                            })}
                          </select>

                          <div className="mt-2 text-[11px] text-gray-400">
                            {chosenRow?.rank != null || chosenRow?.wins != null || chosenRow?.point_diff != null ? (
                              <>
                                参考: Rank {chosenRow?.rank ?? '-'} / W {chosenRow?.wins ?? '-'} / L{' '}
                                {chosenRow?.losses ?? '-'} / Diff {chosenRow?.point_diff ?? '-'}
                              </>
                            ) : (
                              <>※ winners_v が勝者のみ返す/結果列が無い場合は、ここは参考情報なしになります</>
                            )}
                          </div>
                        </div>

                        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                          <div className="text-xs text-gray-300 mb-2">選択中</div>
                          <div className="flex items-center gap-3">
                            {p?.avatar_url ? (
                              <img
                                src={p.avatar_url}
                                alt={p.handle_name ?? ''}
                                className="w-10 h-10 rounded-full object-cover border border-white/20"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-white/10 border border-white/20" />
                            )}
                            <div className="min-w-0">
                              <div className="text-sm font-semibold truncate">{p?.handle_name ?? '未設定'}</div>
                              <div className="text-[11px] text-gray-300">
                                RP:{p?.ranking_points ?? 0} / HC:{p?.handicap ?? 0}
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 text-[11px] text-gray-400">
                            ※ 決勝は基本 3回勝負（2勝先取）です。個別に1回勝負へ変更できます。
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="text-gray-300">読み込み中...</div>
        ) : !bracket ? (
          <div className="text-gray-300">決勝トーナメントが未作成です。上の「決勝を新規作成」から作成してください。</div>
        ) : (
          <div className="space-y-8">
            {/* entries */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-4 md:p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <FaTrophy className="text-yellow-300" />
                  参加者枠（ラウンドごと）
                </h2>

                <div className="flex items-center gap-3 text-xs">
                  <button
                    onClick={() => handleAddRound()}
                    disabled={savingKey?.startsWith('addslots:') || !bracket?.id}
                    className="text-blue-300 underline disabled:opacity-50"
                  >
                    ＋ラウンド追加
                  </button>

                  <button onClick={() => setManualMaxRoundAndPersist(0)} className="text-gray-300 underline" type="button">
                    表示ラウンドをリセット
                  </button>
                </div>
              </div>

              <div className="text-xs text-gray-300 mb-3">
                ※ 新規作成後はR1のみ。必要になったら「＋ラウンド追加」「＋枠追加」で増やします。
              </div>

              <div className="space-y-6">
                {visibleRounds.map((r) => {
                  const list = entries
                    .filter((e) => e.round_no === r)
                    .sort((a, b) => a.slot_no - b.slot_no);

                  return (
                    <div key={`round-entries-${r}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-bold">R{r}</div>
                        <button
                          type="button"
                          onClick={() => handleAddSlots(r, 2)}
                          disabled={!bracket?.id || savingKey === `addslots:${r}`}
                          className="text-xs text-blue-300 underline disabled:opacity-50"
                        >
                          {savingKey === `addslots:${r}` ? '追加中…' : '＋枠追加'}
                        </button>
                      </div>

                      {list.length === 0 ? (
                        <div className="text-gray-400 text-sm">枠がありません（＋枠追加 で作成できます）</div>
                      ) : (
                        <div className="grid gap-3 md:grid-cols-2">
                          {list.map((e) => {
                            const current = e.player_id ? players[e.player_id] : null;

                            return (
                              <div key={e.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                                <div className="text-xs text-gray-300 mb-2">
                                  R{e.round_no} / 枠{e.slot_no}
                                </div>

                                <div className="flex items-center gap-2 mb-2">
                                  {current?.avatar_url ? (
                                    <img
                                      src={current.avatar_url}
                                      alt={current.handle_name ?? ''}
                                      className="w-8 h-8 rounded-full object-cover border border-white/20"
                                    />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full bg-white/10 border border-white/20" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold truncate">{current?.handle_name ?? '未設定'}</div>
                                    <div className="text-[11px] text-gray-300">
                                      RP:{current?.ranking_points ?? 0} / HC:{current?.handicap ?? 0}
                                    </div>
                                  </div>
                                </div>

                                <select
                                  value={e.player_id ?? ''}
                                  onChange={(ev) => handleChangeEntry(e, ev.target.value)}
                                  disabled={savingKey === `entry:${e.id}`}
                                  className="w-full px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs md:text-sm disabled:opacity-60"
                                >
                                  <option value="">（未設定）</option>
                                  {Object.values(players).map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {formatPlayerOption(p)}
                                    </option>
                                  ))}
                                </select>

                                <div className="mt-2 text-[11px] text-gray-400">
                                  ※ 枠を変更すると R{e.round_no} 以降の試合結果は自動クリアされます（取り残し防止）
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* results input */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-4 md:p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <FaTrophy className="text-yellow-300" />
                試合結果入力（形式選択対応）
              </h2>

              <div className="text-xs text-gray-300 mb-3 space-y-1">
                <div>※ 基本は「3回勝負（2勝先取）」。試合ごとに「1回勝負」へ変更できます。</div>
                <div>※ ただし「def勝ち上がり」vs「通常勝ち上がり」の場合は、通常側に +1勝Adv が付くため 3回勝負固定です。</div>
                <div>※ ラウンド構成を変える場合は「これ以降のラウンドを削除」で余計なラウンドを消してください。</div>
              </div>

              {visibleRounds.map((r) => {
                const matchCount = getMatchCountForRound(r);

                return (
                  <div key={`round-input-${r}`} className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-bold">R{r}</div>
                      <button
                        type="button"
                        onClick={() => handleDeleteFromRound(r)}
                        disabled={!bracket?.id || savingKey === `delete:${r}`}
                        className="text-xs text-rose-300 underline disabled:opacity-50"
                      >
                        {savingKey === `delete:${r}` ? '削除中…' : 'これ以降のラウンドを削除'}
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm border-collapse">
                        <thead>
                          <tr className="bg-gray-800 text-gray-100 text-xs">
                            <th className="border px-2 py-1 text-left">試合</th>
                            <th className="border px-2 py-1 text-left">形式</th>
                            <th className="border px-2 py-1 text-left">現状</th>
                            <th className="border px-2 py-1 text-left">結果入力</th>
                          </tr>
                        </thead>

                        <tbody>
                          {Array.from({ length: matchCount }).map((_, idx) => {
                            const matchNo = idx + 1;
                            const slotA = matchNo * 2 - 1;
                            const slotB = matchNo * 2;

                            const pidA = entryMap.get(`${r}:${slotA}`)?.player_id ?? null;
                            const pidB = entryMap.get(`${r}:${slotB}`)?.player_id ?? null;

                            const pA = pidA ? players[pidA] : null;
                            const pB = pidB ? players[pidB] : null;

                            const aName = pA?.handle_name ?? '未設定';
                            const bName = pB?.handle_name ?? '未設定';

                            const m = matchByRoundMatch.get(`${r}:${matchNo}`) ?? null;
                            const reason = m ? normalizeReason(m) : 'normal';

                            const adv = computeAdvantage(r, pidA, pidB);
                            const forcedBo3 = adv.forcedBo3;

                            const key = `${r}:${matchNo}`;
                            const fmt = forcedBo3 ? 'bo3' : (formatByKey[key] ?? inferFormatFromMatch(m, forcedBo3));

                            let currentResult = '未入力';
                            if (m?.winner_id && m?.loser_id) {
                              if (fmt === 'bo3') {
                                const meta = parseSetsMeta(m.sets);
                                const g = meta.games.length ? meta.games : [];
                                const wName = players[m.winner_id]?.handle_name ?? '勝者';
                                const lName = players[m.loser_id]?.handle_name ?? '敗者';
                                currentResult = `${wName} ${m.winner_score ?? '-'}-${m.loser_score ?? '-'} ${lName}`;
                                if (!m.winner_score && pidA && pidB) {
                                  const x = calcBo3Wins(pidA, pidB, g, meta.advantageA, meta.advantageB);
                                  currentResult = `${wName} ${m.winner_score ?? (m.winner_id === pidA ? x.totalA : x.totalB)}-${m.loser_score ?? (m.loser_id === pidA ? x.totalA : x.totalB)} ${lName}`;
                                }
                              } else {
                                const wName = players[m.winner_id]?.handle_name ?? '勝者';
                                const lName = players[m.loser_id]?.handle_name ?? '敗者';
                                currentResult = `${wName} ${m.winner_score ?? '-'}-${m.loser_score ?? '-'} ${lName}`;
                              }
                            }

                            const setsParsed = parseSetsMeta(m?.sets);
                            const existingGames = setsParsed.games;

                            const getSetDefault = (i: number, side: 'a' | 'b') => {
                              const v = existingGames?.[i]?.[side];
                              return typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
                            };

                            return (
                              <tr key={`r${r}-m${matchNo}`}>
                                <td className="border px-2 py-2 align-top">
                                  <div className="flex flex-col">
                                    <span>{aName}</span>
                                    <span className="text-xs text-gray-400">vs</span>
                                    <span>{bName}</span>
                                  </div>
                                  <div className="text-[11px] text-gray-400 mt-1">
                                    R{r} M{matchNo}
                                  </div>
                                  {forcedBo3 ? (
                                    <div className="mt-1 text-[11px] text-amber-200">
                                      Adv: {adv.advA ? `${aName}+1勝` : adv.advB ? `${bName}+1勝` : ''}
                                    </div>
                                  ) : null}
                                </td>

                                <td className="border px-2 py-2 align-top">
                                  <div className="text-[11px] text-gray-300 mb-1">形式</div>
                                  <select
                                    value={fmt}
                                    disabled={forcedBo3}
                                    onChange={(e) => {
                                      const v = e.target.value as MatchFormat;
                                      setFormatByKey((prev) => ({ ...prev, [key]: v }));
                                    }}
                                    className="px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs disabled:opacity-60"
                                  >
                                    <option value="bo3">3回勝負（2勝先取）</option>
                                    <option value="single">1回勝負</option>
                                  </select>
                                  {forcedBo3 ? (
                                    <div className="mt-1 text-[11px] text-gray-400">※ def勝ち上がり絡みのため固定</div>
                                  ) : null}
                                </td>

                                <td className="border px-2 py-2 align-top">
                                  <span className={m?.winner_id ? 'text-green-300' : 'text-gray-300'}>{currentResult}</span>
                                  {reason !== 'normal' && (
                                    <div className="mt-1 text-[11px] text-amber-200">
                                      種別:{' '}
                                      {reason === 'time_limit' ? '時間切れ' : reason === 'forfeit' ? '棄権/不戦' : reason}
                                    </div>
                                  )}
                                  {!pidA || !pidB ? (
                                    <div className="mt-1 text-[11px] text-red-200">※ 参加者が未設定です（枠を先に設定）</div>
                                  ) : null}
                                </td>

                                <td className="border px-2 py-2 align-top">
                                  {fmt === 'bo3' ? (
                                    <form
                                      onSubmit={(e) => handleReportBestOf3(e, r, matchNo, pidA, pidB, adv.advA, adv.advB)}
                                      className="space-y-2"
                                    >
                                      <div className="flex flex-wrap gap-2 items-center">
                                        <div className="text-xs text-gray-300">種別</div>
                                        <select
                                          name="end_reason"
                                          defaultValue={reason}
                                          className="px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs"
                                        >
                                          <option value="normal">通常</option>
                                          <option value="time_limit">時間切れ</option>
                                          <option value="forfeit">棄権/不戦</option>
                                        </select>

                                        <div className="text-xs text-gray-300 ml-2">勝者</div>
                                        <select
                                          name="winner_id"
                                          defaultValue={m?.winner_id ?? ''}
                                          className="min-w-[160px] px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs"
                                        >
                                          <option value="">（自動判定）</option>
                                          {pidA && <option value={pidA}>{aName}</option>}
                                          {pidB && <option value={pidB}>{bName}</option>}
                                        </select>

                                        <div className="text-[11px] text-gray-400">※基本はSet結果から自動判定</div>
                                      </div>

                                      {forcedBo3 ? (
                                        <div className="text-[11px] text-amber-200">
                                          この試合は Adv 付きです：
                                          {adv.advA ? ` ${aName} が +1勝スタート` : ''}
                                          {adv.advB ? ` ${bName} が +1勝スタート` : ''}
                                          （+1勝側が1回勝てば 2勝到達で確定）
                                        </div>
                                      ) : null}

                                      <div className="grid gap-2 md:grid-cols-3">
                                        {[
                                          { label: 'Set1', a: 'set1_a', b: 'set1_b', i: 0 },
                                          { label: 'Set2', a: 'set2_a', b: 'set2_b', i: 1 },
                                          { label: 'Set3', a: 'set3_a', b: 'set3_b', i: 2 },
                                        ].map((s) => (
                                          <div key={s.label} className="rounded-xl border border-white/10 bg-black/30 p-2">
                                            <div className="text-[11px] text-gray-300 mb-1">{s.label}</div>
                                            <div className="flex items-center gap-2">
                                              <input
                                                name={s.a}
                                                type="number"
                                                min={0}
                                                max={99}
                                                defaultValue={getSetDefault(s.i, 'a')}
                                                placeholder="(空欄OK)"
                                                className="w-14 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center text-xs"
                                              />
                                              <span className="text-gray-400 text-xs">-</span>
                                              <input
                                                name={s.b}
                                                type="number"
                                                min={0}
                                                max={99}
                                                defaultValue={getSetDefault(s.i, 'b')}
                                                placeholder="(空欄OK)"
                                                className="w-14 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center text-xs"
                                              />
                                            </div>
                                          </div>
                                        ))}
                                      </div>

                                      <button
                                        type="submit"
                                        disabled={savingKey === `match:${r}:${matchNo}`}
                                        className="w-full px-3 py-2 rounded bg-purple-600 text-white text-xs md:text-sm disabled:opacity-50"
                                      >
                                        {savingKey === `match:${r}:${matchNo}` ? '保存中...' : '保存'}
                                      </button>
                                    </form>
                                  ) : (
                                    <form
                                      onSubmit={(e) => handleReportSingle(e, r, matchNo, pidA, pidB)}
                                      className="flex flex-col md:flex-row md:items-center gap-2"
                                    >
                                      <select
                                        name="end_reason"
                                        defaultValue={reason}
                                        className="px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs md:text-sm"
                                      >
                                        <option value="normal">通常</option>
                                        <option value="time_limit">時間切れ</option>
                                        <option value="forfeit">棄権/不戦</option>
                                      </select>

                                      <select
                                        name="winner_id"
                                        defaultValue={m?.winner_id ?? ''}
                                        className="min-w-[140px] px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs md:text-sm"
                                      >
                                        <option value="">勝者を選択</option>
                                        {pidA && <option value={pidA}>{aName}</option>}
                                        {pidB && <option value={pidB}>{bName}</option>}
                                      </select>

                                      <div className="flex items-center gap-1 text-xs md:text-sm">
                                        <span className="text-gray-300">勝者</span>
                                        <input
                                          name="winner_score"
                                          type="number"
                                          min={0}
                                          max={99}
                                          defaultValue={m?.winner_score ?? 15}
                                          className="w-16 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center"
                                        />
                                      </div>

                                      <div className="flex items-center gap-1 text-xs md:text-sm">
                                        <span className="text-gray-300">敗者</span>
                                        <input
                                          name="loser_score"
                                          type="number"
                                          min={0}
                                          max={99}
                                          defaultValue={m?.loser_score ?? 0}
                                          className="w-16 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center"
                                        />
                                      </div>

                                      <button
                                        type="submit"
                                        disabled={savingKey === `match:${r}:${matchNo}`}
                                        className="mt-1 md:mt-0 px-3 py-1 rounded bg-purple-600 text-white text-xs md:text-sm disabled:opacity-50"
                                      >
                                        {savingKey === `match:${r}:${matchNo}` ? '保存中...' : m?.winner_id ? '更新' : '登録'}
                                      </button>
                                    </form>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

              <div className="text-right text-xs">
                <button onClick={() => loadAll()} className="text-blue-300 underline">
                  再読み込み
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
