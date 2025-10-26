// lib/hooks/useTeamRankings.ts
"use client";

import { useMemo } from "react";
import { useFetchSupabaseData } from "@/lib/hooks/useFetchSupabaseData";

export type TeamRankItem = {
  id: string;
  name: string;
  team_size?: number | null;
  avg_rp?: number | null;
  avg_hc?: number | null;
  played?: number | null;
  wins?: number | null;
  losses?: number | null;
  win_pct?: number | null;
  last_match_at?: string | null;
};

type Options = {
  enabled?: boolean; // 呼び出し側互換のため残す（内部では使わない）
  requireAuth?: boolean; // 同上
  order?: "avg_rp" | "win_pct" | "last_match_at";
  direction?: "asc" | "desc";
  limit?: number;
};

/**
 * チームランキング（team_rankings VIEW）
 * - 既存UI/連携は維持
 * - 最小修正: useFetchSupabaseData に存在しないプロパティを渡さない
 */
export function useTeamRankings(opts?: Options) {
  const orderCol = opts?.order ?? "avg_rp";
  const ascending = (opts?.direction ?? "desc") === "asc";

  const { data, loading, error, retrying, refetch } = useFetchSupabaseData({
    tableName: "team_rankings",
    select:
      "id,name,team_size,avg_rp,avg_hc,played,wins,losses,win_pct,last_match_at",
    orderBy: { column: orderCol, ascending },
    limit: opts?.limit,
    // enabled / requireAuth は useFetchSupabaseData の型に無いので渡さない
  });

  const teams: TeamRankItem[] = useMemo(
    () => (Array.isArray(data) ? (data as TeamRankItem[]) : []),
    [data],
  );

  return { teams, loading, error, retrying, refetch };
}

export default useTeamRankings;
