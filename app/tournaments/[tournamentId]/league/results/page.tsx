// app/tournaments/[tournamentId]/league/results/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { FaTrophy } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

/* ========= Types ========= */

type Tournament = {
  id: string;
  name: string | null;
  start_date: string | null; // ← 既存
  notes: string | null;      // ← 既存（残す）
  description: string | null; // ★ 追加：管理画面で編集した説明
};

type RankingRow = {
  player_id: string;
  wins: number;
  losses: number;
  points_for: number;
  points_against: number;
  point_diff?: number | null;
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
};

/* ========= Helpers ========= */

function resolveBlockWinner(block: LeagueBlock, ranking: RankingRow[]): string | null {
  if (block.winner_player_id) return block.winner_player_id;
  if (!ranking.length) return null;

  const sorted = [...ranking].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.point_diff !== a.point_diff) return b.point_diff - a.point_diff;
    return b.points_for - a.points_for;
  });

  const top = sorted[0];
  const hasTie = sorted.some(
    (row, idx) => idx > 0 && row.wins === top.wins && row.point_diff === top.point_diff,
  );
  if (hasTie) return null;
  return top.player_id;
}

function computeDisplayRank(ranking: RankingRow[], idx: number): number {
  if (ranking.length === 0) return idx + 1;

  const base = ranking[0];
  const isAllSame =
    ranking.length > 1 &&
    ranking.every(
      (r) =>
        r.wins === base.wins &&
        r.losses === base.losses &&
        r.point_diff === base.point_diff &&
        r.point_diff === 0,
    );

  if (isAllSame) return 1;
  return idx + 1;
}

/* ========= Page ========= */

