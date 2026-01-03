// app/tournaments/[tournamentId]/finals/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

  player_a_id?: string | null;
  player_b_id?: string | null;

  winner_id?: string | null;
  loser_id?: string | null;

  winner_score?: number | null;
  loser_score?: number | null;

  winner_sets?: number | null;
  loser_sets?: number | null;

  match_format?: string | null;
  format?: string | null;

  sets?: any;
  sets_json?: any;

  finish_reason?: string | null;
  end_reason?: string | null;

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

const hasAnyResult = (m: FinalMatchRow | null) => {
  if (!m) return false;
  if (m.winner_id || m.loser_id) return true;
  if (m.winner_score != null || m.loser_score != null) return true;
  if (m.winner_sets != null || m.loser_sets != null) return true;
  if (m.sets != null || m.sets_json != null) return true;

  const keys = Object.keys(m);
  for (const k of keys) {
    if (!k) continue;
    const lk = k.toLowerCase();
    if (lk.includes('set') && (lk.includes('score') || lk.includes('winner') || lk.includes('loser'))) {
      if (m[k] != null && String(m[k]) !== '') return true;
    }
  }
  return false;
};

type SetPair = { a: number | null; b: number | null };

const safeNum = (v: any): number | null => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return n;
};

/**
 * ★ sets / sets_json の吸収
 * - 配列: [{a,b},...]
 * - オブジェクト: { games: [{a,b},...], format:"bo3", advantage:{...} }
 * - オブジェクト: { format:"single", advantage:{...} }（gamesが無くても meta として扱う）
 * - JSON文字列
 */
const parseSetsLike = (raw: any): { games: SetPair[]; meta?: any } | null => {
  if (raw == null) return null;

  let v: any = raw;

  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    try {
      v = JSON.parse(s);
    } catch {
      return null;
    }
  }

  // object (games が無くても format/advantage があれば meta として採用)
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const gamesArr = Array.isArray((v as any).games) ? ((v as any).games as any[]) : [];
    const games: SetPair[] = gamesArr.map((x) => ({
      a: safeNum(x?.a ?? x?.A ?? x?.score_a ?? x?.scoreA ?? null),
      b: safeNum(x?.b ?? x?.B ?? x?.score_b ?? x?.scoreB ?? null),
    }));

    // 最大3・不足はnull埋め
    const trimmed = games.slice(0, 3);
    while (trimmed.length < 3) trimmed.push({ a: null, b: null });

    // games が空でも format/advantage があれば採用
    const hasMeta = (v as any).format != null || (v as any).advantage != null || (v as any).games != null;
    if (hasMeta) return { games: trimmed, meta: v };

    return null;
  }

  // array
  if (Array.isArray(v)) {
    const games: SetPair[] = v.map((x: any) => ({
      a: safeNum(x?.a ?? x?.A ?? x?.score_a ?? x?.scoreA ?? null),
      b: safeNum(x?.b ?? x?.B ?? x?.score_b ?? x?.scoreB ?? null),
    }));
    const trimmed = games.slice(0, 3);
    while (trimmed.length < 3) trimmed.push({ a: null, b: null });
    return { games: trimmed, meta: null };
  }

  return null;
};

const getSetsForMatch = (m: FinalMatchRow | null): { games: SetPair[]; meta?: any } | null => {
  if (!m) return null;

  const a = parseSetsLike(m.sets);
  if (a) return a;

  const b = parseSetsLike(m.sets_json);
  if (b) return b;

  // 互換: set1_a / set1_b
  const viaKeys: SetPair[] = [];
  for (let i = 1; i <= 3; i++) {
    const ka = `set${i}_a`;
    const kb = `set${i}_b`;
    if (m[ka] == null && m[kb] == null) continue;
    viaKeys.push({ a: safeNum(m[ka]), b: safeNum(m[kb]) });
  }
  if (viaKeys.length) {
    while (viaKeys.length < 3) viaKeys.push({ a: null, b: null });
    return { games: viaKeys.slice(0, 3), meta: null };
  }

  return null;
};

