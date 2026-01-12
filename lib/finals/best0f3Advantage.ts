// lib/finals/bestOf3Advantage.ts
export type FinalGame = {
  // 勝者（未入力なら null）
  winner_id: string | null;

  // 'def' の場合はスコアは null でもOK（表示は "DEF勝ち" にする）
  win_type?: 'normal' | 'def';
  p1_score?: number | null;
  p2_score?: number | null;
};

export type AdvantageInfo =
  | { enabled: false }
  | {
      enabled: true;
      normalPlayerId: string;
      defPlayerId: string;
    };

function ensure3(games: any): FinalGame[] {
  const base: FinalGame[] = Array.isArray(games) ? games : [];
  const out: FinalGame[] = base
    .slice(0, 3)
    .map((g) => ({
      winner_id: g?.winner_id ?? null,
      win_type: g?.win_type === 'def' ? 'def' : 'normal',
      p1_score: g?.p1_score ?? null,
      p2_score: g?.p2_score ?? null,
    }));
  while (out.length < 3) out.push({ winner_id: null, win_type: 'normal', p1_score: null, p2_score: null });
  return out;
}

export function getAdvantageInfo(
  p1Id: string,
  p2Id: string,
  p1QualifiedByDef: boolean,
  p2QualifiedByDef: boolean
): AdvantageInfo {
  // 片方だけ def なら、もう片方（通常勝ち上がり）が 1勝アドバンテージ
  if (p1QualifiedByDef === p2QualifiedByDef) return { enabled: false };
  const defPlayerId = p1QualifiedByDef ? p1Id : p2Id;
  const normalPlayerId = p1QualifiedByDef ? p2Id : p1Id;
  return { enabled: true, normalPlayerId, defPlayerId };
}

/**
 * games を 3本に整形し、アドバンテージ対象なら「1試合目」を自動 def 勝ちで埋める。
 * （ただし、既に1試合目が入力済みなら上書きしない）
 */
export function normalizeGamesWithAdvantage(opts: {
  player1Id: string;
  player2Id: string;
  p1QualifiedByDef: boolean;
  p2QualifiedByDef: boolean;
  games: any;
}) {
  const games3 = ensure3(opts.games);
  const adv = getAdvantageInfo(opts.player1Id, opts.player2Id, opts.p1QualifiedByDef, opts.p2QualifiedByDef);

  if (adv.enabled) {
    const g1 = games3[0];
    const g1Empty = !g1?.winner_id; // 未入力なら
    if (g1Empty) {
      games3[0] = {
        winner_id: adv.normalPlayerId, // ✅ 通常勝ち上がり側が初戦 def 勝ち
        win_type: 'def',
        p1_score: null,
        p2_score: null,
      };
    }
  }

  return { games: games3, advantage: adv };
}

/**
 * 表示用のシリーズ勝敗（2-0/2-1など）を計算する。
 * ※勝者は手動なので、これは「表示/推奨」のため。
 */
export function computeSeriesScore(opts: {
  player1Id: string;
  player2Id: string;
  games: FinalGame[];
}) {
  const g = ensure3(opts.games);

  const wins = new Map<string, number>();
  wins.set(opts.player1Id, 0);
  wins.set(opts.player2Id, 0);

  for (const game of g) {
    if (!game.winner_id) continue;
    if (!wins.has(game.winner_id)) continue;
    wins.set(game.winner_id, (wins.get(game.winner_id) ?? 0) + 1);
  }

  const p1w = wins.get(opts.player1Id) ?? 0;
  const p2w = wins.get(opts.player2Id) ?? 0;

  // 推奨勝者（確定条件を満たすなら）
  let recommendedWinnerId: string | null = null;
  if (p1w >= 2 && p1w !== p2w) recommendedWinnerId = opts.player1Id;
  if (p2w >= 2 && p1w !== p2w) recommendedWinnerId = opts.player2Id;

  return {
    p1Wins: p1w,
    p2Wins: p2w,
    scoreText: `${p1w}-${p2w}`,
    recommendedWinnerId, // null の場合は未確定
    games: g, // 常に3本
  };
}