export default function TournamentLeagueResultsPage() {
  const params = useParams();
  const tournamentId = typeof params?.tournamentId === 'string' ? (params.tournamentId as string) : '';

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [blocks, setBlocks] = useState<LeagueBlock[]>([]);
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [matchCards, setMatchCards] = useState<MatchCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tournamentId) return;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  const loadAll = async () => {
    setLoading(true);
    setError(null);

    try {
      /* ---- 1) 大会情報 ---- */
      const { data: tRow, error: tErr } = await supabase
        .from('tournaments')
        // ★ description を追加（notes も残す）
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

      /* ---- 2) この大会のリーグブロック一覧 ---- */
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

      /* ---- 3) 全ブロックで使われているプレーヤーを一括取得 ---- */
      const allPlayerIds = Array.from(
        new Set(
          lbList.flatMap((lb) => [
            ...(lb.ranking_json ?? []).map((r) => r.player_id),
            lb.winner_player_id ?? undefined,
          ]),
        ),
      ).filter(Boolean) as string[];

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
            dict[p.id] = {
              id: p.id,
              handle_name: p.handle_name,
              avatar_url: p.avatar_url,
              ranking_points: p.ranking_points,
              handicap: p.handicap,
            };
          });
          setPlayers(dict);
        }
      }

      /* ---- 4) 全ブロックの試合を取得 ---- */
      const blockIds = lbList.map((lb) => lb.id);
      let cards: MatchCard[] = [];

      if (blockIds.length > 0) {
        const { data: matchesData, error: mErr } = await supabase
          .from('matches')
          .select('id,league_block_id,winner_id,loser_id,winner_score,loser_score,match_date')
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
            if (!m.winner_id || !m.loser_id || !m.league_block_id) continue;
            const key = m.league_block_id + '::' + pairKey(m.winner_id, m.loser_id);
            const prev = latestByBlockPair.get(key);
            if (!prev) latestByBlockPair.set(key, m);
            else {
              const prevDate = prev.match_date ?? '';
              const currDate = m.match_date ?? '';
              if (currDate > prevDate) latestByBlockPair.set(key, m);
            }
          }

          let idx = 1;
          for (const [key, m] of latestByBlockPair.entries()) {
            const [blockIdForCard] = key.split('::');
            cards.push({
              id: m.id ?? `card-${idx}`,
              league_block_id: blockIdForCard,
              player_a_id: m.winner_id as string,
              player_b_id: m.loser_id as string,
              winner_id: m.winner_id ?? null,
              loser_id: m.loser_id ?? null,
              winner_score: typeof m.winner_score === 'number' ? m.winner_score : m.winner_score ?? null,
              loser_score: typeof m.loser_score === 'number' ? m.loser_score : m.loser_score ?? null,
            });
            idx += 1;
          }
        }
      }

      setMatchCards(cards);
      setLoading(false);
    } catch (e) {
      console.error('[league/results] fatal error:', e);
      setError('データの取得中にエラーが発生しました');
      setLoading(false);
    }
  };

  if (!tournamentId) return <div className="p-4">大会IDが指定されていません。</div>;
  if (loading) return <div className="p-4">読み込み中...</div>;
  if (error) return <div className="p-4 text-red-400">{error}</div>;
  if (!tournament) return <div className="p-4">大会データが見つかりませんでした。</div>;

  // ★ 表示する説明（description 優先、なければ notes）
  const descText = (tournament.description || tournament.notes || '').trim();

  return (
    <div className="min-h-screen px-4 py-6 text-white">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Tournament header */}
        <div className="rounded-2xl border border-purple-500/40 bg-purple-900/30 p-5">
          <div className="text-xs text-purple-200 mb-1">TOURNAMENT</div>
          <h1 className="text-2xl font-bold">{tournament.name ?? '大会名未設定'}</h1>
          <div className="mt-1 text-sm text-purple-100 space-y-2">
            {tournament.start_date && (
              <div>
                開催日:{' '}
                {new Date(tournament.start_date).toLocaleDateString('ja-JP')}
              </div>
            )}

            {/* ★ 追加：大会説明 */}
            {descText && (
              <div className="text-sm text-purple-50/90 whitespace-pre-line">
                {descText}
              </div>
            )}
          </div>
        </div>

        {/* 以下、既存のブロック表示はそのまま */}
        {blocks.map((block) => {
          const ranking = (block.ranking_json ?? []) as RankingRow[];
          const winnerId = resolveBlockWinner(block, ranking);
          const winnerPlayer = winnerId ? players[winnerId] : undefined;
          const showWinnerCard = !!winnerPlayer && block.status === 'finished';

          let winnerBlockRank: number | null = null;
          if (winnerId && ranking.length > 0) {
            const idx = ranking.findIndex((r) => r.player_id === winnerId);
            if (idx >= 0) winnerBlockRank = computeDisplayRank(ranking, idx);
          }

          const blockMatches = matchCards.filter((m) => m.league_block_id === block.id);

          return (
            <section key={block.id} className="space-y-4">
              <h2 className="text-xl font-bold">ブロック {block.label ?? '?'} リーグ結果</h2>

              {showWinnerCard && winnerPlayer && (
                <div className="rounded-2xl border border-blue-500/40 bg-blue-900/40 p-4 flex items-center gap-4">
                  <div className="text-3xl text-yellow-300">
                    <FaTrophy />
                  </div>
                  <div className="flex items-center gap-4">
                    {winnerPlayer.avatar_url && (
                      <img
                        src={winnerPlayer.avatar_url}
                        alt={winnerPlayer.handle_name ?? ''}
                        className="w-14 h-14 rounded-full object-cover border border-yellow-300/60"
                      />
                    )}
                    <div>
                      <div className="text-sm text-blue-100">ブロック {block.label ?? ''} 優勝</div>
                      <div className="text-2xl font-bold">{winnerPlayer.handle_name ?? '優勝者'}</div>
                      <div className="text-xs text-blue-100 mt-1">
                        RP: {winnerPlayer.ranking_points ?? 0} / HC: {winnerPlayer.handicap ?? 0}（
                        {winnerBlockRank ? `ブロック内 ${winnerBlockRank}位` : '順位不明'}）
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ランキングテーブル */}
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

  const pf = typeof row.points_for === 'number' ? row.points_for : Number(row.points_for ?? 0);
  const pa = typeof row.points_against === 'number' ? row.points_against : Number(row.points_against ?? 0);
  const diff =
    typeof row.point_diff === 'number'
      ? row.point_diff
      : pf - pa; // ★ 無ければ計算

  return (
    <tr key={row.player_id} className="bg-black/40">
      <td className="border border-white/10 px-2 py-1 text-center">{dispRank}</td>
      <td className="border border-white/10 px-2 py-1">{p?.handle_name ?? '不明なプレーヤー'}</td>
      <td className="border border-white/10 px-2 py-1 text-right">{p?.ranking_points ?? 0}</td>
      <td className="border border-white/10 px-2 py-1 text-right">{p?.handicap ?? 0}</td>
      <td className="border border-white/10 px-2 py-1 text-right">{row.wins}</td>
      <td className="border border-white/10 px-2 py-1 text-right">{row.losses}</td>
      <td className="border border-white/10 px-2 py-1 text-right">{pf}</td>
      <td className="border border-white/10 px-2 py-1 text-right">{pa}</td>
      <td className="border border-white/10 px-2 py-1 text-right">{diff}</td>
    </tr>
  );
})}

                    </tbody>
                  </table>
                </div>
              )}

              {/* 対戦カード / 結果（既存のまま） */}
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
                          scoreText = `${winnerName ?? '不明'} ${m.winner_score} - ${m.loser_score} ${loserName ?? '不明'}`;
                        }

                        return (
                          <tr key={m.id} className="bg-black/40">
                            <td className="border border-white/10 px-2 py-1 text-center">{idx + 1}</td>
                            <td className="border border-white/10 px-2 py-1">
                              {a?.handle_name ?? 'プレーヤーA'} vs {b?.handle_name ?? 'プレーヤーB'}
                            </td>
                            <td className="border border-white/10 px-2 py-1">{scoreText}</td>
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
          <Link href={`/tournaments/${tournament.id}/league`} className="text-blue-300 underline">
            大会のリーグ一覧に戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