const detectFormat = (m: FinalMatchRow | null): 'single' | 'best_of_3' => {
  if (!m) return 'single';

  // ★ まず meta.format を優先
  const s = getSetsForMatch(m);
  const metaFmt = String((s?.meta as any)?.format ?? '').trim().toLowerCase();
  if (metaFmt) {
    if (metaFmt.includes('bo3') || metaFmt.includes('best') || metaFmt.includes('3')) return 'best_of_3';
    if (metaFmt.includes('single') || metaFmt.includes('one') || metaFmt === '1') return 'single';
  }

  const f = String(m.match_format ?? m.format ?? '').trim().toLowerCase();
  if (f) {
    if (f.includes('bo3') || f.includes('best') || f.includes('3')) return 'best_of_3';
    if (f.includes('single') || f.includes('one') || f.includes('1')) return 'single';
  }

  // games が2つ以上入っていれば best_of_3
  if (s?.games) {
    const filled = s.games.filter((x) => x.a != null && x.b != null).length;
    if (filled >= 2) return 'best_of_3';
  }

  if (m.winner_sets != null || m.loser_sets != null) return 'best_of_3';

  const ws = typeof m.winner_score === 'number' ? m.winner_score : null;
  const ls = typeof m.loser_score === 'number' ? m.loser_score : null;
  if (ws != null && ls != null && ws >= 0 && ws <= 3 && ls >= 0 && ls <= 3) return 'best_of_3';

  return 'single';
};

const getMatchPlayerAB = (m: FinalMatchRow | null): { aId: string | null; bId: string | null } => {
  if (!m) return { aId: null, bId: null };
  const aId = m.player_a_id ?? (m as any).player1_id ?? (m as any).a_player_id ?? (m as any).p1_id ?? null;
  const bId = m.player_b_id ?? (m as any).player2_id ?? (m as any).b_player_id ?? (m as any).p2_id ?? null;
  return { aId: aId ? String(aId) : null, bId: bId ? String(bId) : null };
};

const detectSwapAB = (m: FinalMatchRow | null, pidA: string | null, pidB: string | null) => {
  if (!m || !pidA || !pidB) return false;
  const { aId, bId } = getMatchPlayerAB(m);
  if (!aId || !bId) return false;
  return aId === pidB && bId === pidA;
};

const getAdvantageForMatchInEntryOrder = (m: FinalMatchRow | null, pidA: string | null, pidB: string | null) => {
  const s = getSetsForMatch(m);
  const adv = (s?.meta as any)?.advantage ?? null;

  const rawA = Math.max(0, toInt(adv?.a ?? adv?.A ?? 0, 0));
  const rawB = Math.max(0, toInt(adv?.b ?? adv?.B ?? 0, 0));

  const swap = detectSwapAB(m, pidA, pidB);
  return swap ? { a: rawB, b: rawA } : { a: rawA, b: rawB };
};

type MatchOutcome = {
  fmt: 'single' | 'best_of_3';
  requiredWins: number;
  advA: number;
  advB: number;
  aRealWins: number;
  bRealWins: number;
  played: SetPair[]; // 表示対象（決着までに必要なぶんだけ）
};

/**
 * ★決着するまでの games だけを採用（advantage を考慮して早期打ち切り）
 * これで R2 の「余計な2本目」が表示から消える
 */
const getMatchOutcome = (m: FinalMatchRow | null, pidA: string | null, pidB: string | null): MatchOutcome | null => {
  if (!m || !pidA || !pidB) return null;

  const fmt = detectFormat(m);
  const requiredWins = fmt === 'single' ? 1 : 2;

  const adv = getAdvantageForMatchInEntryOrder(m, pidA, pidB);
  const advA = adv.a;
  const advB = adv.b;

  const s = getSetsForMatch(m);
  const rawGames = s?.games ?? null;
  if (!rawGames) {
    return { fmt, requiredWins, advA, advB, aRealWins: 0, bRealWins: 0, played: [] };
  }

  const swap = detectSwapAB(m, pidA, pidB);

  // entry(表示)の A/B 並びに合わせた games に変換
  const games = rawGames.map((g) => (swap ? { a: g.b, b: g.a } : g));

  let totalA = advA;
  let totalB = advB;
  let aRealWins = 0;
  let bRealWins = 0;
  const played: SetPair[] = [];

  for (const g of games) {
    if (g.a == null || g.b == null) continue;
    if (g.a === g.b) continue;

    played.push(g);

    if (g.a > g.b) {
      aRealWins += 1;
      totalA += 1;
    } else {
      bRealWins += 1;
      totalB += 1;
    }

    // ★ advantage を含めた合計勝数で決着したらここで打ち切り
    if (totalA >= requiredWins || totalB >= requiredWins) break;
  }

  return { fmt, requiredWins, advA, advB, aRealWins, bRealWins, played };
};

