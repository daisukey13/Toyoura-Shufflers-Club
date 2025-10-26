// lib/hooks/useAPI.ts
// 汎用的なAPI呼び出しフック

import { useState, useEffect, useCallback } from "react";
import { SupabaseAPI, ApiResponse } from "@/lib/api/supabase-api";

// 型定義を一時的にanyで定義
type Player = any;
type Match = any;
type Notice = any;

interface UseAPIOptions {
  enabled?: boolean;
  refetchInterval?: number;
  onSuccess?: (data: any) => void;
  onError?: (error: string) => void;
}

interface UseAPIResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAPI<T>(
  apiCall: (...args: any[]) => Promise<ApiResponse<T>>,
  options: UseAPIOptions = {},
  ...args: any[]
): UseAPIResult<T> {
  const { enabled = true, refetchInterval, onSuccess, onError } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    try {
      setLoading(true);
      setError(null);

      const response = await apiCall(...args);

      if (response.error) {
        throw new Error(response.error);
      }

      setData(response.data);
      onSuccess?.(response.data);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "An error occurred";
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [enabled, apiCall, onSuccess, onError, ...args]);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!refetchInterval || !enabled) return;

    const interval = setInterval(fetchData, refetchInterval);
    return () => clearInterval(interval);
  }, [fetchData, refetchInterval, enabled]);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
  };
}

// 特定のAPI用のカスタムフック
export function usePlayer(playerId: string, options?: UseAPIOptions) {
  return useAPI<Player>(SupabaseAPI.getPlayerById, options, playerId);
}

export function usePlayers(
  options?: UseAPIOptions & { orderBy?: string; limit?: number },
) {
  const { orderBy, limit, ...apiOptions } = options || {};
  return useAPI<Player[]>(SupabaseAPI.getPlayers, apiOptions, {
    orderBy,
    limit,
  });
}

export function useMatches(limit?: number, options?: UseAPIOptions) {
  return useAPI<Match[]>(SupabaseAPI.getMatches, options, limit);
}

export function useMatch(matchId: string, options?: UseAPIOptions) {
  return useAPI<Match>(SupabaseAPI.getMatchById, options, matchId);
}
