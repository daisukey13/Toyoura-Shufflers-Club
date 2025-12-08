// app/(main)/admin/tournaments/[tournamentId]/finals/page.tsx
'use client';

import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FaShieldAlt, FaTrophy, FaPlus, FaSyncAlt, FaExclamationTriangle, FaListOl } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();
const fromAny = (table: string) => (supabase.from(table as any) as any);

type TournamentRow = {
  id: string;
  name: string | null;
  start_date: string | null;
  tournament_date?: string | null;
  size?: number | string | null;
  bracket_size?: number | string | null;
};

type FinalBracket = {
  id: string;
  tournament_id: string;
  title: string | null;
  created_at: string | null;
  [key: string]: any;
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
  winner_score?: number | null;
  loser_score?: number | null;
  finish_reason?: string | null;
  end_reason?: string | null;
  sets_json?: any;
  sets?: any;
  [key: string]: any;
};

type Player = {
  id: string;
  handle_name: string | null;
  avatar_url: string | null;
  ranking_points: number | null;
  handicap: number | null;
  is_dummy?: boolean | null;
  is_active?: boolean | null;
};

type LeagueBlock = {
  id: string;
  tournament_id: string;
  block_no?: number | null;

  title?: string | null;
  name?: string | null;
  label?: string | null;
  block_name?: string | null;

  block_index?: number | null;
  no?: number | null;
  block?: number | null;

  created_at?: string | null;
  [key: string]: any;
};

type LeagueMatchRow = {
  id: string;
  tournament_id?: string | null;
  status?: string | null;
  match_date?: string | null;

  league_block_id?: string | null;

  winner_id?: string | null;
  loser_id?: string | null;
  winner_score?: number | null;
  loser_score?: number | null;

  [key: string]: any;
};

type Stat = {
  player_id: string;
  wins: number;
  losses: number;
  played: number;
  scored: number;
  allowed: number;
  pd: number;
};

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const normalizeReason = (m: FinalMatchRow) => String(m.finish_reason ?? m.end_reason ?? 'normal').trim().toLowerCase();

const inferWinnerFromSets = (a: number[], b: number[]) => {
  let aWins = 0;
  let bWins = 0;
  for (let i = 0; i < 3; i++) {
    const as = a[i];
    const bs = b[i];
    if (as == null || bs == null) continue;
    if (as < 0 || bs < 0) continue;
    if (as === bs) continue;
    if (as > bs) aWins++;
    else bWins++;
  }
  if (aWins >= 2) return 'A' as const;
  if (bWins >= 2) return 'B' as const;
  return null;
};

/** ✅列が無い/スキーマキャッシュ系を広めに拾う（400/42703/PGRST系対応） */
const isMissingColumnError = (err: any) => {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '').toLowerCase();
  const details = String(err?.details ?? '').toLowerCase();
  const hint = String(err?.hint ?? '').toLowerCase();

  if (code === '42703') return true;
  if (code === 'PGRST204') return true;

  if (code.startsWith('PGRST')) {
    if (msg.includes('column') || msg.includes('schema cache') || details.includes('schema cache') || hint.includes('schema cache')) return true;
  }

  return (
    msg.includes('does not exist') ||
    msg.includes('unknown') ||
    msg.includes('column') ||
    msg.includes('schema cache') ||
    details.includes('schema cache') ||
    hint.includes('schema cache')
  );
};

async function fetchFinalMatchesOnce(bracketId: string): Promise<FinalMatchRow[]> {
  const { data, error } = await fromAny('final_matches').select('*').eq('bracket_id', bracketId).order('round_no', { ascending: true });
  if (!error) return (data ?? []) as FinalMatchRow[];

  const { data: data2, error: error2 } = await fromAny('final_matches').select('*').eq('bracket_id', bracketId);
  if (error2) throw new Error(String(error2.message || 'final_matches fetch failed'));
  return (data2 ?? []) as FinalMatchRow[];
}

async function postFinalReport(payload: {
  match_id: string; // ✅ 必須（final_matches.id）
  winner_id: string | null;
  loser_id: string | null;
  winner_score: number | null;
  loser_score: number | null;
  end_reason?: string | null; // UI側の種別
  finish_reason?: string | null; // 互換
  sets_json?: any[] | string | null;
}) {
  const match_id = String(payload.match_id ?? '').trim();
  if (!match_id) throw new Error('match_id is required');

  const reason = String(payload.finish_reason ?? payload.end_reason ?? 'normal').trim().toLowerCase() || 'normal';

  const res = await fetch('/api/finals/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      match_id,
      winner_id: payload.winner_id ?? null,
      loser_id: payload.loser_id ?? null,
      winner_score: payload.winner_score ?? null,
      loser_score: payload.loser_score ?? null,
      finish_reason: reason,
      end_reason: reason,
      sets_json: payload.sets_json ?? null,
    }),
  });

  const text = await res.text();
  let j: any = null;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
  }

  if (!res.ok || j?.ok === false) {
    throw new Error(j?.error || j?.message || `HTTP ${res.status}`);
  }

  return j;
}

async function clearFinalMatchesFromRound(bracketId: string, fromRoundNo: number) {
  const candidates: Record<string, any>[] = [
    {
      winner_id: null,
      loser_id: null,
      winner_score: null,
      loser_score: null,
      finish_reason: 'normal',
      end_reason: 'normal',
      sets_json: null,
      sets: null,
    },
    {
      winner_id: null,
      loser_id: null,
      winner_score: null,
      loser_score: null,
      finish_reason: null,
      end_reason: null,
      sets_json: null,
      sets: null,
    },
    {
      winner_id: null,
      loser_id: null,
      winner_score: null,
      loser_score: null,
      sets_json: null,
      sets: null,
    },
    { winner_id: null, loser_id: null, winner_score: null, loser_score: null },
    { winner_id: null, loser_id: null },
  ];

  let lastErr: any = null;
  for (const payload of candidates) {
    const { error } = await fromAny('final_matches').update(payload as any).eq('bracket_id', bracketId).gte('round_no', fromRoundNo);

    if (!error) return;

    lastErr = error;
    if (isMissingColumnError(error)) continue;
    break;
  }
  throw new Error(String(lastErr?.message || 'final_matches clear failed'));
}

