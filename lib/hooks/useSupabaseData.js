// lib/hooks/useSupabaseData.js

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// デバッグ用のログ関数
const debugLog = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[useSupabaseData ${timestamp}] ${message}`, data);
  
  // モバイルでも確認できるように、一時的にアラートも表示（本番では削除）
  if (typeof window !== 'undefined' && window.location.search.includes('debug=true')) {
    alert(`${message}\n${JSON.stringify(data, null, 2)}`);
  }
};

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

  debugLog('useSupabaseData initialized', { tableName, orderBy, limit });

  const fetchData = useCallback(async (attemptNumber = 1) => {
    try {
      debugLog(`Fetching data from ${tableName}, attempt ${attemptNumber}`);
      
      // Supabaseクライアントの状態を確認
      if (!supabase) {
        throw new Error('Supabase client is not initialized');
      }
      
      // クエリを構築
      let query = supabase.from(tableName).select('*');
      
      if (orderBy) {
        query = query.order(orderBy.column, { ascending: orderBy.ascending || false });
      }
      
      if (limit) {
        query = query.limit(limit);
      }

      debugLog('Query built, executing...');
      const { data: result, error: fetchError } = await query;

      if (fetchError) {
        debugLog('Supabase query error:', fetchError);
        throw fetchError;
      }

      debugLog(`Successfully fetched ${result?.length || 0} records from ${tableName}`);
      setData(result || []);
      setError(null);
      setRetrying(false);
    } catch (err) {
      debugLog(`Attempt ${attemptNumber} failed:`, err);
      
      if (attemptNumber < retryCount) {
        setRetrying(true);
        setTimeout(() => {
          fetchData(attemptNumber + 1);
        }, retryDelay * attemptNumber);
      } else {
        const errorMessage = err.message || 'データの読み込みに失敗しました。ネットワーク接続を確認してください。';
        setError(errorMessage);
        setRetrying(false);
        debugLog('All retry attempts failed', errorMessage);
      }
    } finally {
      if (attemptNumber === 1 || attemptNumber >= retryCount) {
        setLoading(false);
      }
    }
  }, [tableName, orderBy, limit, retryCount, retryDelay]);

  useEffect(() => {
    // 初回マウント時のみ実行
    let isMounted = true;
    
    debugLog('useEffect triggered');
    
    const initFetch = async () => {
      if (isMounted) {
        debugLog('Starting initial fetch');
        setLoading(true);
        setError(null);
        await fetchData();
      }
    };
    
    initFetch();
    
    return () => {
      debugLog('Cleanup function called');
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 空の依存配列で初回のみ実行

  const refetch = useCallback(() => {
    debugLog('Manual refetch triggered');
    setLoading(true);
    setError(null);
    fetchData();
  }, [fetchData]);

  return { data, loading, error, retrying, refetch };
}

// プレーヤーデータ専用のフック
export function usePlayersData() {
  debugLog('usePlayersData called');
  
  const { data, loading, error, retrying, refetch } = useSupabaseData({
    tableName: 'players',
    orderBy: { column: 'ranking_points', ascending: false }
  });

  // クライアント側でフィルタリング
  const filteredData = data.filter(player => 
    player.is_active === true && 
    player.is_deleted !== true
  );

  debugLog('Filtered players data', { 
    totalCount: data.length, 
    filteredCount: filteredData.length 
  });

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
  debugLog('useMatchesData called', { limit });
  
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