function AdvantageBadge({ wins }: { wins: number }) {
  if (!wins || wins <= 0) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-sky-400/40 bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-200">
      advantage: {wins}勝
    </span>
  );
}

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

function PlayerLine({
  p,
  isWinner,
  scoreText,
  reason,
}: {
  p?: Player;
  isWinner: boolean;
  scoreText: string;
  reason?: string;
}) {
  const base = 'flex items-center justify-between gap-3 rounded-2xl border overflow-hidden';
  const loserStyle = 'bg-black/35 border-white/10 px-3 py-3 min-h-[56px]';
  const winnerStyle =
    'bg-rose-950/80 border-rose-400/50 px-4 py-5 min-h-[90px] shadow-[0_0_0_1px_rgba(244,63,94,0.18),0_20px_70px_-40px_rgba(244,63,94,0.5)]';

  const avatarSize = isWinner ? 'w-12 h-12 md:w-14 md:h-14' : 'w-9 h-9 md:w-10 md:h-10';
  const nameSize = isWinner ? 'text-xl md:text-2xl' : 'text-sm md:text-base';
  const subSize = isWinner ? 'text-sm md:text-base text-rose-100/90' : 'text-[11px] text-gray-300';
  const scoreSize = isWinner ? 'text-4xl md:text-5xl' : 'text-xl md:text-2xl';

  const sizes = isWinner ? '56px' : '40px';

  return (
    <div className={[base, isWinner ? winnerStyle : loserStyle].join(' ')}>
      <div className="flex items-center gap-3 min-w-0">
        {p?.avatar_url ? (
          <div className={`${avatarSize} relative rounded-full overflow-hidden border border-white/20 shrink-0`}>
            <Image src={p.avatar_url} alt={p.handle_name ?? 'player'} fill sizes={sizes} className="object-cover" />
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
        <div className={`${scoreSize} font-extrabold tabular-nums leading-none`}>{scoreText}</div>
        {reason ? <ReasonBadge reason={reason} /> : null}
      </div>
    </div>
  );
}

function FormatBadge({ fmt }: { fmt: 'single' | 'best_of_3' }) {
  const label = fmt === 'best_of_3' ? '3本勝負' : '1本勝負';
  return (
    <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] text-gray-200">
      {label}
    </span>
  );
}

function WinLossLine({
  outcome,
}: {
  outcome: MatchOutcome | null;
}) {
  if (!outcome) return null;
  // ★「正味勝数」だけ表示（advantage は badge で見せる）
  return <div className="text-[11px] text-gray-300">勝敗 {outcome.aRealWins}-{outcome.bRealWins}</div>;
}

function SetsTable({
  outcome,
  aName,
  bName,
}: {
  outcome: MatchOutcome | null;
  aName: string;
  bName: string;
}) {
  if (!outcome) return null;

  const fmt = outcome.fmt;

  // 表示スロット数（従来UI維持）
  const slotsCount = fmt === 'single' ? 1 : 3;

  // まず「決着までに必要な分の実スコア」だけ
  const played = outcome.played.slice(0, slotsCount);

  // その後に advantage 分を「DEF勝ち」として埋める（空きがある時だけ）
  const defCount = Math.min(slotsCount - played.length, Math.max(outcome.advA, outcome.advB));
  const slots: Array<{ kind: 'play' | 'def' | 'empty'; s?: SetPair }> = [];

  for (const g of played) slots.push({ kind: 'play', s: g });
  for (let i = 0; i < defCount; i++) slots.push({ kind: 'def' });
  while (slots.length < slotsCount) slots.push({ kind: 'empty' });

  const labels =
    fmt === 'single'
      ? ['Game']
      : ['Set1', 'Set2', 'Set3'];

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3">
      <div className="text-[11px] text-gray-300 mb-2">各試合スコア</div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-[12px] border-collapse">
          <thead>
            <tr className="text-[11px] text-gray-300">
              <th className="text-left pr-3"> </th>
              <th className="text-left pr-3">{aName}</th>
              <th className="text-left pr-3">{bName}</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot, i) => {
              const label = slot.kind === 'def' ? 'DEF' : labels[i] ?? `Set${i + 1}`;

              let aCell: React.ReactNode = '-';
              let bCell: React.ReactNode = '-';

              if (slot.kind === 'play') {
                aCell = slot.s?.a != null ? slot.s.a : '-';
                bCell = slot.s?.b != null ? slot.s.b : '-';
              } else if (slot.kind === 'def') {
                if (outcome.advA > 0 && outcome.advB === 0) {
                  aCell = 'DEF';
                  bCell = '-';
                } else if (outcome.advB > 0 && outcome.advA === 0) {
                  aCell = '-';
                  bCell = 'DEF';
                } else {
                  // 万一両方advが入るケース
                  aCell = outcome.advA > 0 ? 'DEF' : '-';
                  bCell = outcome.advB > 0 ? 'DEF' : '-';
                }
              }

              return (
                <tr key={`${label}-${i}`} className="border-t border-white/10">
                  <td className="py-1 pr-3 text-gray-300">{label}</td>
                  <td className="py-1 pr-3 tabular-nums">{aCell}</td>
                  <td className="py-1 pr-3 tabular-nums">{bCell}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-2 text-[11px] text-gray-400">
        ※ 「DEF」は不戦勝（advantage 分の勝ち）です。
      </div>
    </div>
  );
}

/** final_matches は列差分が出やすいので * で1回だけ取る（400連発回避） */
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
  const tournamentId = typeof params?.tournamentId === 'string' ? String(params.tournamentId) : '';

  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [bracket, setBracket] = useState<FinalBracket | null>(null);
  const [entries, setEntries] = useState<FinalRoundEntry[]>([]);
  const [matches, setMatches] = useState<FinalMatchRow[]>([]);
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [activeRound, setActiveRound] = useState<number>(1);

  useEffect(() => {
    if (!tournamentId) return;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  const loadAll = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: tRow, error: tErr } = await supabase
        .from('tournaments')
        .select('*')
        .eq('id', tournamentId)
        .maybeSingle();

      if (!tErr && tRow) setTournament(tRow as TournamentRow);
      else setTournament(null);

      const { data: bRows, error: bErr } = await supabase
        .from('final_brackets')
        .select('*')
        .eq('tournament_id', tournamentId)
        .order('created_at', { ascending: false });

      if (bErr || !bRows || bRows.length === 0) {
        setError('決勝トーナメントが見つかりませんでした');
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
              .flatMap((m) => [m.player_a_id, m.player_b_id, (m as any).player1_id, (m as any).player2_id].filter(Boolean))
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
        const within = i + 1;
        map.set(`${r}:${within}`, m);

        const idx = Number(m.match_index ?? 0);
        if (idx > 0 && !map.has(`${r}:${idx}`)) map.set(`${r}:${idx}`, m);

        const no = Number(m.match_no ?? 0);
        if (no > 0 && !map.has(`${r}:${no}`)) map.set(`${r}:${no}`, m);
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
    if (!p) return true;
    return !isDummyPlayerId(pid);
  };

  const inferWinnerId = (m: FinalMatchRow | null, pidA: string | null, pidB: string | null) => {
    if (!m) return null;
    if (m.winner_id) return String(m.winner_id);

    const aId = m.player_a_id ?? (m as any).player1_id ?? (m as any).a_player_id ?? (m as any).p1_id;
    const bId = m.player_b_id ?? (m as any).player2_id ?? (m as any).b_player_id ?? (m as any).p2_id;

    const aScore = (m as any).score_a ?? (m as any).score1 ?? (m as any).player1_score;
    const bScore = (m as any).score_b ?? (m as any).score2 ?? (m as any).player2_score;

    if (aId && bId && aScore != null && bScore != null) {
      const sA = toInt(aScore, 0);
      const sB = toInt(bScore, 0);
      if (sA === sB) return null;
      return sA > sB ? String(aId) : String(bId);
    }

    void pidA;
    void pidB;
    return null;
  };

  /** 実プレーヤーが1人以上いる round だけ残す */
  const rounds = useMemo(() => {
    const candidate = new Set<number>();
    entries.forEach((e) => candidate.add(Number(e.round_no)));
    matches.forEach((m) => {
      const r = Number(m.round_no ?? 0);
      if (r > 0) candidate.add(r);
    });

    const roundHasAnyRealPlayer = (r: number) => {
      const pids = entries.filter((e) => e.round_no === r).map((e) => e.player_id).filter(Boolean) as string[];
      if (pids.some((pid) => isRealPlayerId(pid))) return true;

      for (const m of matches) {
        if (Number(m.round_no ?? 0) !== r) continue;
        const ids = [m.winner_id ?? null, m.loser_id ?? null, m.player_a_id ?? null, m.player_b_id ?? null, (m as any).player1_id ?? null, (m as any).player2_id ?? null];
        if (ids.some((id) => isRealPlayerId(id))) return true;
      }
      return false;
    };

    const filtered = Array.from(candidate)
      .filter((r) => r > 0)
      .filter((r) => roundHasAnyRealPlayer(r))
      .sort((a, b) => a - b);

    return filtered.length ? filtered : [1];
  }, [entries, matches, players]);

  useEffect(() => {
    if (rounds.length > 0) setActiveRound((prev) => (rounds.includes(prev) ? prev : rounds[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rounds.join(',')]);

  /** round 内で表示する matchNo */
  const matchNosForRound = useMemo(() => {
    const map = new Map<number, number[]>();

    const byRound = new Map<number, Map<number, { a?: FinalRoundEntry; b?: FinalRoundEntry }>>();
    for (const e of entries) {
      const r = Number(e.round_no);
      const mNo = Math.ceil(Number(e.slot_no) / 2);
      if (!byRound.has(r)) byRound.set(r, new Map());
      const mm = byRound.get(r)!;
      if (!mm.has(mNo)) mm.set(mNo, {});
      const pair = mm.get(mNo)!;
      if (e.slot_no % 2 === 1) pair.a = e;
      else pair.b = e;
    }

    for (const r of rounds) {
      const set = new Set<number>();

      const mm = byRound.get(r);
      const maxEntryMatchNo = mm ? Math.max(0, ...Array.from(mm.keys())) : 0;

      if (mm) {
        for (const [mNo, pair] of mm.entries()) {
          const aReal = isRealPlayerId(pair.a?.player_id ?? null);
          const bReal = isRealPlayerId(pair.b?.player_id ?? null);
          if (aReal || bReal) set.add(mNo);
        }
      }

      for (const [k, m] of matchByRoundMatch.entries()) {
        if (!k.startsWith(`${r}:`)) continue;
        const mNo = Number(k.split(':')[1] ?? 0);
        if (mNo <= 0) continue;

        if (maxEntryMatchNo > 0 && mNo > maxEntryMatchNo) continue;
        if (!hasAnyResult(m)) continue;

        const ids = [m.winner_id ?? null, m.loser_id ?? null, m.player_a_id ?? null, m.player_b_id ?? null, (m as any).player1_id ?? null, (m as any).player2_id ?? null];
        if (ids.some((id) => isRealPlayerId(id))) set.add(mNo);
      }

      const list = Array.from(set).sort((a, b) => a - b);
      map.set(r, list.length ? list : [1]);
    }

    return map;
  }, [entries, rounds, matchByRoundMatch, players]);

  if (!tournamentId) return <div className="p-4">大会IDが指定されていません。</div>;
  if (loading) return <div className="p-4 text-white">読み込み中...</div>;
  if (error) return <div className="p-4 text-red-300">{error}</div>;
  if (!bracket) return <div className="p-4">決勝トーナメントが見つかりません。</div>;

  // 優勝者判定（既存）
  const winnerIdFinal = (() => {
    const lastRound = rounds[rounds.length - 1];
    const matchNos = matchNosForRound.get(lastRound) ?? [1];
    const sortedNos = [...matchNos].sort((a, b) => a - b);

    for (let i = sortedNos.length - 1; i >= 0; i--) {
      const matchNo = sortedNos[i];
      const m = matchByRoundMatch.get(`${lastRound}:${matchNo}`) ?? null;
      if (!hasAnyResult(m)) continue;

      const slotA = matchNo * 2 - 1;
      const slotB = matchNo * 2;
      const pidA = entryMap.get(`${lastRound}:${slotA}`)?.player_id ?? null;
      const pidB = entryMap.get(`${lastRound}:${slotB}`)?.player_id ?? null;

      const w = (m?.winner_id ? String(m.winner_id) : inferWinnerId(m, pidA, pidB)) ?? null;
      if (w) return w;
    }

    const last = matchByRoundMatch.get(`${lastRound}:1`) ?? null;
    const pidA = entryMap.get(`${lastRound}:1`)?.player_id ?? null;
    const pidB = entryMap.get(`${lastRound}:2`)?.player_id ?? null;
    return (last?.winner_id ? String(last.winner_id) : inferWinnerId(last, pidA, pidB)) ?? null;
  })();

  const winnerPlayerFinal = winnerIdFinal ? players[winnerIdFinal] : null;
  const showChampion = !!winnerIdFinal && (winnerPlayerFinal ? isRealPlayerId(winnerIdFinal) : true);

  const champion: Player | null = showChampion
    ? winnerPlayerFinal ?? {
        id: winnerIdFinal!,
        handle_name: '優勝者',
        avatar_url: null,
        ranking_points: 0,
        handicap: 0,
        is_dummy: null,
      }
    : null;

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
                  <div className="mt-1 flex flex-wrap gap-3 text-xs">
                    <Link href={`/tournaments/${tournamentId}`} className="text-blue-300 underline">
                      大会トップへ
                    </Link>
                    <Link href={`/tournaments/${tournamentId}/league/results`} className="text-blue-300 underline">
                      予選（リーグ）結果へ
                    </Link>
                  </div>
                </div>

                <button onClick={() => loadAll()} className="text-blue-300 underline text-xs shrink-0">
                  再読み込み
                </button>
              </div>
            </div>

            {showChampion && champion && (
              <div className="w-full md:w-80 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 p-4 md:p-5 self-stretch flex items-center gap-4">
                <div className="flex flex-col items-center gap-2 shrink-0">
                  <FaTrophy className="text-2xl md:text-3xl text-yellow-300" />
                  <div className="text-[11px] md:text-xs text-yellow-100/80 font-semibold">CHAMPION</div>
                </div>
                <div className="flex items-center gap-4 min-w-0">
                  {champion.avatar_url ? (
                    <div className="relative w-16 h-16 md:w-20 md:h-20 rounded-full overflow-hidden border border-yellow-300/70">
                      <Image src={champion.avatar_url} alt={champion.handle_name ?? 'champion'} fill sizes="80px" className="object-cover" />
                    </div>
                  ) : (
                    <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-white/10 border border-yellow-300/30" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xl md:text-2xl font-extrabold truncate">{champion.handle_name ?? '優勝者'}</div>
                    <div className="text-xs md:text-sm text-yellow-100/90 mt-1">
                      RP: {champion.ranking_points ?? 0} / HC: {champion.handicap ?? 0}
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
              >
                R{r}
              </button>
            );
          })}
        </div>

        {/* ===== Swipe Area ===== */}
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
            const isFinalRound = roundNo === rounds[rounds.length - 1];

            return (
              <section key={roundNo} className="w-full shrink-0 snap-start pr-3 md:pr-4">
                <div className="rounded-2xl border border-white/15 bg-white/5 p-4 space-y-4">
                  <div className="flex items-baseline justify-between">
                    <div className="text-xs text-gray-300">ROUND</div>
                    <div className="text-sm font-bold">R{roundNo}</div>
                  </div>

                  <div className="space-y-4">
                    {matchNos.map((matchNo) => {
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

                      const outcome = getMatchOutcome(m, pidA, pidB);
                      const fmt = outcome?.fmt ?? detectFormat(m);

                      const advA = outcome?.advA ?? getAdvantageForMatchInEntryOrder(m, pidA, pidB).a;
                      const advB = outcome?.advB ?? getAdvantageForMatchInEntryOrder(m, pidA, pidB).b;
                      const advMax = Math.max(advA, advB);

                      const aName = pidA ? players[pidA]?.handle_name ?? '未設定' : '未設定';
                      const bName = pidB ? players[pidB]?.handle_name ?? '未設定' : '未設定';

                      const aScoreText =
                        outcome ? String(outcome.aRealWins) : '-';
                      const bScoreText =
                        outcome ? String(outcome.bRealWins) : '-';

                      return (
                        <div key={`r${roundNo}-m${matchNo}`} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <div className="text-xs text-gray-300">
                              R{roundNo}-{matchNo}
                              {isFinalRound ? <span className="ml-2 text-[11px] text-gray-400">(決勝)</span> : null}
                            </div>

                            <div className="flex items-center gap-2">
                              {advMax > 0 ? <AdvantageBadge wins={advMax} /> : null}
                              <FormatBadge fmt={fmt} />
                            </div>
                          </div>

                          {/* ★勝敗（正味勝数） */}
                          <WinLossLine outcome={outcome} />

                          <div className="space-y-3 mt-2">
                            <PlayerLine
                              p={pidA ? players[pidA] : undefined}
                              isWinner={!!wId && !!pidA && wId === pidA}
                              scoreText={aScoreText}
                              reason={reason}
                            />
                            <PlayerLine
                              p={pidB ? players[pidB] : undefined}
                              isWinner={!!wId && !!pidB && wId === pidB}
                              scoreText={bScoreText}
                            />
                          </div>

                          {/* ★各Set/Gameスコア（advantage は DEF として表示） */}
                          <SetsTable outcome={outcome} aName={aName} bName={bName} />

                          {!hasAnyResult(m) && (
                            <div className="mt-2 text-[11px] text-gray-400">※ スコア未登録（管理者が入力すると反映されます）</div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="text-[11px] text-gray-400">※ 勝者カードは濃い赤＋縦長（約1.6倍）で強調表示されます。</div>
                </div>
              </section>
            );
          })}

          {showChampion && champion && (
            <section key="champion-slide" className="w-full shrink-0 snap-start pr-3 md:pr-4">
              <div className="rounded-2xl border border-yellow-400/50 bg-yellow-500/10 p-6 md:p-8 flex flex-col items-center gap-4">
                <div className="flex items-center gap-3 text-yellow-200 mb-2">
                  <FaTrophy className="text-3xl md:text-4xl" />
                  <div className="text-lg md:text-xl font-semibold">FINAL WINNER</div>
                </div>

                {champion.avatar_url ? (
                  <div className="relative w-28 h-28 md:w-32 md:h-32 rounded-full overflow-hidden border border-yellow-300/80">
                    <Image src={champion.avatar_url} alt={champion.handle_name ?? 'champion'} fill sizes="128px" className="object-cover" />
                  </div>
                ) : (
                  <div className="w-28 h-28 md:w-32 md:h-32 rounded-full bg-white/10 border border-yellow-300/40" />
                )}

                <div className="text-3xl md:text-5xl font-extrabold text-center truncate max-w-full">
                  {champion.handle_name ?? '優勝者'}
                </div>
                <div className="text-sm md:text-base text-yellow-100/90">
                  RP: {champion.ranking_points ?? 0} / HC: {champion.handicap ?? 0}
                </div>
                <div className="text-[11px] md:text-xs text-yellow-100/70 text-center mt-1">
                  決勝トーナメントの頂点に立ったプレーヤーです。
                </div>
              </div>
            </section>
          )}
        </div>

        <div className="text-right text-xs flex justify-end gap-4">
          <Link href={`/tournaments/${tournamentId}/league/results`} className="text-blue-300 underline">
            予選（リーグ）結果へ
          </Link>
          <Link href={`/tournaments/${tournamentId}`} className="text-blue-300 underline">
            大会トップへ
          </Link>
        </div>
      </div>
    </div>
  );
}
