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

type OrderKey = 'avg_rp' | 'last_match_at' | 'name';

export function useTeamRankings(opts?: {
  enabled?: boolean;
  requireAuth?: boolean; // 既定: false（公開VIEW想定）
  orderBy?: OrderKey;
  ascending?: boolean;
  limit?: number;
}) {
  const orderCol = opts?.orderBy ?? 'avg_rp';
  const ascending = opts?.ascending ?? false;

  const {
    data,
    loading,
    error,
    retrying,
    refetch,
  } = useFetchSupabaseData<TeamRankItem>({
    tableName: 'team_rankings',      // ← VIEW 名
    select: '*',
    orderBy: { column: orderCol, ascending },
    limit: opts?.limit,
    enabled: opts?.enabled ?? true,
    requireAuth: opts?.requireAuth ?? false, // 公開閲覧OK
  });

  // 将来フィルタなどをここで挟む想定
  const teams = useMemo(() => data, [data]);

  return { teams, loading, error, retrying, refetch };
}
