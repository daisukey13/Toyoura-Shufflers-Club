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

  winner_id?: string | null;
  loser_id?: string | null;
  winner_score?: number | null;
  loser_score?: number | null;

  finish_reason?: string | null;
  end_reason?: string | null;

  // 環境差を吸収（存在するかも）
  [key: string]: any;
};

type Player = {
  id: string;
  handle_name: string | null;
  avatar_url: string | null;
  ranking_points: number | null;
  handicap: number | null;

  // dummy 判定用
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

  return (
    <div className={[base, isWinner ? winnerStyle : loserStyle].join(' ')}>
      <div className="flex items-center gap-3 min-w-0">
        {p?.avatar_url ? (
          <div className={`${avatarSize} relative rounded-full overflow-hidden border border-white/20 shrink-0`}>
            <Image
              src={p.avatar_url}
              alt={p.handle_name ?? ''}
              fill
              sizes={isWinner ? '(max-width: 768px) 48px, 56px' : '(max-width: 768px) 36px, 40px'}
              className="object-cover"
            />
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
      // 0) tournament（列差分対策で *）
      const { data: tRow, error: tErr } = await supabase
        .from('tournaments')
        .select('*')
        .eq('id', tournamentId)
        .maybeSingle();

      if (!tErr && tRow) setTournament(tRow as TournamentRow);
      else setTournament(null);

      // 1) finals bracket（最新）
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

      // 2) entries
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

      // 3) matches
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

      // 4) players（is_dummy も取得）
      const ids = Array.from(
        new Set(
          [
            ...es.map((r) => r.player_id).filter((x): x is string => !!x),
            ...ms.flatMap((m) => [m.winner_id ?? null, m.loser_id ?? null]).filter((x): x is string => !!x),
            ...ms
              .flatMap((m) => [m.player_a_id, m.player_b_id, m.player1_id, m.player2_id].filter(Boolean))
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
        const no = Number(m.match_no ?? m.match_index ?? 0) || i + 1;
        map.set(`${r}:${no}`, m);
      });
    }

    return map;
  }, [matches]);

  // dummy/def 判定
  const isDummyPlayerId = (pid: string | null) => {
    if (!pid) return false;
    const p = players[pid];
    const name = (p?.handle_name ?? '').trim().toLowerCase();
    return Boolean(p?.is_dummy) || name === 'def';
  };
  const isRealPlayerId = (pid: string | null) => {
    if (!pid) return false;
    const p = players[pid];
    if (!p) return true; // 未ロードは real 扱い（隠しすぎ防止）
    return !isDummyPlayerId(pid);
  };

  const inferWinnerId = (m: FinalMatchRow | null, pidA: string | null, pidB: string | null) => {
    if (!m) return null;
    if (m.winner_id) return String(m.winner_id);

    const aId = m.player_a_id ?? m.player1_id ?? m.a_player_id ?? m.p1_id;
    const bId = m.player_b_id ?? m.player2_id ?? m.b_player_id ?? m.p2_id;

    const aScore = m.score_a ?? m.score1 ?? m.player1_score;
    const bScore = m.score_b ?? m.score2 ?? m.player2_score;

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

  const scoreTextFor = (m: FinalMatchRow | null, pid: string | null) => {
    if (!m || !pid) return '-';

    if (m.winner_id && String(m.winner_id) === pid) return String(m.winner_score ?? '-');
    if (m.loser_id && String(m.loser_id) === pid) return String(m.loser_score ?? '-');

    const aId = m.player_a_id ?? m.player1_id ?? m.a_player_id ?? m.p1_id;
    const bId = m.player_b_id ?? m.player2_id ?? m.b_player_id ?? m.p2_id;
    if (aId && String(aId) === pid) return String(m.score_a ?? m.score1 ?? m.player1_score ?? '-');
    if (bId && String(bId) === pid) return String(m.score_b ?? m.score2 ?? m.player2_score ?? '-');

    return '-';
  };

  /** 実プレーヤーが1人以上いる round だけ残す（def だけの round は非表示） */
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
        const ids = [
          m.winner_id ?? null,
          m.loser_id ?? null,
          m.player_a_id ?? null,
          m.player_b_id ?? null,
          m.player1_id ?? null,
          m.player2_id ?? null,
        ];
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

  /** round 内で表示する matchNo（def-only match は除外） */
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
        if (!hasAnyResult(m)) continue;

        const ids = [
          m.winner_id ?? null,
          m.loser_id ?? null,
          m.player_a_id ?? null,
          m.player_b_id ?? null,
          m.player1_id ?? null,
          m.player2_id ?? null,
        ];
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

  const winnerIdFinal = (() => {
    const lastRound = rounds[rounds.length - 1];
    const m = matchByRoundMatch.get(`${lastRound}:1`) ?? null;
    const pidA = entryMap.get(`${lastRound}:1`)?.player_id ?? null;
    const pidB = entryMap.get(`${lastRound}:2`)?.player_id ?? null;
    return (m?.winner_id ? String(m.winner_id) : inferWinnerId(m, pidA, pidB)) ?? null;
  })();

  const winnerPlayerFinal = winnerIdFinal ? players[winnerIdFinal] : null;
  const showChampion = !!winnerPlayerFinal && isRealPlayerId(winnerIdFinal);

  const tournamentTitle = tournament?.name ?? '大会';
  const tournamentDesc = (tournament?.description ?? tournament?.notes ?? '').trim();

  return (
    <div className="min-h-screen px-3 py-4 md:px-4 md:py-6 text-white">
      <div className="max-w-6xl mx-auto space-y-4 md:space-y-6">
        {/* ===== Header（大会タイトル + 優勝者カードを横並び） ===== */}
        <div className="rounded-2xl border border-purple-500/40 bg-purple-900/30 p-5">
          <div className="flex flex-col md:flex-row md:items-stretch md:justify-between gap-4">
            {/* 左：大会情報 & FINALS */}
            <div className="flex-1">
              <div className="text-xs text-purple-200 mb-1">TOURNAMENT</div>
              <h1 className="text-3xl font-extrabold">{tournamentTitle}</h1>
              {tournamentDesc ? (
                <div className="mt-1 text-sm text-purple-100/90 whitespace-pre-wrap">{tournamentDesc}</div>
              ) : null}

              <div className="mt-4 pt-4 border-t border-purple-500/20 flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs text-purple-200 mb-1">FINALS</div>
                  <div className="text-2xl font-bold">{bracket.title ?? '決勝トーナメント'}</div>
                  <Link href={`/tournaments/${tournamentId}`} className="text-blue-300 underline text-xs">
                    大会トップへ
                  </Link>
                </div>

                <button onClick={() => loadAll()} className="text-blue-300 underline text-xs shrink-0">
                  再読み込み
                </button>
              </div>
            </div>

            {/* 右：優勝者カード（あれば） */}
            {showChampion && winnerPlayerFinal && (
              <div className="w-full md:w-80 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 p-4 md:p-5 self-stretch flex items-center gap-4">
                <div className="flex flex-col items-center gap-2 shrink-0">
                  <FaTrophy className="text-2xl md:text-3xl text-yellow-300" />
                  <div className="text-[11px] md:text-xs text-yellow-100/80 font-semibold">CHAMPION</div>
                </div>
                <div className="flex items-center gap-4 min-w-0">
                  {winnerPlayerFinal.avatar_url ? (
                    <div className="relative w-16 h-16 md:w-20 md:h-20 rounded-full overflow-hidden border border-yellow-300/70">
                      <Image
                        src={winnerPlayerFinal.avatar_url}
                        alt={winnerPlayerFinal.handle_name ?? ''}
                        fill
                        sizes="(max-width: 768px) 64px, 80px"
                        className="object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-white/10 border border-yellow-300/30" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xl md:text-2xl font-extrabold truncate">
                      {winnerPlayerFinal.handle_name ?? '優勝者'}
                    </div>
                    <div className="text-xs md:text-sm text-yellow-100/90 mt-1">
                      RP: {winnerPlayerFinal.ranking_points ?? 0} / HC: {winnerPlayerFinal.handicap ?? 0}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ===== Round Tabs（def-only ラウンドはここに出てこない） ===== */}
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
                  active
                    ? 'border-blue-400/60 bg-blue-500/20 text-blue-100'
                    : 'border-white/15 bg-white/5 text-gray-200',
                ].join(' ')}
              >
                R{r}
              </button>
            );
          })}
        </div>

        {/* ===== スワイプエリア（最後に優勝者だけの画面を追加） ===== */}
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
          {/* 各ラウンド */}
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

                      return (
                        <div key={`r${roundNo}-m${matchNo}`} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                          <div className="text-xs text-gray-300 mb-2">
                            R{roundNo}-{matchNo}
                            {roundNo === rounds[rounds.length - 1] ? (
                              <span className="ml-2 text-[11px] text-gray-400">(決勝)</span>
                            ) : null}
                          </div>

                          <div className="space-y-3">
                            <PlayerLine
                              p={pidA ? players[pidA] : undefined}
                              isWinner={!!wId && !!pidA && wId === pidA}
                              scoreText={scoreTextFor(m, pidA)}
                              reason={reason}
                            />
                            <PlayerLine
                              p={pidB ? players[pidB] : undefined}
                              isWinner={!!wId && !!pidB && wId === pidB}
                              scoreText={scoreTextFor(m, pidB)}
                            />
                          </div>

                          {!hasAnyResult(m) && (
                            <div className="mt-2 text-[11px] text-gray-400">
                              ※ スコア未登録（管理者が入力すると反映されます）
                            </div>
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

          {/* 決勝の右側：優勝者だけの画面 */}
          {showChampion && winnerPlayerFinal && (
            <section key="champion-slide" className="w-full shrink-0 snap-start pr-3 md:pr-4">
              <div className="rounded-2xl border border-yellow-400/50 bg-yellow-500/10 p-6 md:p-8 flex flex-col items-center gap-4">
                <div className="flex items-center gap-3 text-yellow-200 mb-2">
                  <FaTrophy className="text-3xl md:text-4xl" />
                  <div className="text-lg md:text-xl font-semibold">FINAL WINNER</div>
                </div>

                {winnerPlayerFinal.avatar_url ? (
                  <div className="relative w-28 h-28 md:w-32 md:h-32 rounded-full overflow-hidden border border-yellow-300/80">
                    <Image
                      src={winnerPlayerFinal.avatar_url}
                      alt={winnerPlayerFinal.handle_name ?? ''}
                      fill
                      sizes="(max-width: 768px) 112px, 128px"
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-28 h-28 md:w-32 md:h-32 rounded-full bg-white/10 border border-yellow-300/40" />
                )}

                <div className="text-3xl md:text-5xl font-extrabold text-center truncate max-w-full">
                  {winnerPlayerFinal.handle_name ?? '優勝者'}
                </div>
                <div className="text-sm md:text-base text-yellow-100/90">
                  RP: {winnerPlayerFinal.ranking_points ?? 0} / HC: {winnerPlayerFinal.handicap ?? 0}
                </div>
                <div className="text-[11px] md:text-xs text-yellow-100/70 text-center mt-1">
                  決勝トーナメントの頂点に立ったプレーヤーです。
                </div>
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
