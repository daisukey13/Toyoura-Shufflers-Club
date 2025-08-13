// lib/hooks/useFetchSupabaseData.ts
'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

/** Supabase REST 直叩き用の環境変数 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

type OrderBy = { column: string; ascending: boolean };
type UseFetchBaseOptions = {
  tableName: string;
  orderBy?: OrderBy;
  limit?: number;
  retryCount?: number;   // 既定: 3
  retryDelay?: number;   // 既定: 1000(ms)
};

function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/** 汎用データ取得フック */
export function useFetchSupabaseData(options: UseFetchBaseOptions) {
  const {
    tableName,
    orderBy,
    limit,
    retryCount = 3,
    retryDelay = 1000,
  } = options;

  const mountedRef = useMountedRef();
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (attemptNumber = 1) => {
      try {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
          throw new Error('Supabase environment variables are missing.');
        }

        if (mountedRef.current && attemptNumber === 1) {
          setLoading(true);
          setRetrying(false);
          setError(null);
        }

        let url = `${SUPABASE_URL}/rest/v1/${tableName}?`;
        const params = new URLSearchParams();
        params.append('select', '*');

        if (orderBy) {
          params.append('order', `${orderBy.column}.${orderBy.ascending ? 'asc' : 'desc'}`);
        }
        if (typeof limit === 'number') {
          params.append('limit', String(limit));
        }
        url += params.toString();

        const res = await fetch(url, {
          method: 'GET',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }

        const result = await res.json();
        if (mountedRef.current) {
          setData(result ?? []);
          setError(null);
          setRetrying(false);
        }
      } catch (err: any) {
        console.error(`[Fetch API] Attempt ${attemptNumber} failed:`, err);
        if (attemptNumber < retryCount && mountedRef.current) {
          setRetrying(true);
          retryTimerRef.current = setTimeout(() => {
            fetchData(attemptNumber + 1);
          }, retryDelay * attemptNumber);
        } else if (mountedRef.current) {
          setError('データの読み込みに失敗しました。ネットワーク接続を確認してください。');
          setRetrying(false);
        }
      } finally {
        if (mountedRef.current && (attemptNumber === 1 || attemptNumber >= retryCount)) {
          setLoading(false);
        }
      }
    },
    // ← 実際に参照している値を依存に明示（ESLint 警告解消）
    [tableName, orderBy, limit, retryCount, retryDelay, mountedRef]
  );

  useEffect(() => {
    fetchData();
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [fetchData]);

  const refetch = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setLoading(true);
    setError(null);
    fetchData();
  }, [fetchData]);

  return { data, loading, error, retrying, refetch };
}

/** players 一覧（is_active && !is_deleted のみ） */
export function useFetchPlayersData() {
  const { data, loading, error, retrying, refetch } = useFetchSupabaseData({
    tableName: 'players',
    orderBy: { column: 'ranking_points', ascending: false },
  });

  const filteredData = useMemo(
    () => data.filter((p: any) => p?.is_active === true && p?.is_deleted !== true),
    [data]
  );

  return { players: filteredData, loading, error, retrying, refetch };
}

/** match_details 一覧（limit 任意） */
export function useFetchMatchesData(limit?: number) {
  const { data, loading, error, retrying, refetch } = useFetchSupabaseData({
    tableName: 'match_details',
    orderBy: { column: 'match_date', ascending: false },
    limit,
  });

  return { matches: data, loading, error, retrying, refetch };
}