async function fetchTournament(tournamentId: string): Promise<TournamentRow | null> {
  try {
    const r1 = await supabase.from('tournaments').select('id,name,start_date,tournament_date,size,bracket_size').eq('id', tournamentId).maybeSingle();
    if (!r1.error && r1.data) return r1.data as any;
  } catch {}

  try {
    const r2 = await supabase.from('tournaments').select('id,title,start_date,tournament_date,size,bracket_size').eq('id', tournamentId).maybeSingle();
    if (!r2.error && r2.data) {
      const d: any = r2.data;
      return { ...d, name: d.title ?? null } as TournamentRow;
    }
  } catch {}

  return null;
}

/** ✅予選ブロック優勝者（勝数→PD→得点） */
function buildLeagueWinners(
  blocks: LeagueBlock[],
  matches: LeagueMatchRow[],
  players: Record<string, Player>
): Array<{
  block: LeagueBlock;
  winner: (Stat & { name: string; is_dummy: boolean; is_inactive: boolean }) | null;
}> {
  const byBlock: Record<string, Record<string, Stat>> = {};

  const ensureStat = (blockId: string, playerId: string) => {
    if (!byBlock[blockId]) byBlock[blockId] = {};
    if (!byBlock[blockId][playerId]) byBlock[blockId][playerId] = { player_id: playerId, wins: 0, losses: 0, played: 0, scored: 0, allowed: 0, pd: 0 };
    return byBlock[blockId][playerId];
  };

  for (const m of matches) {
    const blockId = String(m.league_block_id ?? '').trim();
    if (!blockId) continue;

    const w = m.winner_id ?? null;
    const l = m.loser_id ?? null;
    const ws = typeof m.winner_score === 'number' ? m.winner_score : null;
    const ls = typeof m.loser_score === 'number' ? m.loser_score : null;

    if (!w || !l) continue;
    if (ws == null || ls == null) continue;

    const sw = ensureStat(blockId, w);
    const sl = ensureStat(blockId, l);

    sw.played += 1;
    sl.played += 1;
    sw.wins += 1;
    sl.losses += 1;

    sw.scored += ws;
    sw.allowed += ls;
    sw.pd += ws - ls;

    sl.scored += ls;
    sl.allowed += ws;
    sl.pd += ls - ws;
  }

  const result = blocks.map((b) => {
    const stats = Object.values(byBlock[b.id] ?? {});
    const rows = stats
      .map((s) => {
        const p = players[s.player_id];
        const name = p?.handle_name ?? '(名前未設定)';
        const is_dummy = p?.is_dummy === true;
        const is_inactive = p?.is_active === false;
        return { ...s, name, is_dummy, is_inactive };
      })
      .sort((a, b) => {
        if (a.wins !== b.wins) return b.wins - a.wins;
        if (a.pd !== b.pd) return b.pd - a.pd;
        if (a.scored !== b.scored) return b.scored - a.scored;
        return a.name.localeCompare(b.name);
      });

    return { block: b, winner: rows[0] ?? null };
  });

  result.sort((a, b) => {
    const an = Number(a.block.block_no ?? 0);
    const bn = Number(b.block.block_no ?? 0);
    if (an && bn && an !== bn) return an - bn;
    return String(a.block.id).localeCompare(String(b.block.id));
  });

  return result;
}

type MatchFormat = 'single' | 'bo3';

// ✅ sets配列の正規化（-1 を落とす） ※二重定義禁止なのでトップレベルに1回だけ
const normalizeSetsForPost = (raw: any): Array<{ a: number; b: number }> | null => {
  if (!raw) return null;
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : null;
  if (!Array.isArray(arr)) return null;

  const out: Array<{ a: number; b: number }> = [];
  for (const s of arr.slice(0, 5)) {
    const a = typeof s?.a === 'number' ? s.a : parseInt(String(s?.a ?? ''), 10);
    const b = typeof s?.b === 'number' ? s.b : parseInt(String(s?.b ?? ''), 10);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a < 0 || b < 0) continue;
    out.push({ a, b });
  }
  return out.length ? out : null;
};

