// lib/stats.ts
export function calcWinRate(
  wins?: number | null,
  losses?: number | null,
): number {
  const w = wins ?? 0;
  const l = losses ?? 0;
  const total = w + l;
  if (total <= 0) return 0;
  // 0.1% 単位で丸め
  return Math.round((w / total) * 1000) / 10;
}
export function formatWinRate(wins?: number, losses?: number): string {
  const total = (wins ?? 0) + (losses ?? 0);
  if (total === 0) return "—";
  return `${calcWinRate(wins, losses).toFixed(1)}%`;
}
