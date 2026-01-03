// app/tournaments/[tournamentId]/league/results/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image, { type ImageLoaderProps } from 'next/image';
import { FaTrophy } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();
const passthroughLoader = ({ src }: ImageLoaderProps) => src;

/* ========= Types ========= */
type Tournament = {
  id: string;
  name: string | null;
  start_date: string | null;
  notes: string | null;
  description?: string | null;
};

type RankingRow = {
  player_id: string;
  wins: number;
  losses: number;
  points_for: number;
  points_against: number;
  point_diff: number;
};

type LeagueBlock = {
  id: string;
  label: string | null;
  status: string | null;
  tournament_id: string | null;
  winner_player_id: string | null;
  ranking_json: RankingRow[] | null;
};

type Player = {
  id: string;
  handle_name: string | null;
  avatar_url: string | null;
  ranking_points: number | null;
  handicap: number | null;
};

type MatchCard = {
  id: string;
  league_block_id: string;
  player_a_id: string;
  player_b_id: string;
  winner_id: string | null;
  loser_id: string | null;
  winner_score: number | null;
  loser_score: number | null;
  end_reason: string | null;
  time_limit_seconds: number | null;
};

function getPointDiffSafe(r: any): number {
  const direct = Number(r.point_diff ?? (r as any).pointDiff);
  if (Number.isFinite(direct)) return direct;

  const pf = Number(r.points_for ?? (r as any).pointsFor ?? (r as any).gf ?? (r as any).goals_for ?? 0);
  const pa = Number(r.points_against ?? (r as any).pointsAgainst ?? (r as any).ga ?? (r as any).goals_against ?? 0);
  const calc = pf - pa;
  return Number.isFinite(calc) ? calc : 0;
}

function resolveBlockWinner(block: LeagueBlock, ranking: RankingRow[], isComplete: boolean): string | null {
  if (block.winner_player_id) return block.winner_player_id;
  if (!isComplete) return null;
  if (!ranking.length) return null;

  const sorted = [...ranking].sort((a, b) => {
    const aw = Number(a.wins ?? 0);
    const bw = Number(b.wins ?? 0);
    if (bw !== aw) return bw - aw;

    const apd = getPointDiffSafe(a);
    const bpd = getPointDiffSafe(b);
    if (bpd !== apd) return bpd - apd;

    const apf = Number(a.points_for ?? 0);
    const bpf = Number(b.points_for ?? 0);
    return bpf - apf;
  });

  const top = sorted[0];
  const topWins = Number(top.wins ?? 0);
  const topPd = getPointDiffSafe(top);

  const hasTie = sorted.some(
    (row, idx) => idx > 0 && Number(row.wins ?? 0) === topWins && getPointDiffSafe(row) === topPd
  );
  if (hasTie) return null;

  return top.player_id;
}

function computeDisplayRank(ranking: RankingRow[], idx: number): number {
  if (ranking.length === 0) return idx + 1;

  const base = ranking[0];
  const baseDiff = getPointDiffSafe(base);

  const isAllSame =
    ranking.length > 1 &&
    ranking.every(
      (r) =>
        r.wins === base.wins &&
        r.losses === base.losses &&
        getPointDiffSafe(r) === baseDiff &&
        baseDiff === 0
    );

  if (isAllSame) return 1;
  return idx + 1;
}

function formatTimeLimit(seconds: number | null) {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m <= 0) return `${s}秒`;
  if (s === 0) return `${m}分`;
  return `${m}分${s}秒`;
}

