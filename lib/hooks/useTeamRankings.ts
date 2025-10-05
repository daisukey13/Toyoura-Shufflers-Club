// lib/hooks/useTeamRankings.ts
'use client';

import { useMemo } from 'react';
import { useFetchSupabaseData } from '@/lib/hooks/useFetchSupabaseData';

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
  enabled?: boolean;
  requireAuth?: boolean;                 // 既定: false（公開ビューを想定）
  order?: 'avg_rp' | 'win_pct' | 'last_match_at';
  direction?: 'asc' | 'desc';
  limit?: number;
};

/**
 * チームランキング（team_rankings VIEW）
 * - 既存の UI/デザインは変更しません
 * - Supabase 連携の挙動もそのまま
 * - 最小修正: useFetchSupabaseData にジェネリックを渡さず、戻り値を局所で型付け
 */
export function useTeamRankings(opts?: Options) {
  const orderCol = opts?.order ?? 'avg_rp';
  const ascending = (opts?.direction ?? 'desc') === 'asc';

  const {
    data,
    loading,
    error,
    retrying,
    refetch,
  } = useFetchSupabaseData({
    tableName: 'team_rankings', // ← VIEW 名
    select:
      'id,name,team_size,avg_rp,avg_hc,played,wins,losses,win_pct,last_match_at',
    orderBy: { column: orderCol, ascending },
    limit: opts?.limit,
    enabled: opts?.enabled ?? true,
    requireAuth: opts?.requireAuth ?? false,
  });

  // 最小限の型付け（UI側の型安全を保ちつつ、呼び出し側は従来通り）
  const teams: TeamRankItem[] = useMemo(
    () => (Array.isArray(data) ? (data as TeamRankItem[]) : []),
    [data]
  );

  return { teams, loading, error, retrying, refetch };
}

export default useTeamRankings;
