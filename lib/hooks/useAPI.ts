// lib/hooks/useAPI.ts
// 汎用的なAPI呼び出しフック

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { SupabaseAPI, ApiResponse } from '@/lib/api/supabase-api';

type Player = any;
type Match = any;
type Notice = any;

interface UseAPIOptions {
  enabled?: boolean;
  refetchInterval?: number; // ms
  onSuccess?: (data: any) => void;
  onError?: (error: string) => void;
}

interface UseAPIResult<T> {
  data: T | null;
  loading: boolean;     // 初回ロード中のみ true にする
  refreshing: boolean;  // 背景更新中に true（UI は出しっぱなし）
  error: string | null;
  refetch: (opts?: { silent?: boolean }) => void;
}

export function useAPI<T>(
  apiCall: (...args: any[]) => Promise<ApiResponse<T>>,
  options: UseAPIOptions = {},
  ...args: any[]
): UseAPIResult<T> {
  const { enabled = true, refetchInterval, onSuccess, onError } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 引数の内容（値ベース）変更検知用キー
  const argsJson = useMemo(() => JSON.stringify(args), [args]);

  // 最新の引数を保持
  const argsRef = useRef<any[]>(args);
  useEffect(() => {
    argsRef.current = args;
  }, [argsJson, args]);

  const fetchData = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!enabled) return;

      try {
        if (data == null && !silent) {
          // 初回ロード or 明示的な再取得のみ loading を上げる
          setLoading(true);
        } else if (silent) {
          setRefreshing(true);
        }
        setError(null);

        const response = await apiCall(...argsRef.current);
        if (response.error) throw new Error(response.error);

        setData(response.data);
        onSuccess?.(response.data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'An error occurred';
        setError(msg);
        onError?.(msg);
      } finally {
        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [enabled, apiCall, onSuccess, onError, data]
  );

  // 初回 & 引数が変わった時
  useEffect(() => {
    fetchData({ silent: false });
  }, [fetchData, argsJson]);

  // ポーリング（背景更新は silent）
  useEffect(() => {
    if (!refetchInterval || !enabled) return;
    const id = setInterval(() => fetchData({ silent: true }), refetchInterval);
    return () => clearInterval(id);
  }, [fetchData, refetchInterval, enabled]);

  const refetch = useCallback(
    (opts?: { silent?: boolean }) => {
      fetchData({ silent: !!opts?.silent });
    },
    [fetchData]
  );

  return {
    data,
    loading,
    refreshing,
    error,
    refetch,
  };
}

// 特化フック
export function usePlayer(playerId: string, options?: UseAPIOptions) {
  return useAPI<Player>(SupabaseAPI.getPlayerById, options, playerId);
}

export function usePlayers(options?: UseAPIOptions & { orderBy?: string; limit?: number }) {
  const { orderBy, limit, ...apiOptions } = options || {};
  return useAPI<Player[]>(SupabaseAPI.getPlayers, apiOptions, { orderBy, limit });
}

export function useMatches(limit?: number, options?: UseAPIOptions) {
  return useAPI<Match[]>(SupabaseAPI.getMatches, options, limit);
}

export function useMatch(matchId: string, options?: UseAPIOptions) {
  return useAPI<Match>(SupabaseAPI.getMatchById, options, matchId);
}
