// lib/hooks/useSupabaseData.js

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

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
      console.log(`Fetching data from ${tableName}, attempt ${attemptNumber}`);
      
      // クエリを構築
      let query = supabase.from(tableName).select('*');
      
      if (orderBy) {
        query = query.order(orderBy.column, { ascending: orderBy.ascending || false });
      }
      
      if (limit) {
        query = query.limit(limit);
      }

      const { data: result, error: fetchError } = await query;

      if (fetchError) {
        console.error('Supabase query error:', fetchError);
        throw fetchError;
      }

      console.log(`Successfully fetched ${result?.length || 0} records from ${tableName}`);
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
        setError('データの読み込みに失敗しました。ネットワーク接続を確認してください。');
        setRetrying(false);
      }
    } finally {
      if (attemptNumber === 1 || attemptNumber >= retryCount) {
        setLoading(false);
      }
    }
  }, [tableName, orderBy, limit, retryCount, retryDelay]);

  useEffect(() => {
    // コンポーネントマウント時にデータを取得
    setLoading(true);
    setError(null);
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName]); // tableNameが変わった時のみ再実行

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchData();
  }, [fetchData]);

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