export default function AdminTournamentFinalsPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = typeof (params as any)?.tournamentId === 'string' ? String((params as any).tournamentId) : '';

  const [authz, setAuthz] = useState<'checking' | 'ok' | 'no'>('checking');
  const [authErr, setAuthErr] = useState<string | null>(null);

  const [tournament, setTournament] = useState<TournamentRow | null>(null);

  const [bracket, setBracket] = useState<FinalBracket | null>(null);
  const [entries, setEntries] = useState<FinalRoundEntry[]>([]);
  const [matches, setMatches] = useState<FinalMatchRow[]>([]);
  const [players, setPlayers] = useState<Record<string, Player>>({});

  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [createAutoR1, setCreateAutoR1] = useState(true);
  const [createSize, setCreateSize] = useState<number>(8);

  // ✅予選の優勝者（参考）
  const [leagueBlocks, setLeagueBlocks] = useState<LeagueBlock[]>([]);
  const [leagueMatches, setLeagueMatches] = useState<LeagueMatchRow[]>([]);
  const [leagueError, setLeagueError] = useState<string | null>(null);

  // ✅表示ラウンド数（手動）
  const storageKey = useMemo(() => (tournamentId ? `admin_finals_visible_round_max:${tournamentId}` : 'admin_finals_visible_round_max'), [tournamentId]);
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

  // ✅各試合の形式（1試合/3セット）をローカル保存
  const formatStorageKey = useMemo(() => (tournamentId ? `admin_finals_match_format:${tournamentId}` : 'admin_finals_match_format'), [tournamentId]);
  const [formatMap, setFormatMap] = useState<Record<string, MatchFormat>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(formatStorageKey);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') setFormatMap(obj);
    } catch {}
  }, [formatStorageKey]);

  const setMatchFormat = (roundNo: number, matchNo: number, fmt: MatchFormat) => {
    const key = `${roundNo}:${matchNo}`;
    setFormatMap((prev) => {
      const next = { ...prev, [key]: fmt };
      try {
        localStorage.setItem(formatStorageKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // 認証（AuthContextに依存しない）
  useEffect(() => {
    if (!tournamentId) return;

    let cancelled = false;
    (async () => {
      setAuthz('checking');
      setAuthErr(null);

      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        const user = data?.user;

        if (!user) {
          router.replace(`/login?redirect=/admin/tournaments/${encodeURIComponent(tournamentId)}/finals`);
          return;
        }

        const { data: adminRow, error: aErr } = await (supabase.from('app_admins') as any).select('user_id').eq('user_id', user.id).maybeSingle();

        const isAdmin = !!adminRow?.user_id && !aErr;
        if (cancelled) return;

        if (!isAdmin) {
          setAuthz('no');
          return;
        }
        setAuthz('ok');
      } catch (e: any) {
        if (cancelled) return;
        setAuthz('no');
        setAuthErr(e?.message || '認証に失敗しました');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, tournamentId]);

  const loadAll = useCallback(async () => {
    if (!tournamentId) return;

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      // tournament
      const t = await fetchTournament(tournamentId);
      setTournament(t);

      // bracket
      const { data: bRows, error: bErr } = await fromAny('final_brackets')
        .select('id,tournament_id,title,created_at')
        .eq('tournament_id', tournamentId)
        .order('created_at', { ascending: false });

      if (bErr) {
        setBracket(null);
        setEntries([]);
        setMatches([]);
        setError(`決勝トーナメントの取得に失敗しました: ${String(bErr.message || '')}`);
      } else {
        const b = (bRows?.[0] ?? null) as FinalBracket | null;
        setBracket(b);

        if (!b) {
          setEntries([]);
          setMatches([]);
        } else {
          const { data: eRows, error: eErr } = await fromAny('final_round_entries')
            .select('id,bracket_id,round_no,slot_no,player_id')
            .eq('bracket_id', b.id)
            .order('round_no', { ascending: true })
            .order('slot_no', { ascending: true });

          if (eErr) {
            setEntries([]);
            setMatches([]);
            setError('決勝トーナメント枠の取得に失敗しました');
          } else {
            setEntries((eRows ?? []) as FinalRoundEntry[]);
            try {
              const ms = await fetchFinalMatchesOnce(b.id);
              setMatches(ms);
            } catch (e) {
              console.error('[admin/finals] final_matches fetch error:', e);
              setMatches([]);
              setError('決勝トーナメント試合結果の取得に失敗しました');
            }
          }
        }
      }

      // players（ダミー/無効も取る）
      const { data: allPlayers } = await supabase
        .from('players')
        .select('id,handle_name,avatar_url,ranking_points,handicap,is_dummy,is_active')
        .order('handle_name', { ascending: true });

      const dict: Record<string, Player> = {};
      (allPlayers ?? []).forEach((p: any) => {
        dict[p.id] = {
          id: p.id,
          handle_name: p.handle_name,
          avatar_url: p.avatar_url,
          ranking_points: p.ranking_points,
          handicap: p.handicap,
          is_dummy: p.is_dummy ?? null,
          is_active: p.is_active ?? null,
        };
      });
      setPlayers(dict);

      // ✅予選（参考表示）
      setLeagueError(null);
      try {
        const fetchLeagueBlocksFlexible = async (): Promise<LeagueBlock[]> => {
          const tournamentKeyCandidates = ['tournament_id', 'tournamentId', 'tournament_uuid', 'event_id', 'competition_id', 'league_id', 'season_id'] as const;

          const normalize = (rows: any[]): LeagueBlock[] => {
            const normalized = (rows ?? []).map((r: any) => {
              const blockNo = r.block_no ?? r.block_index ?? r.no ?? r.block ?? r.blockNo ?? r.blockIndex ?? null;
              const title = r.title ?? r.name ?? r.label ?? r.block_name ?? r.blockName ?? null;
              return { ...r, block_no: blockNo, title } as LeagueBlock;
            });

            normalized.sort((a: any, b: any) => {
              const an = Number(a.block_no ?? 0);
              const bn = Number(b.block_no ?? 0);
              if (an && bn && an !== bn) return an - bn;
              return String(a.id).localeCompare(String(b.id));
            });

            return normalized;
          };

          for (const key of tournamentKeyCandidates) {
            const { data, error } = await fromAny('league_blocks').select('*').eq(key, tournamentId);
            if (!error) return normalize(data ?? []);
            if (isMissingColumnError(error)) continue;
            throw error;
          }

          const { data: all, error: allErr } = await fromAny('league_blocks').select('*').limit(5000);
          if (allErr) throw allErr;

          const rows = (all ?? []) as any[];
          const filtered = rows.filter((r) => {
            for (const key of tournamentKeyCandidates) {
              if (r?.[key] && String(r[key]) === String(tournamentId)) return true;
            }
            return false;
          });

          return normalize(filtered);
        };

        const fetchLeagueMatchesFlexible = async (): Promise<LeagueMatchRow[]> => {
          const tournamentKeyCandidates = ['tournament_id', 'tournamentId', 'tournament_uuid', 'event_id', 'competition_id', 'league_id', 'season_id'] as const;

          const selectTries: Array<{ sel: string; blockKey: string | null }> = [
            { sel: 'id,tournament_id,status,match_date,league_block_id,winner_id,loser_id,winner_score,loser_score', blockKey: 'league_block_id' },
            { sel: 'id,tournament_id,status,match_date,league_blocks_id,winner_id,loser_id,winner_score,loser_score', blockKey: 'league_blocks_id' },
            { sel: 'id,tournament_id,status,match_date,block_id,winner_id,loser_id,winner_score,loser_score', blockKey: 'block_id' },
            { sel: 'id,tournament_id,status,match_date,winner_id,loser_id,winner_score,loser_score', blockKey: null },
          ];

          for (const tKey of tournamentKeyCandidates) {
            for (const t of selectTries) {
              const { data, error } = await supabase.from('matches').select(t.sel).eq(tKey as any, tournamentId);
              if (!error) {
                const normalized = (data ?? []).map((r: any) => ({
                  ...r,
                  league_block_id: t.blockKey ? (r[t.blockKey] ?? null) : null,
                })) as LeagueMatchRow[];
                return normalized;
              }
              if (isMissingColumnError(error)) continue;
              throw error;
            }
          }

          return [];
        };

        const lb = await fetchLeagueBlocksFlexible();
        setLeagueBlocks(lb);

        const rawMatches = await fetchLeagueMatchesFlexible();
        const filtered = rawMatches.filter((m) => {
          const st = String(m.status ?? '').toLowerCase();
          if (st === 'finalized' || st === 'completed' || st === 'done') return true;
          if (m.winner_id && m.loser_id && typeof m.winner_score === 'number' && typeof m.loser_score === 'number') return true;
          return false;
        });
        setLeagueMatches(filtered);
      } catch (e: any) {
        setLeagueBlocks([]);
        setLeagueMatches([]);
        setLeagueError(e?.message || '予選優勝者の取得に失敗しました（RLS/カラム/テーブル名をご確認ください）');
      }
    } catch (e: any) {
      console.error('[admin/finals] fatal:', e);
      setError(e?.message || 'データ取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    if (authz !== 'ok') return;
    void loadAll();
  }, [authz, loadAll]);

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
        const no = Number(m.match_no ?? m.match_index ?? 0) || i + 1;
        map.set(`${r}:${no}`, m);
      });
    });

    return map;
  }, [matches]);

  // ✅ final_matches の行（id）を必ず用意する：無ければ insert して作る（Hookはここ＝正しい場所）
  const ensureFinalMatchId = useCallback(
    async (bracketId: string, roundNo: number, matchNo: number, pidA: string | null, pidB: string | null) => {
      const key = `${roundNo}:${matchNo}`;
      const exist = matchByRoundMatch.get(key);
      if (exist?.id) return String(exist.id);

      const tryFetchBy = async (col: 'match_no' | 'match_index') => {
        const { data, error } = await fromAny('final_matches')
          .select('id')
          .eq('bracket_id', bracketId)
          .eq('round_no', roundNo)
          .eq(col, matchNo)
          .maybeSingle();

        if (!error && data?.id) return String(data.id);
        if (error && isMissingColumnError(error)) return null;
        if (error) throw error;
        return null;
      };

      try {
        const id1 = await tryFetchBy('match_no');
        if (id1) return id1;
      } catch {}
      try {
        const id2 = await tryFetchBy('match_index');
        if (id2) return id2;
      } catch {}

      const base = { bracket_id: bracketId, round_no: roundNo };
      const inserts: Record<string, any>[] = [
        { ...base, match_no: matchNo, player_a_id: pidA, player_b_id: pidB },
        { ...base, match_no: matchNo, player1_id: pidA, player2_id: pidB },
        { ...base, match_index: matchNo, player_a_id: pidA, player_b_id: pidB },
        { ...base, match_index: matchNo, player1_id: pidA, player2_id: pidB },
        { ...base, match_no: matchNo },
        { ...base, match_index: matchNo },
      ];

      let lastErr: any = null;
      for (const row of inserts) {
        const { data, error } = await fromAny('final_matches').insert(row as any).select('id').maybeSingle();
        if (!error && data?.id) return String(data.id);
        lastErr = error;
        if (error && isMissingColumnError(error)) continue;
        if (error) throw error;
      }

      throw new Error(String(lastErr?.message || 'final_matches row create failed'));
    },
    [matchByRoundMatch]
  );

  const baseMaxRound = useMemo(() => {
    let max = 1;
    const hasAnyAssigned = (r: number) => entries.some((e) => e.round_no === r && !!e.player_id);
    const hasAnyResult = (r: number) =>
      matches.some((m) => {
        if (Number(m.round_no ?? 0) !== r) return false;
        if (m.winner_id || m.loser_id) return true;
        if (m.winner_score != null || m.loser_score != null) return true;
        return false;
      });

    const candidates = new Set<number>();
    entries.forEach((e) => candidates.add(Number(e.round_no)));
    matches.forEach((m) => {
      const r = Number(m.round_no ?? 0);
      if (r > 0) candidates.add(r);
    });

    for (const r of Array.from(candidates).filter((x) => x > 0)) {
      if (hasAnyAssigned(r) || hasAnyResult(r)) max = Math.max(max, r);
    }
    return max;
  }, [entries, matches]);

  const visibleMaxRound = Math.max(baseMaxRound, manualMaxRound ?? 0, 1);
  const visibleRounds = useMemo(() => Array.from({ length: visibleMaxRound }, (_, i) => i + 1), [visibleMaxRound]);

  const getMatchCountForRound = (roundNo: number) => {
    const maxSlot = entries.filter((e) => e.round_no === roundNo).reduce((mx, e) => Math.max(mx, e.slot_no), 0);
    const fromEntries = Math.max(1, Math.floor(maxSlot / 2));
    const fromMatches = matches.filter((m) => Number(m.round_no ?? 0) === roundNo).length;
    return Math.max(fromEntries, fromMatches, 1);
  };

  const formatPlayerOption = (p: Player) => {
    const name = p.handle_name ?? '(名前未設定)';
    const dummy = p.is_dummy ? '【ダミー】' : '';
    const inactive = p.is_active === false ? '【無効】' : '';
    return `${dummy}${inactive}${name}  (RP:${p.ranking_points ?? 0} / HC:${p.handicap ?? 0})`;
  };

  const leagueWinners = useMemo(() => {
    if (!leagueBlocks.length) return [];
    return buildLeagueWinners(leagueBlocks, leagueMatches, players);
  }, [leagueBlocks, leagueMatches, players]);

  const shouldRenderMatch = useCallback(
    (roundNo: number, matchNo: number) => {
      const slotA = matchNo * 2 - 1;
      const slotB = matchNo * 2;

      const pidA = entryMap.get(`${roundNo}:${slotA}`)?.player_id ?? null;
      const pidB = entryMap.get(`${roundNo}:${slotB}`)?.player_id ?? null;

      const m = matchByRoundMatch.get(`${roundNo}:${matchNo}`) ?? null;

      if ((!pidA || !pidB) && !m) return false;
      return true;
    },
    [entryMap, matchByRoundMatch]
  );

  const roundsForInput = useMemo(() => {
    const rs: number[] = [];
    for (const r of visibleRounds) {
      const mc = getMatchCountForRound(r);
      let any = false;
      for (let i = 1; i <= mc; i++) {
        if (shouldRenderMatch(r, i)) {
          any = true;
          break;
        }
      }
      if (any) rs.push(r);
    }
    if (rs.length === 0) return [1];
    return rs;
  }, [visibleRounds, shouldRenderMatch, entries, matches]);

  const lastRound = useMemo(() => Math.max(...roundsForInput), [roundsForInput]);

  const getDefaultFormat = (roundNo: number): MatchFormat => (roundNo === lastRound ? 'bo3' : 'single');
  const getMatchFormat = (roundNo: number, matchNo: number): MatchFormat => {
    const key = `${roundNo}:${matchNo}`;
    return formatMap[key] ?? getDefaultFormat(roundNo);
  };

  const handleChangeEntry = async (entry: FinalRoundEntry, nextPlayerId: string) => {
    setError(null);
    setMessage(null);
    setSavingKey(`entry:${entry.id}`);

    try {
      const next = nextPlayerId ? nextPlayerId : null;
      const { error } = await fromAny('final_round_entries').update({ player_id: next } as any).eq('id', entry.id);
      if (error) throw new Error(error.message);

      if (bracket?.id) await clearFinalMatchesFromRound(bracket.id, entry.round_no);

      setMessage('枠を更新しました（このラウンド以降の試合結果をクリアしました）');
      await loadAll();
    } catch (e: any) {
      setError(`枠の更新に失敗しました: ${e?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
    }
  };

  const handleAddSlots = async (roundNo: number, addCount = 2) => {
    if (!bracket?.id) return;
    setError(null);
    setMessage(null);
    setSavingKey(`addslots:${roundNo}`);

    try {
      const currentMax = entries.filter((e) => e.round_no === roundNo).reduce((mx, e) => Math.max(mx, e.slot_no), 0);
      const rows = Array.from({ length: addCount }).map((_, i) => ({
        bracket_id: bracket.id,
        round_no: roundNo,
        slot_no: currentMax + i + 1,
        player_id: null,
      }));

      const { error: insErr } = await fromAny('final_round_entries').insert(rows as any);
      if (insErr) throw new Error(insErr.message);

      await clearFinalMatchesFromRound(bracket.id, roundNo);

      setMessage(`R${roundNo}に枠を追加しました（以降の試合結果をクリア）`);
      await loadAll();
    } catch (e: any) {
      setError(`枠追加に失敗しました: ${e?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
    }
  };

  const handleRemoveLastEmptyMatch = async (roundNo: number) => {
    if (!bracket?.id) return;

    setError(null);
    setMessage(null);
    setSavingKey(`removeslots:${roundNo}`);

    try {
      const list = entries.filter((e) => e.round_no === roundNo).sort((a, b) => a.slot_no - b.slot_no);
      if (list.length < 2) {
        setError('削除できる枠がありません');
        return;
      }

      const last2 = list.slice(-2);
      const anyUsed = last2.some((e) => !!e.player_id);
      if (anyUsed) {
        setError('最後の2枠に参加者が設定されています。先に未設定にしてください。');
        return;
      }

      await clearFinalMatchesFromRound(bracket.id, roundNo);

      const { error: delErr } = await fromAny('final_round_entries').delete().in(
        'id',
        last2.map((x) => x.id)
      );
      if (delErr) throw new Error(delErr.message);

      setMessage(`R${roundNo} の未使用枠（最後の1試合分）を削除しました`);
      await loadAll();
    } catch (e: any) {
      setError(`枠削除に失敗しました: ${e?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
    }
  };

  const handleAddRound = async () => {
    const next = visibleMaxRound + 1;
    setManualMaxRoundAndPersist(next);
    await handleAddSlots(next, 2);
  };

  const handleClearFromRound = async (fromRound: number) => {
    if (!bracket?.id) return;
    setError(null);
    setMessage(null);
    setSavingKey(`clear:${fromRound}`);

    try {
      await clearFinalMatchesFromRound(bracket.id, fromRound);
      setMessage(`R${fromRound}以降の試合結果をクリアしました`);
      await loadAll();
    } catch (e: any) {
      setError(`クリアに失敗しました: ${e?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
    }
  };

  const handleCreateBracket = async () => {
    if (!tournamentId) return;
    setError(null);
    setMessage(null);
    setSavingKey('create_bracket');

    try {
      const { data, error: insErr } = await fromAny('final_brackets')
        .insert({ tournament_id: tournamentId, title: '決勝トーナメント' } as any)
        .select('id,tournament_id,title,created_at')
        .single();

      if (insErr) throw new Error(insErr.message || 'insert failed');

      const b = data as FinalBracket;
      setBracket(b);

      if (createAutoR1) {
        const slots = Math.max(2, createSize || 8);
        const rows = Array.from({ length: slots }).map((_, i) => ({
          bracket_id: b.id,
          round_no: 1,
          slot_no: i + 1,
          player_id: null,
        }));
        const { error: eInsErr } = await fromAny('final_round_entries').insert(rows as any);
        if (eInsErr) throw new Error(`R1枠の作成に失敗しました: ${String(eInsErr.message || '')}`);
      }

      setMessage(createAutoR1 ? '決勝トーナメントを作成しました（R1枠も作成）' : '決勝トーナメントを作成しました');
      await loadAll();
    } catch (e: any) {
      setError(`新規作成に失敗しました: ${e?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
    }
  };

  const handleReportSingle = async (e: FormEvent<HTMLFormElement>, roundNo: number, matchNo: number) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!bracket?.id) return;

    const slotA = matchNo * 2 - 1;
    const slotB = matchNo * 2;
    const pidA = entryMap.get(`${roundNo}:${slotA}`)?.player_id ?? null;
    const pidB = entryMap.get(`${roundNo}:${slotB}`)?.player_id ?? null;
    if (!pidA || !pidB) {
      setError('参加者が未設定です（枠を先に設定してください）');
      return;
    }

    const form = e.currentTarget;
    const end_reason = String((form.elements.namedItem('end_reason') as HTMLSelectElement)?.value || 'normal').trim().toLowerCase();
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

    setSavingKey(`match:${roundNo}:${matchNo}`);
    try {
      const match_id = await ensureFinalMatchId(bracket.id, roundNo, matchNo, pidA, pidB);

      await postFinalReport({
        match_id,
        winner_id,
        loser_id,
        winner_score,
        loser_score,
        end_reason,
        finish_reason: end_reason,
        sets_json: null,
      });

      setMessage('保存しました');
      await loadAll();
    } catch (e2: any) {
      setError(`保存に失敗しました: ${e2?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
    }
  };

  const handleReportBestOf3 = async (e: FormEvent<HTMLFormElement>, roundNo: number, matchNo: number) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!bracket?.id) return;

    const slotA = matchNo * 2 - 1;
    const slotB = matchNo * 2;
    const pidA = entryMap.get(`${roundNo}:${slotA}`)?.player_id ?? null;
    const pidB = entryMap.get(`${roundNo}:${slotB}`)?.player_id ?? null;
    if (!pidA || !pidB) {
      setError('参加者が未設定です（枠を先に設定してください）');
      return;
    }

    const form = e.currentTarget;
    const end_reason = String((form.elements.namedItem('end_reason') as HTMLSelectElement)?.value || 'normal').trim().toLowerCase();

    const s1a = clampInt((form.elements.namedItem('set1_a') as HTMLInputElement)?.value, 0, 99, -1);
    const s1b = clampInt((form.elements.namedItem('set1_b') as HTMLInputElement)?.value, 0, 99, -1);
    const s2a = clampInt((form.elements.namedItem('set2_a') as HTMLInputElement)?.value, 0, 99, -1);
    const s2b = clampInt((form.elements.namedItem('set2_b') as HTMLInputElement)?.value, 0, 99, -1);
    const s3a = clampInt((form.elements.namedItem('set3_a') as HTMLInputElement)?.value, 0, 99, -1);
    const s3b = clampInt((form.elements.namedItem('set3_b') as HTMLInputElement)?.value, 0, 99, -1);

    const manualWinner = String((form.elements.namedItem('winner_id') as HTMLSelectElement)?.value || '').trim();

    let winner_id = manualWinner;
    if (!winner_id) {
      const inferred = inferWinnerFromSets([s1a, s2a, s3a], [s1b, s2b, s3b]);
      if (inferred === 'A') winner_id = pidA;
      if (inferred === 'B') winner_id = pidB;
    }

    if (!winner_id) {
      setError('勝者を確定できません（Set結果が不足）。勝者を選択してください。');
      return;
    }
    if (winner_id !== pidA && winner_id !== pidB) {
      setError('勝者が不正です');
      return;
    }

    const loser_id = winner_id === pidA ? pidB : pidA;

    let aWins = 0;
    let bWins = 0;
    const As = [s1a, s2a, s3a];
    const Bs = [s1b, s2b, s3b];
    for (let i = 0; i < 3; i++) {
      if (As[i] < 0 || Bs[i] < 0) continue;
      if (As[i] === Bs[i]) continue;
      if (As[i] > Bs[i]) aWins++;
      else bWins++;
    }
    const winner_score = winner_id === pidA ? aWins : bWins;
    const loser_score = winner_id === pidA ? bWins : aWins;

    setSavingKey(`match:${roundNo}:${matchNo}`);
    try {
      const match_id = await ensureFinalMatchId(bracket.id, roundNo, matchNo, pidA, pidB);

      const rawSets = [
        { a: s1a, b: s1b },
        { a: s2a, b: s2b },
        { a: s3a, b: s3b },
      ];
      const sets_json = normalizeSetsForPost(rawSets);

      await postFinalReport({
        match_id,
        winner_id,
        loser_id,
        winner_score,
        loser_score,
        end_reason,
        finish_reason: end_reason,
        sets_json,
      });

      setMessage('保存しました');
      await loadAll();
    } catch (e2: any) {
      setError(`保存に失敗しました: ${e2?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
    }
  };

  // ====== ここから描画 ======

  if (!tournamentId) {
    return <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">大会IDが指定されていません</div>;
  }

  if (authz === 'checking') {
    return <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">認証を確認しています...</div>;
  }

  if (authz === 'no') {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white p-6 text-center">
        アクセス権限がありません
        <br />
        {authErr ? <span className="text-xs text-gray-300 mt-2 block">{authErr}</span> : null}
      </div>
    );
  }

  const tourName = tournament?.name ?? '（大会名未設定）';

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8">
        {/* header */}
        <div className="flex items-start justify-between mb-6 gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full">
              <FaShieldAlt className="text-2xl" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">決勝トーナメント管理</h1>
              <div className="text-sm text-gray-300 mt-1">
                <span className="text-yellow-100 font-semibold">{tourName}</span>
                <span className="ml-2 text-xs text-gray-400">（大会ID: {tournamentId}）</span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                <Link href={`/admin/tournaments/${tournamentId}`} className="text-purple-300 underline">
                  ← 大会トップへ
                </Link>
                <Link href="/admin/tournaments" className="text-purple-300 underline">
                  ← 大会一覧へ
                </Link>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs justify-end">
            <Link href={`/admin/tournaments/${tournamentId}/league`} className="text-blue-300 underline">
              ← 予選（リーグ）へ
            </Link>
            <Link href={`/tournaments/${tournamentId}/finals`} className="text-blue-300 underline">
              表画面で確認 →
            </Link>
            <button
              type="button"
              onClick={() => loadAll()}
              disabled={loading}
              className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 transition-colors text-xs inline-flex items-center gap-2"
            >
              <FaSyncAlt /> 再読み込み
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            <FaExclamationTriangle className="inline mr-2" />
            {error}
          </div>
        )}
        {message && (
          <div className="mb-4 rounded-md border border-green-500/50 bg-green-500/10 px-4 py-2 text-sm text-green-200">
            {message}
          </div>
        )}

        {/* ✅ 予選：各ブロック優勝者だけ（参考） */}
        <div className="mb-6 bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-4 md:p-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-yellow-200">
              <FaListOl className="text-amber-300" />
              予選 各ブロック優勝者（参考）
            </h2>
            <Link href={`/admin/tournaments/${tournamentId}/league/results`} className="text-blue-300 underline text-xs">
              予選結果ページへ →
            </Link>
          </div>

          <div className="text-xs text-gray-300 mb-3">
            ※ ここは「各ブロックの1位だけ」表示します（決勝の組み合わせ作成の参考用）。詳細は予選結果ページで確認してください。
          </div>

          {leagueError ? (
            <div className="text-xs text-red-200 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{leagueError}</div>
          ) : leagueBlocks.length === 0 ? (
            <div className="text-sm text-gray-400">予選ブロックが見つかりません。</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {leagueWinners.map(({ block, winner }) => {
                const rawName = block.title ?? block.name ?? block.label ?? block.block_name ?? null;
                const name = rawName ? String(rawName).trim() : '';
                const prefix = block.block_no ? `ブロック ${block.block_no}` : 'ブロック';
                const title = name ? `${prefix}：${name}` : `${prefix}（名称未設定）`;

                return (
                  <div key={block.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-bold">{title}</div>
                      <div className="text-[11px] text-gray-400 truncate">id: {block.id}</div>
                    </div>

                    {!winner ? (
                      <div className="text-sm text-gray-400">結果データがまだありません。</div>
                    ) : (
                      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                        <div className="text-xs text-gray-300 mb-1">優勝者</div>
                        <div className="text-base font-semibold text-orange-300">
                          {winner.is_dummy && <span className="text-amber-200 mr-2">【ダミー】</span>}
                          {winner.is_inactive && <span className="text-red-200 mr-2">【無効】</span>}
                          {winner.name}
                        </div>
                        <div className="mt-2 text-[12px] text-gray-300 flex flex-wrap gap-x-4 gap-y-1">
                          <span>W: {winner.wins}</span>
                          <span>L: {winner.losses}</span>
                          <span>PD: {winner.pd}</span>
                          <span>得: {winner.scored}</span>
                          <span>失: {winner.allowed}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-gray-300">読み込み中...</div>
        ) : !bracket ? (
          <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-4 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-yellow-200">
                <FaTrophy className="text-yellow-300" />
                決勝トーナメントは未作成です
              </h2>
              <div className="text-xs text-gray-300">まず作成してから、必要なラウンド・枠を増やしていきます。</div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="grid gap-3 md:grid-cols-3 items-center">
                <div className="md:col-span-2">
                  <div className="text-xs text-gray-300 mb-1">決勝の参加人数（枠数）</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={createSize}
                      onChange={(e) => setCreateSize(parseInt(e.target.value, 10))}
                      className="px-3 py-2 rounded-lg bg-gray-900/60 border border-purple-500/30 text-white text-sm"
                    >
                      {[2, 4, 8, 16, 32].map((n) => (
                        <option key={n} value={n}>
                          {n} 人
                        </option>
                      ))}
                    </select>

                    <label className="inline-flex items-center gap-2 text-xs text-gray-300">
                      <input type="checkbox" checked={createAutoR1} onChange={(e) => setCreateAutoR1(e.target.checked)} />
                      作成後に R1 枠も自動作成
                    </label>
                  </div>
                </div>

                <div className="md:col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={handleCreateBracket}
                    disabled={savingKey === 'create_bracket'}
                    className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 transition-colors text-sm inline-flex items-center gap-2"
                  >
                    <FaPlus />
                    {savingKey === 'create_bracket' ? '作成中…' : '決勝トーナメントを新規作成'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* entries */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-4 md:p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2 text-yellow-200">
                  <FaTrophy className="text-yellow-300" />
                  参加者枠（ラウンドごと）
                </h2>

                <div className="flex items-center gap-3 text-xs">
                  <button onClick={() => handleAddRound()} disabled={savingKey?.startsWith('addslots:') || !bracket?.id} className="text-blue-300 underline disabled:opacity-50">
                    ＋ラウンド追加
                  </button>

                  <button onClick={() => setManualMaxRoundAndPersist(0)} className="text-gray-300 underline" type="button">
                    表示ラウンドをリセット
                  </button>
                </div>
              </div>

              <div className="text-xs text-gray-300 mb-3">
                ※ ダミーは <span className="text-amber-200 font-semibold">【ダミー】</span>、無効は{' '}
                <span className="text-red-200 font-semibold">【無効】</span> として表示されます。
              </div>

              <div className="space-y-6">
                {visibleRounds.map((r) => {
                  const list = entries.filter((e) => e.round_no === r).sort((a, b) => a.slot_no - b.slot_no);

                  if (r > 1 && list.length === 0) return null;

                  return (
                    <div key={`round-entries-${r}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-bold">R{r}</div>

                        <div className="flex items-center gap-3 text-xs">
                          <button
                            type="button"
                            onClick={() => handleAddSlots(r, 2)}
                            disabled={!bracket?.id || savingKey === `addslots:${r}`}
                            className="text-xs text-blue-300 underline disabled:opacity-50"
                          >
                            {savingKey === `addslots:${r}` ? '追加中…' : '＋枠追加'}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRemoveLastEmptyMatch(r)}
                            disabled={!bracket?.id || savingKey === `removeslots:${r}`}
                            className="text-xs text-gray-300 underline disabled:opacity-50"
                          >
                            {savingKey === `removeslots:${r}` ? '削除中…' : '−未使用枠を削除'}
                          </button>
                        </div>
                      </div>

                      {list.length === 0 ? (
                        <div className="text-gray-400 text-sm">枠がありません（＋枠追加 で作成できます）</div>
                      ) : (
                        <div className="grid gap-3 md:grid-cols-2">
                          {list.map((e) => {
                            const current = e.player_id ? players[e.player_id] : null;
                            const isDummy = current?.is_dummy === true;
                            const isInactive = current?.is_active === false;

                            return (
                              <div key={e.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                                <div className="text-xs text-gray-300 mb-2">
                                  R{e.round_no} / 枠{e.slot_no}
                                </div>

                                <div className="text-sm font-semibold mb-2">
                                  {isDummy && <span className="text-amber-200 mr-2">【ダミー】</span>}
                                  {isInactive && <span className="text-red-200 mr-2">【無効】</span>}
                                  {current?.handle_name ?? '未設定'}
                                </div>

                                <select
                                  value={e.player_id ?? ''}
                                  onChange={(ev) => handleChangeEntry(e, ev.target.value)}
                                  disabled={savingKey === `entry:${e.id}`}
                                  className="w-full px-2 py-2 rounded border border-purple-500/40 bg-gray-900/80 text-xs md:text-sm disabled:opacity-60"
                                >
                                  <option value="">（未設定）</option>
                                  {Object.values(players).map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {formatPlayerOption(p)}
                                    </option>
                                  ))}
                                </select>

                                <div className="mt-2 text-[11px] text-gray-400">※ 枠を変更すると R{e.round_no} 以降の試合結果は自動クリアされます</div>
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
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-yellow-200">
                <FaTrophy className="text-yellow-300" />
                試合結果入力
              </h2>

              <div className="text-xs text-gray-300 mb-3 space-y-1">
                <div>※ 各試合ごとに「1試合 / 3セット」を選択できます（R1が決勝のケースにも対応）。</div>
                <div>※ 片側でも未設定で、かつ試合レコードも無い行は「存在しない試合」として表示しません。</div>
              </div>

              {roundsForInput.map((r) => {
                const matchCount = getMatchCountForRound(r);

                return (
                  <div key={`round-input-${r}`} className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-bold">R{r}</div>
                      <button
                        type="button"
                        onClick={() => handleClearFromRound(r)}
                        disabled={!bracket?.id || savingKey === `clear:${r}`}
                        className="text-xs text-blue-300 underline disabled:opacity-50"
                      >
                        {savingKey === `clear:${r}` ? 'クリア中…' : 'このラウンド以降をクリア'}
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm border-collapse">
                        <thead>
                          <tr className="bg-gray-800 text-gray-100 text-xs">
                            <th className="border px-2 py-1 text-left">試合</th>
                            <th className="border px-2 py-1 text-left">現状</th>
                            <th className="border px-2 py-1 text-left">結果入力</th>
                          </tr>
                        </thead>

                        <tbody>
                          {Array.from({ length: matchCount }).map((_, idx) => {
                            const matchNo = idx + 1;

                            if (!shouldRenderMatch(r, matchNo)) return null;

                            const slotA = matchNo * 2 - 1;
                            const slotB = matchNo * 2;

                            const pidA = entryMap.get(`${r}:${slotA}`)?.player_id ?? null;
                            const pidB = entryMap.get(`${r}:${slotB}`)?.player_id ?? null;

                            const pA = pidA ? players[pidA] : null;
                            const pB = pidB ? players[pidB] : null;

                            const m = matchByRoundMatch.get(`${r}:${matchNo}`) ?? null;
                            const hasResult = !!m?.winner_id && !!m?.loser_id;
                            const reason = m ? normalizeReason(m) : 'normal';

                            const aName = pA?.handle_name ?? '未設定';
                            const bName = pB?.handle_name ?? '未設定';

                            const currentResult = hasResult
                              ? `${players[m!.winner_id!]?.handle_name ?? '勝者'} ${m!.winner_score ?? '-'} - ${m!.loser_score ?? '-'} ${players[m!.loser_id!]?.handle_name ?? '敗者'}`
                              : '未入力';

                            const saveKey = `match:${r}:${matchNo}`;
                            const fmt = getMatchFormat(r, matchNo);

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
                                    {r === lastRound ? '（決勝）' : ''}
                                  </div>
                                </td>

                                <td className="border px-2 py-2 align-top">
                                  <span className={hasResult ? 'text-green-300' : 'text-gray-300'}>{currentResult}</span>
                                  {reason !== 'normal' && (
                                    <div className="mt-1 text-[11px] text-amber-200">
                                      種別: {reason === 'time_limit' ? '時間切れ' : reason === 'forfeit' ? '棄権/不戦' : reason}
                                    </div>
                                  )}
                                </td>

                                <td className="border px-2 py-2 align-top">
                                  <div className="mb-2 flex items-center gap-2 text-xs">
                                    <span className="text-gray-300">形式</span>
                                    <select
                                      value={fmt}
                                      onChange={(ev) => setMatchFormat(r, matchNo, ev.target.value as MatchFormat)}
                                      className="px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs"
                                    >
                                      <option value="single">1試合</option>
                                      <option value="bo3">3セット</option>
                                    </select>
                                  </div>

                                  {fmt === 'bo3' ? (
                                    <form onSubmit={(e) => handleReportBestOf3(e, r, matchNo)} className="space-y-2">
                                      <div className="flex flex-wrap gap-2 items-center">
                                        <div className="text-xs text-gray-300">種別</div>
                                        <select name="end_reason" defaultValue={reason} className="px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs">
                                          <option value="normal">通常</option>
                                          <option value="time_limit">時間切れ</option>
                                          <option value="forfeit">棄権/不戦</option>
                                        </select>

                                        <div className="text-xs text-gray-300 ml-2">勝者</div>
                                        <select name="winner_id" defaultValue={m?.winner_id ?? ''} className="min-w-[160px] px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs">
                                          <option value="">（自動判定）</option>
                                          {pidA && <option value={pidA}>{aName}</option>}
                                          {pidB && <option value={pidB}>{bName}</option>}
                                        </select>
                                      </div>

                                      <div className="grid gap-2 md:grid-cols-3">
                                        {[
                                          { label: 'Set1', a: 'set1_a', b: 'set1_b' },
                                          { label: 'Set2', a: 'set2_a', b: 'set2_b' },
                                          { label: 'Set3', a: 'set3_a', b: 'set3_b' },
                                        ].map((s) => (
                                          <div key={s.label} className="rounded-xl border border-white/10 bg-black/30 p-2">
                                            <div className="text-[11px] text-gray-300 mb-1">{s.label}</div>
                                            <div className="flex items-center gap-2">
                                              <input name={s.a} type="number" min={0} max={99} defaultValue={0} className="w-14 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center text-xs" />
                                              <span className="text-gray-400 text-xs">-</span>
                                              <input name={s.b} type="number" min={0} max={99} defaultValue={0} className="w-14 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center text-xs" />
                                            </div>
                                          </div>
                                        ))}
                                      </div>

                                      <button type="submit" disabled={savingKey === saveKey} className="w-full px-3 py-2 rounded bg-purple-600 text-white text-xs md:text-sm disabled:opacity-50">
                                        {savingKey === saveKey ? '保存中...' : '保存'}
                                      </button>
                                    </form>
                                  ) : (
                                    <form onSubmit={(e) => handleReportSingle(e, r, matchNo)} className="flex flex-col md:flex-row md:items-center gap-2">
                                      <select name="end_reason" defaultValue={reason} className="px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs md:text-sm">
                                        <option value="normal">通常</option>
                                        <option value="time_limit">時間切れ</option>
                                        <option value="forfeit">棄権/不戦</option>
                                      </select>

                                      <select name="winner_id" defaultValue={m?.winner_id ?? ''} className="min-w-[160px] px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs md:text-sm">
                                        <option value="">勝者を選択</option>
                                        {pidA && <option value={pidA}>{aName}</option>}
                                        {pidB && <option value={pidB}>{bName}</option>}
                                      </select>

                                      <input name="winner_score" type="number" min={0} max={99} defaultValue={m?.winner_score ?? 15} className="w-16 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center" />
                                      <input name="loser_score" type="number" min={0} max={99} defaultValue={m?.loser_score ?? 0} className="w-16 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center" />

                                      <button type="submit" disabled={savingKey === saveKey} className="px-3 py-1 rounded bg-purple-600 text-white text-xs md:text-sm disabled:opacity-50">
                                        {savingKey === saveKey ? '保存中...' : hasResult ? '更新' : '登録'}
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
