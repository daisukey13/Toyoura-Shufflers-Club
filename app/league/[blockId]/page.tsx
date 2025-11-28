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
  start_date: string | null;
  notes: string | null;
  ranking_multiplier: number | null;
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
  global_rank?: number | null;
};

type MatchCard = {
  id: string;
  player_a_id: string;
  player_b_id: string;
  winner_id: string | null;
  loser_id: string | null;
  winner_score: number | null;
  loser_score: number | null;
  match_date?: string | null;
};

/* ========= Page ========= */

export default function LeagueBlockPublicPage() {
  const params = useParams();
  const blockId =
    typeof params?.blockId === 'string' ? (params.blockId as string) : '';

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [block, setBlock] = useState<LeagueBlock | null>(null);
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [matchCards, setMatchCards] = useState<MatchCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!blockId) return;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId]);

  const loadAll = async () => {
    setLoading(true);
    setError(null);

    try {
      /* ---- 1) league_blocks ---- */
      const { data: blockRow, error: blockErr } = await supabase
        .from('league_blocks')
        .select('id,label,status,tournament_id,winner_player_id,ranking_json')
        .eq('id', blockId)
        .maybeSingle();

      if (blockErr || !blockRow) {
        console.error('[league/block] block fetch error:', blockErr);
        setError('リーグブロック情報の取得に失敗しました');
        setLoading(false);
        return;
      }

      const lb: LeagueBlock = {
        id: blockRow.id,
        label: blockRow.label,
        status: blockRow.status,
        tournament_id: blockRow.tournament_id,
        winner_player_id: blockRow.winner_player_id,
        ranking_json: (blockRow.ranking_json ?? null) as RankingRow[] | null,
      };
      setBlock(lb);

      /* ---- 2) matches: league_block_id で“試合カード”を取得（未入力でも出す）---- */
      const { data: matchesData, error: matchesErr } = await supabase
        .from('matches')
        .select(
          'id,player_a_id,player_b_id,winner_id,loser_id,winner_score,loser_score,match_date'
        )
        .eq('league_block_id', blockId)
        .order('match_date', { ascending: true });

      if (matchesErr) {
        console.error('[league/block] matches fetch error:', matchesErr);
      }

      const rawMatches = (matchesData ?? []) as any[];

      // 対戦カード（DBの試合をそのまま表示）
      const cards: MatchCard[] = rawMatches
        .filter((m) => m.player_a_id && m.player_b_id)
        .map((m) => ({
          id: String(m.id),
          player_a_id: String(m.player_a_id),
          player_b_id: String(m.player_b_id),
          winner_id: m.winner_id ? String(m.winner_id) : null,
          loser_id: m.loser_id ? String(m.loser_id) : null,
          winner_score:
            typeof m.winner_score === 'number' ? m.winner_score : null,
          loser_score: typeof m.loser_score === 'number' ? m.loser_score : null,
          match_date: m.match_date ?? null,
        }));

      setMatchCards(cards);

      // ブロック参加者ID（ranking_json が空でも、matches から復元できる）
      const playerIds = Array.from(
        new Set(
          cards
            .flatMap((c) => [c.player_a_id, c.player_b_id])
            .filter(Boolean)
        )
      );

      /* ---- 3) tournaments ---- */
      let tour: Tournament | null = null;
      if (lb.tournament_id) {
        const { data: tRow, error: tErr } = await supabase
          .from('tournaments')
          .select('id,name,start_date,notes,ranking_multiplier')
          .eq('id', lb.tournament_id)
          .maybeSingle();

        if (tErr) {
          if ((tErr as any).code === '42703') {
            console.warn(
              '[league/block] tournaments.ranking_multiplier missing. Fallback select without it.'
            );
            const { data: tRow2, error: tErr2 } = await supabase
              .from('tournaments')
              .select('id,name,start_date,notes')
              .eq('id', lb.tournament_id)
              .maybeSingle();

            if (tErr2) {
              console.error(
                '[league/block] tournament fetch error (fallback):',
                tErr2
              );
            } else if (tRow2) {
              tour = {
                id: tRow2.id,
                name: tRow2.name,
                start_date: tRow2.start_date,
                notes: tRow2.notes,
                ranking_multiplier: null,
              };
            }
          } else {
            console.error('[league/block] tournament fetch error:', tErr);
          }
        } else if (tRow) {
          tour = tRow as Tournament;
        }
      }

      setTournament(
        tour ?? {
          id: '',
          name: '大会名未設定',
          start_date: null,
          notes: null,
          ranking_multiplier: null,
        }
      );

      /* ---- 4) players / player_rankings ---- */
      const playersDict: Record<string, Player> = {};

      if (playerIds.length > 0) {
        const { data: pRows, error: pErr } = await supabase
          .from('players')
          .select('id,handle_name,avatar_url,ranking_points,handicap')
          .in('id', playerIds);

        if (pErr) console.error('[league/block] players fetch error:', pErr);

        const { data: rankRows, error: rErr } = await supabase
          .from('player_rankings')
          .select('player_id,global_rank')
          .in('player_id', playerIds);

        if (rErr) {
          console.warn('[league/block] player_rankings fetch warning:', rErr);
        }

        const rankMap: Record<string, number | null> = {};
        (rankRows ?? []).forEach((r: any) => {
          const pid = String(r.player_id);
          rankMap[pid] =
            typeof r.global_rank === 'number' ? r.global_rank : null;
        });

        (pRows ?? []).forEach((p: any) => {
          const id = String(p.id);
          playersDict[id] = {
            id,
            handle_name: p.handle_name,
            avatar_url: p.avatar_url,
            ranking_points: p.ranking_points,
            handicap: p.handicap,
            global_rank: typeof rankMap[id] === 'number' ? rankMap[id] : null,
          };
        });
      }

      setPlayers(playersDict);

      /* ---- 5) ranking ----
         集計前で ranking_json が空でも、選手一覧が出るように 0初期値を生成 */
      const rankingJson = Array.isArray(lb.ranking_json) ? lb.ranking_json : [];
      if (rankingJson.length > 0) {
        setRanking(rankingJson as RankingRow[]);
      } else {
        setRanking(
          playerIds.map((pid) => ({
            player_id: pid,
            wins: 0,
            losses: 0,
            points_for: 0,
            points_against: 0,
            point_diff: 0,
          }))
        );
      }

      setLoading(false);
    } catch (e) {
      console.error('[league/block] fatal error:', e);
      setError('データの取得中にエラーが発生しました');
      setLoading(false);
    }
  };

  /* ========= Rendering ========= */

  if (!blockId) {
    return <div className="p-4">ブロックIDが指定されていません。</div>;
  }
  if (loading) {
    return <div className="p-4">読み込み中...</div>;
  }
  if (error) {
    return <div className="p-4 text-red-400">{error}</div>;
  }
  if (!block || !tournament) {
    return <div className="p-4">データが見つかりませんでした。</div>;
  }

  // ★ 1試合でもスコアが入っているかどうか
  const hasAnyResult = matchCards.some(
    (m) =>
      m.winner_id &&
      m.loser_id &&
      m.winner_score != null &&
      m.loser_score != null
  );

  const winnerPlayer =
    block.winner_player_id && players[block.winner_player_id]
      ? players[block.winner_player_id]
      : null;

  // ★ 結果が1つも無い場合は、finished でも優勝カードを出さない
  const showWinnerCard =
    block.status === 'finished' && !!winnerPlayer && hasAnyResult;

  const calcPointDiff = (row: RankingRow) =>
    typeof row.point_diff === 'number'
      ? row.point_diff
      : (row.points_for ?? 0) - (row.points_against ?? 0);

  const isFullTieWithZeroDiff =
    ranking.length >= 2 &&
    ranking.every(
      (r) =>
        r.wins === ranking[0].wins &&
        r.losses === ranking[0].losses &&
        calcPointDiff(r) === calcPointDiff(ranking[0]) &&
        calcPointDiff(r) === 0
    );

  const winnerIndex = winnerPlayer
    ? ranking.findIndex((r) => r.player_id === winnerPlayer.id)
    : -1;
  const winnerLocalRank =
    winnerIndex >= 0
      ? isFullTieWithZeroDiff
        ? 1
        : winnerIndex + 1
      : null;

  return (
    <div className="min-h-screen px-4 py-6 text-white">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Tournament header */}
        <div className="rounded-2xl border border-purple-500/40 bg-purple-900/30 p-5">
          <div className="text-xs text-purple-200 mb-1">TOURNAMENT</div>
          <h1 className="text-2xl font-bold">
            {tournament.name ?? '大会名未設定'}
          </h1>
          <div className="mt-1 text-sm text-purple-100 space-y-1">
            {tournament.start_date && (
              <div>
                開催日:{' '}
                {new Date(tournament.start_date).toLocaleDateString('ja-JP')}
              </div>
            )}
            {tournament.notes && <div>{tournament.notes}</div>}
            {tournament.ranking_multiplier && (
              <div className="text-xs text-amber-300">
                ランキング係数: ×{tournament.ranking_multiplier}
              </div>
            )}
          </div>
        </div>

        {/* Block title */}
        <h2 className="text-xl font-bold">
          ブロック {block.label ?? '?'} リーグ結果
        </h2>

        {/* 優勝者カード（finished かつ結果ありのときだけ） */}
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
                <div className="text-sm text-blue-100">
                  ブロック {block.label ?? ''} 優勝
                </div>
                <div className="text-2xl font-bold">
                  {winnerPlayer.handle_name ?? '優勝者'}
                </div>
                <div className="text-xs text-blue-100 mt-1">
                  RP: {winnerPlayer.ranking_points ?? 0} / HC:{' '}
                  {winnerPlayer.handicap ?? 0}（
                  {winnerPlayer.global_rank
                    ? `全体 ${winnerPlayer.global_rank}位`
                    : winnerLocalRank
                      ? `ブロック内 ${winnerLocalRank}位`
                      : '順位不明'}
                  ）
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
                  const pointDiff = calcPointDiff(row);
                  const displayRank = isFullTieWithZeroDiff ? 1 : idx + 1;

                  return (
                    <tr key={row.player_id} className="bg-black/40">
                      <td className="border border-white/10 px-2 py-1 text-center">
                        {displayRank}
                      </td>
                      <td className="border border-white/10 px-2 py-1">
                        {p?.handle_name ?? '不明なプレーヤー'}
                      </td>
                      <td className="border border白/10 px-2 py-1 text-right">
                        {p?.ranking_points ?? 0}
                      </td>
                      <td className="border border-white/10 px-2 py-1 text-right">
                        {p?.handicap ?? 0}
                      </td>
                      <td className="border border-white/10 px-2 py-1 text-right">
                        {row.wins}
                      </td>
                      <td className="border border-white/10 px-2 py-1 text-right">
                        {row.losses}
                      </td>
                      <td className="border border-white/10 px-2 py-1 text-right">
                        {row.points_for}
                      </td>
                      <td className="border border-white/10 px-2 py-1 text-right">
                        {row.points_against}
                      </td>
                      <td className="border border-white/10 px-2 py-1 text-right">
                        {pointDiff}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 対戦カード / 結果 */}
        <div className="mt-6">
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
                {matchCards.map((m, idx) => {
                  const a = players[m.player_a_id];
                  const b = players[m.player_b_id];
                  const hasScore =
                    m.winner_score != null && m.loser_score != null;

                  let scoreText = '-';
                  if (hasScore && m.winner_id && m.loser_id) {
                    const winnerName =
                      m.winner_id === a?.id
                        ? a?.handle_name
                        : m.winner_id === b?.id
                          ? b?.handle_name
                          : '不明';
                    const loserName =
                      m.loser_id === a?.id
                        ? a?.handle_name
                        : m.loser_id === b?.id
                          ? b?.handle_name
                          : '不明';
                    scoreText = `${winnerName ?? '不明'} ${m.winner_score} - ${m.loser_score} ${loserName ?? '不明'}`;
                  }

                  return (
                    <tr key={m.id} className="bg-black/40">
                      <td className="border border-white/10 px-2 py-1 text-center">
                        {idx + 1}
                      </td>
                      <td className="border border-white/10 px-2 py-1">
                        {a?.handle_name ?? 'プレーヤーA'} vs{' '}
                        {b?.handle_name ?? 'プレーヤーB'}
                      </td>
                      <td className="border border-white/10 px-2 py-1">
                        {scoreText}
                      </td>
                    </tr>
                  );
                })}
                {matchCards.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="border border-white/10 px-2 py-3 text-center text-gray-300"
                    >
                      試合カードがまだ登録されていません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-xs text-gray-300">
            ※ スコア未入力の試合は「-」と表示されます。
          </div>
        </div>

        {/* 戻るリンク */}
        <div className="mt-6 text-right text-xs">
          {tournament.id && (
            <Link
              href={`/tournaments/${tournament.id}/league`}
              className="text-blue-300 underline"
            >
              大会のリーグ一覧に戻る
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
