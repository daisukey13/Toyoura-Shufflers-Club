// app/tournaments/[tournamentId]/finals/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { FaTrophy } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

/* ========= Types ========= */
type TournamentRow = {
  id: string;
  name?: string | null;
  description?: string | null;
  notes?: string | null;
  tournament_date?: string | null;
  mode?: string | null;
};

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
  winner_score?: number | null;
  loser_score?: number | null;

  finish_reason?: string | null;
  end_reason?: string | null;

  sets_json?: any; // jsonb想定
  sets?: any; // 互換

  [key: string]: any;
};

type Player = {
  id: string;
  handle_name: string | null;
  avatar_url: string | null;
  ranking_points: number | null;
  handicap: number | null;
  is_dummy?: boolean | null;
};

/* ========= Helpers ========= */
const normalizeReason = (m: FinalMatchRow | null) =>
  String(m?.finish_reason ?? m?.end_reason ?? 'normal').trim().toLowerCase();

const toInt = (v: any, fb = 0) => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fb;
};

const extractSetsArray = (m: FinalMatchRow | null): any[] => {
  if (!m) return [];
  const raw = (m as any).sets_json ?? (m as any).sets;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const hasAnyResult = (m: FinalMatchRow | null) => {
  if (!m) return false;
  if (m.winner_id || m.loser_id) return true;
  if (m.winner_score != null || m.loser_score != null) return true;

  const setsArr = extractSetsArray(m);
  if (setsArr.length > 0) return true;

  const keys = Object.keys(m);
  for (const k of keys) {
    const lk = String(k).toLowerCase();
    if (
      lk.includes('set') &&
      (lk.includes('score') || lk.includes('winner') || lk.includes('loser') || lk.includes('_a') || lk.includes('_b'))
    ) {
      if ((m as any)[k] != null && String((m as any)[k]) !== '') return true;
    }
  }
  return false;
};

function ReasonBadge({ reason }: { reason: string }) {
  if (!reason || reason === 'normal') return null;

  if (reason === 'time_limit') {
    return (
      <span className="ml-2 inline-flex items-center rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-200">
        時間切れ
      </span>
    );
  }
  if (reason === 'forfeit') {
    return (
      <span className="ml-2 inline-flex items-center rounded-full border border-rose-400/40 bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-200">
        棄権/不戦
      </span>
    );
  }
  return (
    <span className="ml-2 inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] text-gray-200">
      {reason}
    </span>
  );
}

/**
 * sets_json を "15-12 / 12-15 / 15-9" 形式へ（pidA=slotA, pidB=slotB 基準）
 */
const formatSetsTextForPlayer = (m: FinalMatchRow | null, pidSelf: string | null, pidA: string | null, pidB: string | null) => {
  if (!m || !pidSelf || !pidA || !pidB) return null;

  const arr = extractSetsArray(m);
  if (!arr.length) return null;

  const selfIsA = String(pidSelf) === String(pidA);
  const out: string[] = [];

  for (const s of arr.slice(0, 3)) {
    const a = toInt(s?.a ?? s?.score_a ?? s?.p1 ?? s?.player1, -1);
    const b = toInt(s?.b ?? s?.score_b ?? s?.p2 ?? s?.player2, -1);
    if (a < 0 || b < 0) continue;
    out.push(selfIsA ? `${a}-${b}` : `${b}-${a}`);
  }

  return out.length ? out.join(' / ') : null;
};

function PlayerLine({
  p,
  isWinner,
  scoreText,
  reason,
  setsTextSecondary,
  scoreIsSets,
}: {
  p?: Player;
  isWinner: boolean;
  scoreText: string;
  reason?: string;
  setsTextSecondary?: string | null;
  scoreIsSets?: boolean;
}) {
  const base = 'flex items-center justify-between gap-3 rounded-2xl border overflow-hidden';
  const loserStyle = 'bg-black/35 border-white/10 px-3 py-3 min-h-[56px]';
  const winnerStyle =
    'bg-rose-950/80 border-rose-400/50 px-4 py-5 min-h-[90px] shadow-[0_0_0_1px_rgba(244,63,94,0.18),0_20px_70px_-40px_rgba(244,63,94,0.5)]';

  const avatarSize = isWinner ? 'w-12 h-12 md:w-14 md:h-14' : 'w-9 h-9 md:w-10 md:h-10';
  const nameSize = isWinner ? 'text-xl md:text-2xl' : 'text-sm md:text-base';
  const subSize = isWinner ? 'text-sm md:text-base text-rose-100/90' : 'text-[11px] text-gray-300';

  const scoreSize = scoreIsSets ? 'text-base md:text-lg' : isWinner ? 'text-4xl md:text-5xl' : 'text-xl md:text-2xl';
  const sizes = isWinner ? '56px' : '40px';

  return (
    <div className={[base, isWinner ? winnerStyle : loserStyle].join(' ')}>
      <div className="flex items-center gap-3 min-w-0">
        {p?.avatar_url ? (
          <div className={`${avatarSize} relative rounded-full overflow-hidden border border-white/20 shrink-0`}>
            <Image src={p.avatar_url} alt={p.handle_name ?? 'player'} fill sizes={sizes} className="object-cover" unoptimized />
          </div>
        ) : (
          <div className={`${avatarSize} rounded-full bg-white/10 border border-white/20 shrink-0`} />
        )}

        <div className="min-w-0">
          <div className={`${nameSize} font-bold truncate`}>{p?.handle_name ?? '未設定'}</div>
          <div className={`${subSize} truncate`}>
            RP:{p?.ranking_points ?? 0} / HC:{p?.handicap ?? 0}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 pr-1">
        <div className="flex flex-col items-end">
          <div className={`${scoreSize} font-extrabold tabular-nums leading-none whitespace-nowrap`}>{scoreText}</div>

          {/* sets がメインで出ていないときだけ補助表示 */}
          {!scoreIsSets && isWinner && setsTextSecondary ? (
            <div className="mt-1 text-[11px] md:text-xs text-rose-100/80 tabular-nums whitespace-nowrap">{setsTextSecondary}</div>
          ) : null}
        </div>
        {reason ? <ReasonBadge reason={reason} /> : null}
      </div>
    </div>
  );
}

/** final_matches は列差分が出やすいので * で1回だけ */
async function fetchFinalMatchesOnce(bracketId: string): Promise<FinalMatchRow[]> {
  const base = supabase.from('final_matches').select('*').eq('bracket_id', bracketId);

  const { data, error } = await base.order('round_no', { ascending: true });
  if (!error) return (data ?? []) as FinalMatchRow[];

  const { data: data2, error: error2 } = await supabase.from('final_matches').select('*').eq('bracket_id', bracketId);
  if (error2) throw new Error(String(error2.message || 'final_matches fetch failed'));
  return (data2 ?? []) as FinalMatchRow[];
}

export default function TournamentFinalsPage() {
  const params = useParams();
  const tournamentId = typeof (params as any)?.tournamentId === 'string' ? String((params as any).tournamentId) : '';

  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [bracket, setBracket] = useState<FinalBracket | null>(null);
  const [entries, setEntries] = useState<FinalRoundEntry[]>([]);
  const [matches, setMatches] = useState<FinalMatchRow[]>([]);
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [activeRound, setActiveRound] = useState<number>(1);

  const loadAll = useCallback(async () => {
    if (!tournamentId) return;

    setLoading(true);
    setError(null);

    try {
      const { data: tRow, error: tErr } = await supabase.from('tournaments').select('*').eq('id', tournamentId).maybeSingle();
      if (!tErr && tRow) setTournament(tRow as TournamentRow);
      else setTournament(null);

      const { data: bRows, error: bErr } = await supabase
        .from('final_brackets')
        .select('*')
        .eq('tournament_id', tournamentId)
        .order('created_at', { ascending: false });

      if (bErr || !bRows || bRows.length === 0) {
        setError('決勝トーナメントが見つかりませんでした');
        setBracket(null);
        setEntries([]);
        setMatches([]);
        setPlayers({});
        setLoading(false);
        return;
      }

      const b = bRows[0] as FinalBracket;
      setBracket(b);

      const { data: eRows, error: eErr } = await supabase
        .from('final_round_entries')
        .select('id,bracket_id,round_no,slot_no,player_id')
        .eq('bracket_id', b.id)
        .order('round_no', { ascending: true })
        .order('slot_no', { ascending: true });

      if (eErr) {
        setError('決勝トーナメント枠の取得に失敗しました');
        setEntries([]);
        setMatches([]);
        setPlayers({});
        setLoading(false);
        return;
      }

      const es = (eRows ?? []) as FinalRoundEntry[];
      setEntries(es);

      let ms: FinalMatchRow[] = [];
      try {
        ms = await fetchFinalMatchesOnce(b.id);
      } catch (e) {
        console.error('[finals] final_matches fetch error:', e);
        setError('決勝トーナメント試合結果の取得に失敗しました');
        setMatches([]);
        setPlayers({});
        setLoading(false);
        return;
      }
      setMatches(ms);

      const ids = Array.from(
        new Set(
          [
            ...es.map((r) => r.player_id).filter((x): x is string => !!x),
            ...ms.flatMap((m) => [m.winner_id ?? null, m.loser_id ?? null]).filter((x): x is string => !!x),
            ...ms
              .flatMap((m) => [(m as any).player_a_id, (m as any).player_b_id, (m as any).player1_id, (m as any).player2_id].filter(Boolean))
              .map(String),
          ].filter(Boolean)
        )
      );

      if (ids.length > 0) {
        const { data: pRows, error: pErr } = await supabase
          .from('players')
          .select('id,handle_name,avatar_url,ranking_points,handicap,is_dummy')
          .in('id', ids);

        if (pErr) {
          console.warn('[finals] players fetch error:', pErr);
          setPlayers({});
        } else {
          const dict: Record<string, Player> = {};
          (pRows ?? []).forEach((p: any) => {
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
        }
      } else {
        setPlayers({});
      }

      setLoading(false);
    } catch (e) {
      console.error('[finals] fatal:', e);
      setError('データ取得中にエラーが発生しました');
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

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

    for (const [r, list] of groups.entries()) {
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
    }

    return map;
  }, [matches]);

  const isDummyPlayerId = (pid: string | null) => {
    if (!pid) return false;
    const p = players[pid];
    const name = (p?.handle_name ?? '').trim().toLowerCase();
    return Boolean(p?.is_dummy) || name === 'def';
  };
  const isRealPlayerId = (pid: string | null) => {
    if (!pid) return false;
    const p = players[pid];
    if (!p) return true; // 未ロードは real 扱い
    return !isDummyPlayerId(pid);
  };

  const inferWinnerFromSets = (m: FinalMatchRow | null, pidA: string | null, pidB: string | null) => {
    if (!pidA || !pidB) return null;
    const sets = extractSetsArray(m);
    if (!sets.length) return null;

    let aWins = 0;
    let bWins = 0;

    for (const s of sets.slice(0, 3)) {
      const a = s?.a ?? s?.p1 ?? s?.player1 ?? s?.score_a ?? s?.score1;
      const b = s?.b ?? s?.p2 ?? s?.player2 ?? s?.score_b ?? s?.score2;
      if (a == null || b == null) continue;

      const ai = toInt(a, -1);
      const bi = toInt(b, -1);
      if (ai < 0 || bi < 0) continue;
      if (ai === bi) continue;
      if (ai > bi) aWins++;
      else bWins++;
    }

    if (aWins >= 2) return pidA;
    if (bWins >= 2) return pidB;
    return null;
  };

  const inferWinnerId = (m: FinalMatchRow | null, pidA: string | null, pidB: string | null) => {
    if (!m) return null;
    if (m.winner_id) return String(m.winner_id);

    const bySets = inferWinnerFromSets(m, pidA, pidB);
    if (bySets) return bySets;

    const aId = (m as any).player_a_id ?? (m as any).player1_id ?? (m as any).a_player_id ?? (m as any).p1_id;
    const bId = (m as any).player_b_id ?? (m as any).player2_id ?? (m as any).b_player_id ?? (m as any).p2_id;

    const aScore = (m as any).score_a ?? (m as any).score1 ?? (m as any).player1_score;
    const bScore = (m as any).score_b ?? (m as any).score2 ?? (m as any).player2_score;

    if (aId && bId && aScore != null && bScore != null) {
      const sA = toInt(aScore, 0);
      const sB = toInt(bScore, 0);
      if (sA === sB) return null;
      return sA > sB ? String(aId) : String(bId);
    }

    return null;
  };

  const scoreTextFor = (m: FinalMatchRow | null, pidSelf: string | null, pidA: string | null, pidB: string | null) => {
    if (!m || !pidSelf) return { text: '-', isSets: false };

    const setsText = formatSetsTextForPlayer(m, pidSelf, pidA, pidB);
    if (setsText) return { text: setsText, isSets: true };

    if (m.winner_id && String(m.winner_id) === pidSelf) return { text: String(m.winner_score ?? '-'), isSets: false };
    if (m.loser_id && String(m.loser_id) === pidSelf) return { text: String(m.loser_score ?? '-'), isSets: false };

    const aId = (m as any).player_a_id ?? (m as any).player1_id ?? (m as any).a_player_id ?? (m as any).p1_id;
    const bId = (m as any).player_b_id ?? (m as any).player2_id ?? (m as any).b_player_id ?? (m as any).p2_id;
    if (aId && String(aId) === pidSelf) return { text: String((m as any).score_a ?? (m as any).score1 ?? (m as any).player1_score ?? '-'), isSets: false };
    if (bId && String(bId) === pidSelf) return { text: String((m as any).score_b ?? (m as any).score2 ?? (m as any).player2_score ?? '-'), isSets: false };

    return { text: '-', isSets: false };
  };

  const getMatchCountForRound = useMemo(() => {
    return (roundNo: number) => {
      const maxSlot = entries.filter((e) => e.round_no === roundNo).reduce((mx, e) => Math.max(mx, Number(e.slot_no ?? 0)), 0);
      const fromEntries = Math.max(1, Math.floor(maxSlot / 2));
      const fromMatches = Array.from(matchByRoundMatch.keys()).filter((k) => k.startsWith(`${roundNo}:`)).length;
      return Math.max(fromEntries, fromMatches, 1);
    };
  }, [entries, matchByRoundMatch]);

  const shouldRenderMatch = useMemo(() => {
    return (roundNo: number, matchNo: number) => {
      const slotA = matchNo * 2 - 1;
      const slotB = matchNo * 2;

      const pidA = entryMap.get(`${roundNo}:${slotA}`)?.player_id ?? null;
      const pidB = entryMap.get(`${roundNo}:${slotB}`)?.player_id ?? null;

      const m = matchByRoundMatch.get(`${roundNo}:${matchNo}`) ?? null;

      if (m && hasAnyResult(m)) return true;
      if (!pidA && !pidB) return false;
      if (!pidA || !pidB) return false;

      return true;
    };
  }, [entryMap, matchByRoundMatch]);

  const rounds = useMemo(() => {
    const candidate = new Set<number>();
    entries.forEach((e) => candidate.add(Number(e.round_no)));
    matches.forEach((m) => {
      const r = Number(m.round_no ?? 0);
      if (r > 0) candidate.add(r);
    });

    const roundHasAnyVisibleMatch = (r: number) => {
      const mc = getMatchCountForRound(r);
      for (let matchNo = 1; matchNo <= mc; matchNo++) {
        if (!shouldRenderMatch(r, matchNo)) continue;

        const slotA = matchNo * 2 - 1;
        const slotB = matchNo * 2;

        const pidA = entryMap.get(`${r}:${slotA}`)?.player_id ?? null;
        const pidB = entryMap.get(`${r}:${slotB}`)?.player_id ?? null;

        const m = matchByRoundMatch.get(`${r}:${matchNo}`) ?? null;

        if (isRealPlayerId(pidA) || isRealPlayerId(pidB)) return true;

        if (hasAnyResult(m)) {
          const ids = [
            m?.winner_id ?? null,
            m?.loser_id ?? null,
            (m as any).player_a_id ?? null,
            (m as any).player_b_id ?? null,
            (m as any).player1_id ?? null,
            (m as any).player2_id ?? null,
          ];
          if (ids.some((id) => isRealPlayerId(id))) return true;
        }
      }
      return false;
    };

    const filtered = Array.from(candidate)
      .filter((r) => r > 0)
      .filter((r) => roundHasAnyVisibleMatch(r))
      .sort((a, b) => a - b);

    return filtered.length ? filtered : [1];
  }, [entries, matches, players, entryMap, matchByRoundMatch, shouldRenderMatch, getMatchCountForRound]);

  useEffect(() => {
    if (rounds.length > 0) setActiveRound((prev) => (rounds.includes(prev) ? prev : rounds[0]));
  }, [rounds]);

  const matchNosForRound = useMemo(() => {
    const map = new Map<number, number[]>();

    for (const r of rounds) {
      const mc = getMatchCountForRound(r);
      const set = new Set<number>();

      for (let matchNo = 1; matchNo <= mc; matchNo++) {
        if (!shouldRenderMatch(r, matchNo)) continue;

        const slotA = matchNo * 2 - 1;
        const slotB = matchNo * 2;

        const pidA = entryMap.get(`${r}:${slotA}`)?.player_id ?? null;
        const pidB = entryMap.get(`${r}:${slotB}`)?.player_id ?? null;

        const m = matchByRoundMatch.get(`${r}:${matchNo}`) ?? null;

        if (isRealPlayerId(pidA) || isRealPlayerId(pidB)) {
          set.add(matchNo);
          continue;
        }

        if (hasAnyResult(m)) {
          const ids = [
            m?.winner_id ?? null,
            m?.loser_id ?? null,
            (m as any).player_a_id ?? null,
            (m as any).player_b_id ?? null,
            (m as any).player1_id ?? null,
            (m as any).player2_id ?? null,
          ];
          if (ids.some((id) => isRealPlayerId(id))) set.add(matchNo);
        }
      }

      const list = Array.from(set).sort((a, b) => a - b);
      map.set(r, list.length ? list : [1]);
    }

    return map;
  }, [rounds, players, entryMap, matchByRoundMatch, shouldRenderMatch, getMatchCountForRound]);

  if (!tournamentId) return <div className="p-4">大会IDが指定されていません。</div>;
  if (loading) return <div className="p-4 text-white">読み込み中...</div>;
  if (error) return <div className="p-4 text-red-300">{error}</div>;
  if (!bracket) return <div className="p-4">決勝トーナメントが見つかりません。</div>;

  const finalRoundForWinner = (() => {
    let best = rounds[0] ?? 1;
    for (const r of rounds) {
      const matchNos = matchNosForRound.get(r) ?? [1];
      const hasWinner = matchNos.some((matchNo) => {
        const slotA = matchNo * 2 - 1;
        const slotB = matchNo * 2;
        const pidA = entryMap.get(`${r}:${slotA}`)?.player_id ?? null;
        const pidB = entryMap.get(`${r}:${slotB}`)?.player_id ?? null;
        const m = matchByRoundMatch.get(`${r}:${matchNo}`) ?? null;
        const w = (m?.winner_id ? String(m.winner_id) : inferWinnerId(m, pidA, pidB)) ?? null;
        return !!w && isRealPlayerId(w);
      });
      if (hasWinner) best = r;
    }
    return best;
  })();

  const winnerIdFinal = (() => {
    const matchNos = matchNosForRound.get(finalRoundForWinner) ?? [1];
    for (const matchNo of matchNos) {
      const slotA = matchNo * 2 - 1;
      const slotB = matchNo * 2;

      const pidA = entryMap.get(`${finalRoundForWinner}:${slotA}`)?.player_id ?? null;
      const pidB = entryMap.get(`${finalRoundForWinner}:${slotB}`)?.player_id ?? null;

      const m = matchByRoundMatch.get(`${finalRoundForWinner}:${matchNo}`) ?? null;
      const w = (m?.winner_id ? String(m.winner_id) : inferWinnerId(m, pidA, pidB)) ?? null;
      if (w && isRealPlayerId(w)) return w;
    }
    return null;
  })();

  const winnerPlayerFinal = winnerIdFinal ? players[winnerIdFinal] : null;
  const showChampion = !!winnerPlayerFinal && isRealPlayerId(winnerIdFinal);

  const tournamentTitle = tournament?.name ?? '大会';
  const tournamentDesc = (tournament?.description ?? tournament?.notes ?? '').trim();

  return (
    <div className="min-h-screen px-3 py-4 md:px-4 md:py-6 text-white">
      <div className="max-w-6xl mx-auto space-y-4 md:space-y-6">
        {/* ===== Header ===== */}
        <div className="rounded-2xl border border-purple-500/40 bg-purple-900/30 p-5">
          <div className="flex flex-col md:flex-row md:items-stretch md:justify-between gap-4">
            <div className="flex-1">
              <div className="text-xs text-purple-200 mb-1">TOURNAMENT</div>
              <h1 className="text-3xl font-extrabold">{tournamentTitle}</h1>
              {tournamentDesc ? <div className="mt-1 text-sm text-purple-100/90 whitespace-pre-wrap">{tournamentDesc}</div> : null}

              <div className="mt-4 pt-4 border-t border-purple-500/20 flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs text-purple-200 mb-1">FINALS</div>
                  <div className="text-2xl font-bold">{bracket.title ?? '決勝トーナメント'}</div>
                  <Link href={`/tournaments/${tournamentId}`} className="text-blue-300 underline text-xs">
                    大会トップへ
                  </Link>
                </div>

                <button onClick={() => void loadAll()} className="text-blue-300 underline text-xs shrink-0" type="button">
                  再読み込み
                </button>
              </div>
            </div>

            {showChampion && winnerPlayerFinal && (
              <div className="w-full md:w-80 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 p-4 md:p-5 self-stretch flex items-center gap-4">
                <div className="flex flex-col items-center gap-2 shrink-0">
                  <FaTrophy className="text-2xl md:text-3xl text-yellow-300" />
                  <div className="text-[11px] md:text-xs text-yellow-100/80 font-semibold">CHAMPION</div>
                </div>
                <div className="flex items-center gap-4 min-w-0">
                  {winnerPlayerFinal.avatar_url ? (
                    <div className="relative w-16 h-16 md:w-20 md:h-20 rounded-full overflow-hidden border border-yellow-300/70">
                      <Image src={winnerPlayerFinal.avatar_url} alt={winnerPlayerFinal.handle_name ?? 'champion'} fill sizes="80px" className="object-cover" unoptimized />
                    </div>
                  ) : (
                    <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-white/10 border border-yellow-300/30" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xl md:text-2xl font-extrabold truncate">{winnerPlayerFinal.handle_name ?? '優勝者'}</div>
                    <div className="text-xs md:text-sm text-yellow-100/90 mt-1">
                      RP: {winnerPlayerFinal.ranking_points ?? 0} / HC: {winnerPlayerFinal.handicap ?? 0}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ===== Round Tabs ===== */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {rounds.map((r) => {
            const active = r === activeRound;
            return (
              <button
                key={r}
                onClick={() => {
                  const el = scrollerRef.current;
                  if (!el) return;
                  const idx = rounds.indexOf(r);
                  const w = el.getBoundingClientRect().width || 1;
                  el.scrollTo({ left: w * idx, behavior: 'smooth' });
                  setActiveRound(r);
                }}
                className={[
                  'shrink-0 rounded-full border px-3 py-1 text-xs',
                  active ? 'border-blue-400/60 bg-blue-500/20 text-blue-100' : 'border-white/15 bg-white/5 text-gray-200',
                ].join(' ')}
                type="button"
              >
                R{r}
              </button>
            );
          })}
        </div>

        {/* ===== Swipe ===== */}
        <div
          ref={scrollerRef}
          onScroll={() => {
            const el = scrollerRef.current;
            if (!el) return;
            const w = el.getBoundingClientRect().width || 1;
            const idx = Math.round(el.scrollLeft / w);
            const r = rounds[Math.max(0, Math.min(rounds.length - 1, idx))];
            if (r && r !== activeRound) setActiveRound(r);
          }}
          className="-mx-3 px-3 md:-mx-4 md:px-4 flex overflow-x-auto snap-x snap-mandatory scroll-smooth"
        >
          {rounds.map((roundNo) => {
            const matchNos = matchNosForRound.get(roundNo) ?? [1];

            return (
              <section key={roundNo} className="w-full shrink-0 snap-start pr-3 md:pr-4">
                <div className="rounded-2xl border border-white/15 bg-white/5 p-4 space-y-4">
                  <div className="flex items-baseline justify-between">
                    <div className="text-xs text-gray-300">ROUND</div>
                    <div className="text-sm font-bold">R{roundNo}</div>
                  </div>

                  <div className="space-y-4">
                    {matchNos.map((matchNo) => {
                      if (!shouldRenderMatch(roundNo, matchNo)) return null;

                      const slotA = matchNo * 2 - 1;
                      const slotB = matchNo * 2;

                      const pidA = entryMap.get(`${roundNo}:${slotA}`)?.player_id ?? null;
                      const pidB = entryMap.get(`${roundNo}:${slotB}`)?.player_id ?? null;

                      const aReal = isRealPlayerId(pidA);
                      const bReal = isRealPlayerId(pidB);
                      if (!aReal && !bReal) return null;

                      const m = matchByRoundMatch.get(`${roundNo}:${matchNo}`) ?? null;

                      const wId = (m?.winner_id ? String(m.winner_id) : inferWinnerId(m, pidA, pidB)) ?? null;
                      const reason = normalizeReason(m);

                      const aIsWinner = !!wId && !!pidA && wId === pidA;
                      const bIsWinner = !!wId && !!pidB && wId === pidB;

                      const aScore = scoreTextFor(m, pidA, pidA, pidB);
                      const bScore = scoreTextFor(m, pidB, pidA, pidB);

                      // setsがメイン表示できないケースの補助（UIはそのまま）
                      const aSetsSecondary = !aScore.isSets && aIsWinner ? formatSetsTextForPlayer(m, pidA, pidA, pidB) : null;
                      const bSetsSecondary = !bScore.isSets && bIsWinner ? formatSetsTextForPlayer(m, pidB, pidA, pidB) : null;

                      return (
                        <div key={`r${roundNo}-m${matchNo}`} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                          <div className="text-xs text-gray-300 mb-2">
                            R{roundNo}-{matchNo}
                            {roundNo === (rounds[rounds.length - 1] ?? roundNo) ? <span className="ml-2 text-[11px] text-gray-400">(決勝)</span> : null}
                          </div>

                          <div className="space-y-3">
                            <PlayerLine
                              p={pidA ? players[pidA] : undefined}
                              isWinner={aIsWinner}
                              scoreText={aScore.text}
                              scoreIsSets={aScore.isSets}
                              setsTextSecondary={aSetsSecondary}
                              reason={aIsWinner ? reason : undefined}
                            />
                            <PlayerLine
                              p={pidB ? players[pidB] : undefined}
                              isWinner={bIsWinner}
                              scoreText={bScore.text}
                              scoreIsSets={bScore.isSets}
                              setsTextSecondary={bSetsSecondary}
                              reason={bIsWinner ? reason : undefined}
                            />
                          </div>

                          {!hasAnyResult(m) && <div className="mt-2 text-[11px] text-gray-400">※ スコア未登録（管理者が入力すると反映されます）</div>}
                        </div>
                      );
                    })}
                  </div>

                  <div className="text-[11px] text-gray-400">※ 勝者カードは濃い赤＋縦長（約1.6倍）で強調表示されます。</div>
                </div>
              </section>
            );
          })}

          {showChampion && winnerPlayerFinal && (
            <section key="champion-slide" className="w-full shrink-0 snap-start pr-3 md:pr-4">
              <div className="rounded-2xl border border-yellow-400/50 bg-yellow-500/10 p-6 md:p-8 flex flex-col items-center gap-4">
                <div className="flex items-center gap-3 text-yellow-200 mb-2">
                  <FaTrophy className="text-3xl md:text-4xl" />
                  <div className="text-lg md:text-xl font-semibold">FINAL WINNER</div>
                </div>

                {winnerPlayerFinal.avatar_url ? (
                  <div className="relative w-28 h-28 md:w-32 md:h-32 rounded-full overflow-hidden border border-yellow-300/80">
                    <Image src={winnerPlayerFinal.avatar_url} alt={winnerPlayerFinal.handle_name ?? 'champion'} fill sizes="128px" className="object-cover" unoptimized />
                  </div>
                ) : (
                  <div className="w-28 h-28 md:w-32 md:h-32 rounded-full bg-white/10 border border-yellow-300/40" />
                )}

                <div className="text-3xl md:text-5xl font-extrabold text-center truncate max-w-full">{winnerPlayerFinal.handle_name ?? '優勝者'}</div>
                <div className="text-sm md:text-base text-yellow-100/90">
                  RP: {winnerPlayerFinal.ranking_points ?? 0} / HC: {winnerPlayerFinal.handicap ?? 0}
                </div>
                <div className="text-[11px] md:text-xs text-yellow-100/70 text-center mt-1">決勝トーナメントの頂点に立ったプレーヤーです。</div>
              </div>
            </section>
          )}
        </div>

        <div className="text-right text-xs">
          <Link href={`/tournaments/${tournamentId}/league/results`} className="text-blue-300 underline">
            予選（リーグ）結果へ
          </Link>
        </div>
      </div>
    </div>
  );
}
