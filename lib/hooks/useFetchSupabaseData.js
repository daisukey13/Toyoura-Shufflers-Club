import { useState, useEffect, useCallback } from 'react';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function useFetchSupabaseData(options) {
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
      console.log(`[Fetch API] Fetching data from ${tableName}, attempt ${attemptNumber}`);
      
      let url = `${SUPABASE_URL}/rest/v1/${tableName}?`;
      const params = new URLSearchParams();
      params.append('select', '*');
      
      if (orderBy) {
        const order = orderBy.ascending ? 'asc' : 'desc';
        params.append('order', `${orderBy.column}.${order}`);
      }
      
      if (limit) {
        params.append('limit', limit.toString());
      }
      
      url += params.toString();

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log(`[Fetch API] Successfully fetched ${result?.length || 0} records from ${tableName}`);
      
      setData(result || []);
      setError(null);
      setRetrying(false);
    } catch (err) {
      console.error(`[Fetch API] Attempt ${attemptNumber} failed:`, err);
      
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
    let isMounted = true;
    
    const initFetch = async () => {
      if (isMounted) {
        setLoading(true);
        setError(null);
        await fetchData();
      }
    };
    
    initFetch();
    
    return () => {
      isMounted = false;
    };
  }, []);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchData();
  }, [fetchData]);

  return { data, loading, error, retrying, refetch };
}

export function useFetchPlayersData() {
  const { data, loading, error, retrying, refetch } = useFetchSupabaseData({
    tableName: 'players',
    orderBy: { column: 'ranking_points', ascending: false }
  });

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

export function useFetchMatchesData(limit) {
  const { data, loading, error, retrying, refetch } = useFetchSupabaseData({
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
