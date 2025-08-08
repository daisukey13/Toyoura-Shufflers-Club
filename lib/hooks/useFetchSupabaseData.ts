// lib/hooks/useFetchSupabaseData.ts

import { useState, useEffect, useCallback } from 'react';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function useFetchSupabaseData(options: any) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
          'apikey': SUPABASE_ANON_KEY!,
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
    } catch (err: any) {
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

  const filteredData = data.filter((player: any) => 
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

export function useFetchMatchesData(limit?: number) {
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

// プレーヤー詳細データ用のフック
export function useFetchPlayerDetail(playerId: string) {
  const [player, setPlayer] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const fetchPlayerData = useCallback(async (attemptNumber = 1) => {
    if (!playerId) {
      setLoading(false);
      return;
    }

    try {
      console.log(`[Fetch API] Fetching player detail for ID: ${playerId}, attempt ${attemptNumber}`);
      
      // プレーヤー基本情報の取得
      const playerUrl = `${SUPABASE_URL}/rest/v1/players?id=eq.${playerId}&select=*`;
      const playerResponse = await fetch(playerUrl, {
        headers: {
          'apikey': SUPABASE_ANON_KEY!,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        }
      });

      if (!playerResponse.ok) {
        throw new Error(`Failed to fetch player: ${playerResponse.status}`);
      }

      const playerData = await playerResponse.json();
      if (!playerData || playerData.length === 0) {
        throw new Error('Player not found');
      }

      const playerInfo = playerData[0];
      console.log('[Fetch API] Player data:', playerInfo);

      // 試合履歴の取得（match_detailsテーブルから）
      const matchesUrl = `${SUPABASE_URL}/rest/v1/match_details?or=(winner_id.eq.${playerId},loser_id.eq.${playerId})&order=match_date.desc&limit=50`;
      const matchesResponse = await fetch(matchesUrl, {
        headers: {
          'apikey': SUPABASE_ANON_KEY!,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        }
      });

      let matchesData = [];
      if (matchesResponse.ok) {
        matchesData = await matchesResponse.json();
        console.log('[Fetch API] Matches data:', matchesData.length);
      }

      setPlayer(playerInfo);
      setMatches(matchesData);
      setError(null);
      setRetrying(false);

    } catch (err: any) {
      console.error(`[Fetch API] Attempt ${attemptNumber} failed:`, err);
      
      if (attemptNumber < 3) {
        setRetrying(true);
        setTimeout(() => {
          fetchPlayerData(attemptNumber + 1);
        }, 1000 * attemptNumber);
      } else {
        setError(err.message);
        setRetrying(false);
      }
    } finally {
      if (attemptNumber === 1 || attemptNumber >= 3) {
        setLoading(false);
      }
    }
  }, [playerId]);

  useEffect(() => {
    let isMounted = true;
    
    const initFetch = async () => {
      if (isMounted) {
        setLoading(true);
        setError(null);
        await fetchPlayerData();
      }
    };
    
    initFetch();
    
    return () => {
      isMounted = false;
    };
  }, [playerId]);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchPlayerData();
  }, [fetchPlayerData]);

  return { player, matches, loading, error, retrying, refetch };
}

// お知らせ詳細データ用のフック
export function useFetchNoticeDetail(noticeId: string) {
  const [notice, setNotice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!noticeId) {
      setLoading(false);
      return;
    }

    const fetchNoticeDetail = async () => {
      try {
        console.log(`[Fetch API] Fetching notice detail for ID: ${noticeId}`);
        
        const noticeUrl = `${SUPABASE_URL}/rest/v1/notices?id=eq.${noticeId}&select=*`;
        const response = await fetch(noticeUrl, {
          headers: {
            'apikey': SUPABASE_ANON_KEY!,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch notice: ${response.status}`);
        }

        const data = await response.json();
        if (!data || data.length === 0) {
          throw new Error('Notice not found');
        }

        setNotice(data[0]);
        console.log('[Fetch API] Notice data:', data[0]);

      } catch (err: any) {
        console.error('[Fetch API] Error fetching notice detail:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchNoticeDetail();
  }, [noticeId]);

  return { notice, loading, error };
}

// プレーヤー更新用の関数
export async function updatePlayer(playerId: string, updates: any) {
  try {
    console.log(`[Fetch API] Updating player ${playerId}:`, updates);
    
    const url = `${SUPABASE_URL}/rest/v1/players?id=eq.${playerId}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY!,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(updates)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update player: ${errorText}`);
    }

    const result = await response.json();
    console.log('[Fetch API] Player updated successfully:', result);
    return { data: result[0], error: null };

  } catch (err: any) {
    console.error('[Fetch API] Error updating player:', err);
    return { data: null, error: err.message };
  }
}

// 試合登録用の関数
export async function createMatch(matchData: any) {
  try {
    console.log('[Fetch API] Creating new match:', matchData);
    
    const url = `${SUPABASE_URL}/rest/v1/match_details`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY!,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(matchData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create match: ${errorText}`);
    }

    const result = await response.json();
    console.log('[Fetch API] Match created successfully:', result);
    return { data: result[0], error: null };

  } catch (err: any) {
    console.error('[Fetch API] Error creating match:', err);
    return { data: null, error: err.message };
  }
}