function EndReasonBadge({
  end_reason,
  time_limit_seconds,
}: {
  end_reason: string | null;
  time_limit_seconds: number | null;
}) {
  if (!end_reason || end_reason === 'normal') return null;

  if (end_reason === 'time_limit') {
    const t = formatTimeLimit(time_limit_seconds);
    return (
      <span className="ml-2 inline-flex items-center rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-200">
        時間制限{t ? `(${t})` : ''}
      </span>
    );
  }

  if (end_reason === 'walkover') {
    return (
      <span className="ml-2 inline-flex items-center rounded-full border border-sky-400/40 bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-200">
        不戦勝
      </span>
    );
  }

  if (end_reason === 'forfeit') {
    return (
      <span className="ml-2 inline-flex items-center rounded-full border border-rose-400/40 bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-200">
        途中棄権
      </span>
    );
  }

  return (
    <span className="ml-2 inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] text-gray-200">
      {end_reason}
    </span>
  );
}

const isFinishedStatus = (s: string | null) => {
  const v = String(s ?? '').trim().toLowerCase();
  return v === 'finished' || v === 'done' || v === 'complete' || v === 'completed';
};

export default function TournamentLeagueResultsPage() {
  const params = useParams();
  const tournamentId = typeof params?.tournamentId === 'string' ? (params.tournamentId as string) : '';

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [blocks, setBlocks] = useState<LeagueBlock[]>([]);
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [matchCards, setMatchCards] = useState<MatchCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ✅ ブロック勝者アバターのエラー保持
  const [blockWinnerImgError, setBlockWinnerImgError] = useState<Record<string, boolean>>({});

  // ✅ 管理者判定 + 手動確定UI
  const [authz, setAuthz] = useState<'checking' | 'guest' | 'user'>('checking');
  const [isAdmin, setIsAdmin] = useState(false);
  const [winnerPickByBlock, setWinnerPickByBlock] = useState<Record<string, string>>({});
  const [savingWinnerBlockId, setSavingWinnerBlockId] = useState<string | null>(null);
  const [winnerSaveErrorByBlock, setWinnerSaveErrorByBlock] = useState<Record<string, string>>({});

  const calcPointDiff = (r: any) => getPointDiffSafe(r);
  const formatSigned = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  const matchCardsByBlock = useMemo(() => {
    const m = new Map<string, MatchCard[]>();
    for (const c of matchCards) {
      const arr = m.get(c.league_block_id) ?? [];
      arr.push(c);
      m.set(c.league_block_id, arr);
    }
    return m;
  }, [matchCards]);

  const isDefPlayerId = (pid: string | null) => {
    if (!pid) return false;
    const p = players[pid];
    const name = String(p?.handle_name ?? '').trim().toLowerCase();
    return name === 'def';
  };

  const isRealPlayerId = (pid: string | null) => {
    if (!pid) return false;
    const p = players[pid];
    if (!p) return true; // 未ロードは real 扱い（隠しすぎ防止）
    return !isDefPlayerId(pid);
  };

  // ranking_json が空でも、カードから def を除いて勝者を推定する（2人ブロック等）
  const inferWinnerFromCards = (blockMatches: MatchCard[]) => {
    const completed = blockMatches.filter(
      (m) =>
        m.winner_id &&
        m.loser_id &&
        m.winner_score != null &&
        m.loser_score != null &&
        isRealPlayerId(m.player_a_id) &&
        isRealPlayerId(m.player_b_id)
    );

    if (completed.length === 0) return null;

    // 総当たりにも対応（wins → diff → pf の順で一意なら採用）
    const stats = new Map<string, { wins: number; diff: number; pf: number }>();
    const touch = (pid: string) => {
      if (!stats.has(pid)) stats.set(pid, { wins: 0, diff: 0, pf: 0 });
      return stats.get(pid)!;
    };

    for (const m of completed) {
      const w = String(m.winner_id!);
      const l = String(m.loser_id!);
      if (!isRealPlayerId(w) || !isRealPlayerId(l)) continue;

      touch(w).wins += 1;

      const ws = Number(m.winner_score);
      const ls = Number(m.loser_score);
      if (Number.isFinite(ws) && Number.isFinite(ls)) {
        touch(w).diff += ws - ls;
        touch(l).diff += ls - ws;
        touch(w).pf += ws;
        touch(l).pf += ls;
      }
    }

    const list = Array.from(stats.entries()).map(([player_id, s]) => ({ player_id, ...s }));
    if (list.length === 0) return null;

    list.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.diff !== a.diff) return b.diff - a.diff;
      if (b.pf !== a.pf) return b.pf - a.pf;
      return String(a.player_id).localeCompare(String(b.player_id));
    });

    const top = list[0];
    const hasTie = list.some((r, idx) => idx > 0 && r.wins === top.wins && r.diff === top.diff && r.pf === top.pf);
    if (hasTie) return null;

    return top.player_id;
  };

  useEffect(() => {
    if (!tournamentId) return;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  // ✅ 管理者判定（app_admins or players.is_admin）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setAuthz('checking');
        setIsAdmin(false);

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          if (!cancelled) setAuthz('guest');
          return;
        }

        let admin = false;

        const r1 = await (supabase.from('app_admins') as any).select('user_id').eq('user_id', user.id).maybeSingle();
        admin = Boolean(r1?.data?.user_id);

        if (!admin) {
          // is_admin 列が無い環境もあるので、失敗しても無視
          const r2 = await (supabase.from('players') as any).select('is_admin').eq('id', user.id).maybeSingle();
          admin = r2?.data?.is_admin === true;
        }

        if (!cancelled) {
          setAuthz('user');
          setIsAdmin(Boolean(admin));
        }
      } catch {
        if (!cancelled) {
          setAuthz('guest');
          setIsAdmin(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  const loadAll = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: tRow, error: tErr } = await supabase
        .from('tournaments')
        .select('id,name,start_date,notes,description')
        .eq('id', tournamentId)
        .maybeSingle();

      if (tErr || !tRow) {
        console.error('[league/results] tournament fetch error:', tErr);
        setError('大会情報の取得に失敗しました');
        setLoading(false);
        return;
      }
      setTournament(tRow as Tournament);

      const { data: blockRows, error: bErr } = await supabase
        .from('league_blocks')
        .select('id,label,status,tournament_id,winner_player_id,ranking_json')
        .eq('tournament_id', tournamentId)
        .order('label', { ascending: true });

      if (bErr || !blockRows) {
        console.error('[league/results] blocks fetch error:', bErr);
        setError('リーグブロック情報の取得に失敗しました');
        setLoading(false);
        return;
      }

      const lbList: LeagueBlock[] = blockRows.map((row: any) => ({
        id: row.id,
        label: row.label,
        status: row.status,
        tournament_id: row.tournament_id,
        winner_player_id: row.winner_player_id,
        ranking_json: (row.ranking_json ?? []) as RankingRow[],
      }));
      setBlocks(lbList);

      const blockIds = lbList.map((lb) => lb.id);
      let cards: MatchCard[] = [];

      if (blockIds.length > 0) {
        const { data: matchesData, error: mErr } = await supabase
          .from('matches')
          .select(
            'id,league_block_id,player_a_id,player_b_id,winner_id,loser_id,winner_score,loser_score,match_date,end_reason,time_limit_seconds'
          )
          .eq('tournament_id', tournamentId)
          .in('league_block_id', blockIds)
          .order('match_date', { ascending: true });

        if (mErr) {
          console.error('[league/results] matches fetch error:', mErr);
        } else if (matchesData) {
          const raw = matchesData as any[];

          const pairKey = (a: string, b: string) => (a < b ? `${a}__${b}` : `${b}__${a}`);
          const latestByBlockPair = new Map<string, any>();

          for (const m of raw) {
            if (!m.league_block_id || !m.player_a_id || !m.player_b_id) continue;
            const key = m.league_block_id + '::' + pairKey(String(m.player_a_id), String(m.player_b_id));
            const prev = latestByBlockPair.get(key);
            if (!prev) latestByBlockPair.set(key, m);
            else {
              const prevDate = String(prev.match_date ?? '');
              const currDate = String(m.match_date ?? '');
              if (currDate > prevDate) latestByBlockPair.set(key, m);
            }
          }

          let idx = 1;
          for (const [key, m] of latestByBlockPair.entries()) {
            const [blockIdForCard] = key.split('::');
            cards.push({
              id: m.id ?? `card-${idx}`,
              league_block_id: blockIdForCard,
              player_a_id: String(m.player_a_id),
              player_b_id: String(m.player_b_id),
              winner_id: m.winner_id ?? null,
              loser_id: m.loser_id ?? null,
              winner_score: typeof m.winner_score === 'number' ? m.winner_score : m.winner_score ?? null,
              loser_score: typeof m.loser_score === 'number' ? m.loser_score : m.loser_score ?? null,
              end_reason: (m.end_reason ?? null) as string | null,
              time_limit_seconds:
                typeof m.time_limit_seconds === 'number' ? m.time_limit_seconds : m.time_limit_seconds ?? null,
            });
            idx += 1;
          }
        }
      }

      setMatchCards(cards);

      const idsFromRanking = lbList.flatMap((lb) => [
        ...(lb.ranking_json ?? []).map((r) => r.player_id),
        lb.winner_player_id ?? undefined,
      ]);

      const idsFromCards = cards.flatMap((c) => [
        c.player_a_id,
        c.player_b_id,
        c.winner_id ?? undefined,
        c.loser_id ?? undefined,
      ]);

      const allPlayerIds = Array.from(new Set([...idsFromRanking, ...idsFromCards].filter(Boolean))) as string[];

      if (allPlayerIds.length > 0) {
        const { data: pRows, error: pErr } = await supabase
          .from('players')
          .select('id,handle_name,avatar_url,ranking_points,handicap')
          .in('id', allPlayerIds);

        if (pErr) {
          console.error('[league/results] players fetch error:', pErr);
        } else if (pRows) {
          const dict: Record<string, Player> = {};
          pRows.forEach((p: any) => {
            dict[String(p.id)] = {
              id: String(p.id),
              handle_name: p.handle_name ?? null,
              avatar_url: p.avatar_url ?? null,
              ranking_points: p.ranking_points ?? null,
              handicap: p.handicap ?? null,
            };
          });
          setPlayers(dict);
        }
      }

      setLoading(false);
    } catch (e) {
      console.error('[league/results] fatal error:', e);
      setError('データの取得中にエラーが発生しました');
      setLoading(false);
    }
  };

  const saveWinnerToDb = async (blockId: string, winnerPlayerId: string | null) => {
    setSavingWinnerBlockId(blockId);
    setWinnerSaveErrorByBlock((prev) => ({ ...prev, [blockId]: '' }));

    try {
      // 1) まずはクライアントから update を試す（RLSで通る環境なら最小）
      {
        const { error: upErr } = await supabase
          .from('league_blocks')
          .update({ winner_player_id: winnerPlayerId } as any)
          .eq('id', blockId);

        if (!upErr) {
          await loadAll();
          return;
        }

        // 2) RLS 等で弾かれた場合は API へフォールバック（存在する場合）
        const { data: ses } = await supabase.auth.getSession();
        const token = ses.session?.access_token;

        if (token) {
          const res = await fetch('/api/league/blocks/set-winner', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ block_id: blockId, winner_player_id: winnerPlayerId }),
          });

          const j = await res.json().catch(() => null);
          if (res.ok && j?.ok !== false) {
            await loadAll();
            return;
          }
        }

        throw new Error(upErr.message || 'winner update failed');
      }
    } catch (e: any) {
      setWinnerSaveErrorByBlock((prev) => ({
        ...prev,
        [blockId]:
          e?.message ||
          '優勝者の確定に失敗しました（RLSの可能性。必要なら /api/league/blocks/set-winner を追加してください）',
      }));
    } finally {
      setSavingWinnerBlockId(null);
    }
  };

  if (!tournamentId) return <div className="p-4">大会IDが指定されていません。</div>;
  if (loading) return <div className="p-4">読み込み中...</div>;
  if (error) return <div className="p-4 text-red-400">{error}</div>;
  if (!tournament) return <div className="p-4">大会データが見つかりませんでした。</div>;

  return (
    <div className="min-h-screen px-4 py-6 text-white">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="rounded-2xl border border-purple-500/40 bg-purple-900/30 p-5">
          <div className="text-xs text-purple-200 mb-1">TOURNAMENT</div>
          <h1 className="text-2xl font-bold">{tournament.name ?? '大会名未設定'}</h1>

          <div className="mt-1 text-sm text-purple-100 space-y-1">
            {tournament.start_date && <div>開催日: {new Date(tournament.start_date).toLocaleDateString('ja-JP')}</div>}
            {(tournament.notes || (tournament as any).description) && (
              <div className="text-sm text-purple-50 whitespace-pre-wrap">
                {tournament.notes ?? (tournament as any).description}
              </div>
            )}
          </div>

          <div className="mt-3 text-xs flex items-center gap-4">
            <Link href={`/tournaments/${tournament.id}`} className="text-blue-300 underline">
              大会トップへ
            </Link>
            <Link href={`/tournaments/${tournamentId}/finals`} className="text-blue-300 underline">
              決勝トーナメントへ →
            </Link>
          </div>
        </div>

        {blocks.map((block) => {
          const ranking = (block.ranking_json ?? []) as RankingRow[];
          const blockMatches = matchCardsByBlock.get(block.id) ?? [];

          const n = ranking.length;
          const expectedMatches = n >= 2 ? (n * (n - 1)) / 2 : 0;

          const completedMatches = blockMatches.filter(
            (m) => m.winner_id && m.loser_id && m.winner_score != null && m.loser_score != null
          ).length;

          // ranking_json が空でも「カードが埋まっている」なら finished 扱いできるように（表示側の救済）
          const statusFinished = isFinishedStatus(block.status);
          const isComplete = expectedMatches > 0 ? completedMatches >= expectedMatches : statusFinished;

          const winnerIdFromRanking = resolveBlockWinner(block, ranking, isComplete);

          // ✅ ranking_json が空/未確定でも「実プレーヤー同士の勝敗」から推定
          const winnerIdFromCards =
            !winnerIdFromRanking && statusFinished ? inferWinnerFromCards(blockMatches) : null;

          const winnerId = winnerIdFromRanking ?? winnerIdFromCards;
          const winnerInferred = !winnerIdFromRanking && !!winnerIdFromCards && !block.winner_player_id;

          const winnerPlayer = winnerId ? players[winnerId] : undefined;

          // 表示対象は finished かつ def ではない winner のみ
          const showWinnerCard = statusFinished && !!winnerId && (winnerPlayer ? isRealPlayerId(winnerId) : true);

          let winnerBlockRank: number | null = null;
          if (winnerId && ranking.length > 0) {
            const idx = ranking.findIndex((r) => r.player_id === winnerId);
            if (idx >= 0) winnerBlockRank = computeDisplayRank(ranking, idx);
          }

          // 手動確定候補（ranking または match から拾う / def を除外）
          const candidateIds = Array.from(
            new Set<string>(
              [
                ...(ranking?.map((r) => String(r.player_id)) ?? []),
                ...blockMatches.flatMap((m) => [String(m.player_a_id), String(m.player_b_id)]),
              ].filter(Boolean)
            )
          ).filter((pid) => isRealPlayerId(pid));

          const picked = winnerPickByBlock[block.id] ?? (winnerId && isRealPlayerId(winnerId) ? winnerId : candidateIds[0] ?? '');

          return (
            <section key={block.id} className="space-y-4">
              <h2 className="text-xl font-bold">ブロック {block.label ?? '?'} リーグ結果</h2>

              

              {showWinnerCard && (
                <div className="rounded-2xl border border-blue-500/40 bg-blue-900/40 p-4 flex items-center gap-4">
                  <div className="text-3xl text-yellow-300">
                    <FaTrophy />
                  </div>

                  <div className="flex items-center gap-4 min-w-0">
                    {winnerPlayer?.avatar_url && !blockWinnerImgError[block.id] ? (
                      <div className="relative w-14 h-14 rounded-full overflow-hidden border border-yellow-300/60">
                        <Image
                          loader={passthroughLoader}
                          unoptimized
                          src={winnerPlayer.avatar_url}
                          alt={winnerPlayer.handle_name ?? ''}
                          fill
                          sizes="56px"
                          className="object-cover"
                          onError={() => setBlockWinnerImgError((prev) => ({ ...prev, [block.id]: true }))}
                        />
                      </div>
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-white/10 border border-yellow-300/40" />
                    )}

                    <div className="min-w-0">
                      <div className="text-sm text-blue-100">
                        ブロック {block.label ?? ''} 優勝
                        {winnerInferred ? (
                          <span className="ml-2 text-[11px] text-blue-100/70">（自動推定・未確定）</span>
                        ) : null}
                      </div>
                      <div className="text-2xl font-bold truncate">{winnerPlayer?.handle_name ?? '優勝者'}</div>
                      <div className="text-xs text-blue-100 mt-1">
                        RP: {winnerPlayer?.ranking_points ?? 0} / HC: {winnerPlayer?.handicap ?? 0}（
                        {winnerBlockRank ? `ブロック内 ${winnerBlockRank}位` : '順位不明'}）
                      </div>

                      {/* ✅ 管理者だけ：未確定ならDBへ反映ボタン */}
                      {isAdmin && statusFinished && !block.winner_player_id && winnerId && isRealPlayerId(winnerId) ? (
                        <div className="mt-2 flex items-center gap-3">
                          <button
                            type="button"
                            disabled={savingWinnerBlockId === block.id}
                            onClick={() => saveWinnerToDb(block.id, winnerId)}
                            className="px-3 py-1 rounded bg-purple-600 text-white text-xs disabled:opacity-50"
                          >
                            {savingWinnerBlockId === block.id ? '確定中...' : 'この優勝者を確定（DB反映）'}
                          </button>
                          {winnerSaveErrorByBlock[block.id] ? (
                            <div className="text-[11px] text-rose-200">{winnerSaveErrorByBlock[block.id]}</div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}

              {/* ✅ winner が出せない場合：管理者だけ手動確定 */}
              {statusFinished && !winnerId && (
                <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
                  <div className="text-sm font-semibold">優勝者が未確定です</div>

                  {isAdmin ? (
                    <div className="mt-3 flex flex-col md:flex-row md:items-center gap-2">
                      <select
                        value={picked}
                        onChange={(e) =>
                          setWinnerPickByBlock((prev) => ({
                            ...prev,
                            [block.id]: e.target.value,
                          }))
                        }
                        className="px-3 py-2 rounded border border-white/20 bg-black/30 text-sm"
                      >
                        <option value="">（選択してください）</option>
                        {candidateIds.map((pid) => (
                          <option key={pid} value={pid}>
                            {players[pid]?.handle_name ?? 'プレーヤー'}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        disabled={!picked || savingWinnerBlockId === block.id}
                        onClick={() => saveWinnerToDb(block.id, picked || null)}
                        className="px-4 py-2 rounded bg-purple-600 text-white text-sm disabled:opacity-50"
                      >
                        {savingWinnerBlockId === block.id ? '確定中...' : '優勝者を確定'}
                      </button>

                      {winnerSaveErrorByBlock[block.id] ? (
                        <div className="text-[11px] text-rose-200">{winnerSaveErrorByBlock[block.id]}</div>
                      ) : null}

                      <div className="text-[11px] text-gray-300">
                        ※ def は候補から除外しています。確定すると以後の決勝作成でも正しく反映されます。
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-gray-300">
                      ※ 管理者が優勝者を確定するとここに表示されます。
                    </div>
                  )}
                </div>
              )}

              {ranking.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm border border-white/20 border-collapse">
                    <thead className="bg-blue-900/70">
                      <tr>
                        <th className="border border-white/20 px-2 py-1">順位</th>
                        <th className="border border-white/20 px-2 py-1">プレーヤー</th>
                        <th className="border border-white/20 px-2 py-1">RP</th>
                        <th className="border border-white/20 px-2 py-1">HC</th>
                        <th className="border border-white/20 px-2 py-1">勝</th>
                        <th className="border border-white/20 px-2 py-1">負</th>
                        <th className="border border-white/20 px-2 py-1">得点</th>
                        <th className="border border-white/20 px-2 py-1">失点</th>
                        <th className="border border-white/20 px-2 py-1">得失点差</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.map((row, idx) => {
                        const p = players[row.player_id];
                        const dispRank = computeDisplayRank(ranking, idx);
                        return (
                          <tr key={row.player_id} className="bg-black/40">
                            <td className="border border-white/10 px-2 py-1 text-center">{dispRank}</td>
                            <td className="border border-white/10 px-2 py-1">{p?.handle_name ?? '不明なプレーヤー'}</td>
                            <td className="border border-white/10 px-2 py-1 text-right">{p?.ranking_points ?? 0}</td>
                            <td className="border border-white/10 px-2 py-1 text-right">{p?.handicap ?? 0}</td>
                            <td className="border border-white/10 px-2 py-1 text-right">{row.wins}</td>
                            <td className="border border-white/10 px-2 py-1 text-right">{row.losses}</td>
                            <td className="border border-white/10 px-2 py-1 text-right">{row.points_for}</td>
                            <td className="border border-white/10 px-2 py-1 text-right">{row.points_against}</td>
                            <td className="border border-white/10 px-2 py-1 text-right">{formatSigned(calcPointDiff(row))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-4">
                <h3 className="text-lg font-semibold mb-2">対戦カード / 結果</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm border border-white/20 border-collapse">
                    <thead className="bg-blue-900/70">
                      <tr>
                        <th className="border border-white/20 px-2 py-1">試合</th>
                        <th className="border border-white/20 px-2 py-1">対戦</th>
                        <th className="border border-white/20 px-2 py-1">スコア</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blockMatches.map((m, idx) => {
                        const a = players[m.player_a_id];
                        const b = players[m.player_b_id];
                        const hasScore = m.winner_score != null && m.loser_score != null;

                        let scoreText = '-';
                        if (hasScore && m.winner_id && m.loser_id) {
                          const winnerName =
                            m.winner_id === a?.id ? a?.handle_name : m.winner_id === b?.id ? b?.handle_name : '不明';
                          const loserName =
                            m.loser_id === a?.id ? a?.handle_name : m.loser_id === b?.id ? b?.handle_name : '不明';
                          scoreText = `${winnerName ?? '不明'} ${m.winner_score} - ${m.loser_score} ${
                            loserName ?? '不明'
                          }`;
                        }

                        return (
                          <tr key={m.id} className="bg-black/40">
                            <td className="border border-white/10 px-2 py-1 text-center">{idx + 1}</td>
                            <td className="border border-white/10 px-2 py-1">
                              {a?.handle_name ?? 'プレーヤーA'} vs {b?.handle_name ?? 'プレーヤーB'}
                            </td>
                            <td className="border border-white/10 px-2 py-1">
                              <span>{scoreText}</span>
                              <EndReasonBadge end_reason={m.end_reason} time_limit_seconds={m.time_limit_seconds} />
                            </td>
                          </tr>
                        );
                      })}
                      {blockMatches.length === 0 && (
                        <tr>
                          <td colSpan={3} className="border border-white/10 px-2 py-3 text-center text-gray-300">
                            試合カードがまだ登録されていません。
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 text-xs text-gray-300">※ スコア未入力の試合は「-」と表示されます。</div>
              </div>
            </section>
          );
        })}

        <div className="mt-6 text-right text-xs">
          <Link href={`/tournaments/${tournament.id}`} className="text-blue-300 underline">
            大会トップに戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
