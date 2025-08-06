// lib/hooks/useSupabaseData.js

import { useState, useEffect, useCallback } from 'react';
import { createSupabaseClient } from '@/lib/supabase';

export function useSupabaseData(options) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(false);

  const {
    tableName,
    orderBy,
    limit,
    retryCount = 3,
    retryDelay = 1000
  } = options;

  const fetchData = useCallback(async (attemptNumber = 1) => {
    try {
      // モバイルでの接続問題を考慮して毎回新しいクライアントを作成
      const supabase = createSupabaseClient();
      
      // タイムアウトを設定（10秒）
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      // クエリを構築
      let query = supabase.from(tableName).select('*');
      
      if (orderBy) {
        query = query.order(orderBy.column, { ascending: orderBy.ascending || false });
      }
      
      if (limit) {
        query = query.limit(limit);
      }

      const { data: result, error: fetchError } = await query;
      clearTimeout(timeoutId);

      if (fetchError) {
        throw fetchError;
      }

      setData(result || []);
      setError(null);
      setRetrying(false);
    } catch (err) {
      console.error(`Attempt ${attemptNumber} failed:`, err);
      
      if (attemptNumber < retryCount) {
        setRetrying(true);
        setTimeout(() => {
          fetchData(attemptNumber + 1);
        }, retryDelay * attemptNumber);
      } else {
        setError('データの読み込みに失敗しました');
        setRetrying(false);
      }
    } finally {
      setLoading(false);
    }
  }, [tableName, orderBy, limit, retryCount, retryDelay]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refetch = () => {
    setLoading(true);
    setError(null);
    fetchData();
  };

  return { data, loading, error, retrying, refetch };
}

// プレーヤーデータ専用のフック
export function usePlayersData() {
  const { data, loading, error, retrying, refetch } = useSupabaseData({
    tableName: 'players',
    orderBy: { column: 'ranking_points', ascending: false }
  });

  // クライアント側でフィルタリング
  const filteredData = data.filter(player => 
    player.is_active === true && 
    player.is_deleted !== true
  );

  return { 
    players: filteredData, 
    loading, 
    error, 
    retrying, 
    refetch 
  };
}

// 試合データ専用のフック
export function useMatchesData(limit) {
  const { data, loading, error, retrying, refetch } = useSupabaseData({
    tableName: 'match_details',
    orderBy: { column: 'match_date', ascending: false },
    limit
  });

  return { 
    matches: data, 
    loading, 
    error, 
    retrying, 
    refetch 
  };
}