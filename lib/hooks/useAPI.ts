// lib/hooks/useAPI.ts
// 汎用的なAPI呼び出しフック

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { SupabaseAPI, ApiResponse } from '@/lib/api/supabase-api';

// 型定義は必要に応じて厳密化
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

  // 引数の内容（値ベース）変更検知用キー
  const argsJson = useMemo(() => JSON.stringify(args), [args]);

  // 最新の引数を保持（依存のスプレッドを避ける）
  const argsRef = useRef<any[]>(args);
  useEffect(() => {
    argsRef.current = args;
  }, [argsJson, args]); // ← 'args' を依存に追加

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    try {
      setLoading(true);
      setError(null);

      const response = await apiCall(...argsRef.current);

      if (response.error) {
        throw new Error(response.error);
      }

      setData(response.data);
      onSuccess?.(response.data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [enabled, apiCall, onSuccess, onError]);

  // 初回 & 引数内容が変わったときに再取得
  useEffect(() => {
    fetchData();
  }, [fetchData, argsJson]);

  // ポーリング
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