/** プレーヤー詳細（基本情報 + 直近試合） */
export function useFetchPlayerDetail(playerId: string) {
  const mountedRef = useMountedRef();
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [player, setPlayer] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPlayerData = useCallback(
    async (attemptNumber = 1) => {
      if (!playerId) {
        if (mountedRef.current) setLoading(false);
        return;
      }

      try {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
          throw new Error('Supabase environment variables are missing.');
        }

        if (mountedRef.current && attemptNumber === 1) {
          setLoading(true);
          setRetrying(false);
          setError(null);
        }

        // プレイヤー基本情報
        const playerUrl = `${SUPABASE_URL}/rest/v1/players?id=eq.${playerId}&select=*`;
        const playerRes = await fetch(playerUrl, {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
        });
        if (!playerRes.ok) throw new Error(`Failed to fetch player: ${playerRes.status}`);
        const playerJson = await playerRes.json();
        if (!playerJson || playerJson.length === 0) throw new Error('Player not found');
        const playerInfo = playerJson[0];

        // 試合履歴
        const matchesUrl = `${SUPABASE_URL}/rest/v1/match_details?or=(winner_id.eq.${playerId},loser_id.eq.${playerId})&order=match_date.desc&limit=50`;
        const matchesRes = await fetch(matchesUrl, {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
        });
        const matchesJson = matchesRes.ok ? await matchesRes.json() : [];

        if (mountedRef.current) {
          setPlayer(playerInfo);
          setMatches(matchesJson);
          setError(null);
          setRetrying(false);
        }
      } catch (err: any) {
        console.error(`[Fetch API] Attempt ${attemptNumber} failed:`, err);
        if (attemptNumber < 3 && mountedRef.current) {
          setRetrying(true);
          retryTimerRef.current = setTimeout(() => {
            fetchPlayerData(attemptNumber + 1);
          }, 1000 * attemptNumber);
        } else if (mountedRef.current) {
          setError(err?.message ?? 'Failed to fetch player');
          setRetrying(false);
        }
      } finally {
        if (mountedRef.current && (attemptNumber === 1 || attemptNumber >= 3)) {
          setLoading(false);
        }
      }
    },
    [playerId, mountedRef]
  );

  useEffect(() => {
    fetchPlayerData();
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [fetchPlayerData]);

  const refetch = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setLoading(true);
    setError(null);
    fetchPlayerData();
  }, [fetchPlayerData]);

  return { player, matches, loading, error, retrying, refetch };
}

/** お知らせ詳細 */
export function useFetchNoticeDetail(noticeId: string) {
  const mountedRef = useMountedRef();

  const [notice, setNotice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotice = useCallback(async () => {
    if (!noticeId) {
      if (mountedRef.current) setLoading(false);
      return;
    }

    try {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error('Supabase environment variables are missing.');
      }

      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }

      const url = `${SUPABASE_URL}/rest/v1/notices?id=eq.${noticeId}&select=*`;
      const res = await fetch(url, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) throw new Error(`Failed to fetch notice: ${res.status}`);

      const json = await res.json();
      if (!json || json.length === 0) throw new Error('Notice not found');

      if (mountedRef.current) {
        setNotice(json[0]);
        setError(null);
      }
    } catch (err: any) {
      if (mountedRef.current) setError(err?.message ?? 'Failed to fetch notice');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [noticeId, mountedRef]);

  useEffect(() => {
    fetchNotice();
  }, [fetchNotice]);

  return { notice, loading, error, refetch: fetchNotice };
}

/** プレーヤー更新 */
export async function updatePlayer(playerId: string, updates: any) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Supabase environment variables are missing.');
    }

    const url = `${SUPABASE_URL}/rest/v1/players?id=eq.${playerId}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to update player: ${text}`);
    }

    const result = await res.json();
    return { data: result[0], error: null };
  } catch (err: any) {
    return { data: null, error: err?.message ?? 'Update failed' };
  }
}

/** 試合登録 */
export async function createMatch(matchData: any) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Supabase environment variables are missing.');
    }

    const url = `${SUPABASE_URL}/rest/v1/match_details`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(matchData),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create match: ${text}`);
    }

    const result = await res.json();
    return { data: result[0], error: null };
  } catch (err: any) {
    return { data: null, error: err?.message ?? 'Create failed' };
  }
}
