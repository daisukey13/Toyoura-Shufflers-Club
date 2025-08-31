// lib/hooks/useSupabaseData.js
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

/* ──────────────────────────────────────────────────────────────
 * デバッグ用ログ（?debug=true を URL に付けると alert も出ます）
 * ────────────────────────────────────────────────────────────── */
const debugLog = (message, data = null) => {
  const timestamp = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.log(`[useSupabaseData ${timestamp}] ${message}`, data);
  if (
    typeof window !== 'undefined' &&
    window.location.search.includes('debug=true')
  ) {
    try {
      // でかいオブジェクトでも落ちないように小さく
      const payload =
        data && typeof data === 'object'
          ? JSON.stringify(data, Object.keys(data).slice(0, 20), 2)
          : String(data ?? '');
      alert(`${message}\n${payload}`);
    } catch {
      alert(`${message}`);
    }
  }
};

/* ──────────────────────────────────────────────────────────────
 * 汎用フェッチフック
 * ────────────────────────────────────────────────────────────── */
export function useSupabaseData(options) {
  const {
    tableName,
    // 取得カラム（既定は *）。文字列 or 配列（配列ならカンマ連結）
    select,
    // 追加のフィルタ（(q) => q.eq('xxx', ...) のように渡す）
    filter,
    orderBy,
    limit,
    // 変更通知で自動リフレッシュしたい場合
    realtime = false,
    // リトライ設定
    retryCount = 3,
    retryDelay = 1000,
  } = options;

  const supabase = useRef(createClient()).current;

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState(null);

  debugLog('initialized', { tableName, orderBy, limit, realtime });

  const fetchData = useCallback(
    async (attemptNumber = 1) => {
      try {
        if (!supabase) throw new Error('Supabase client is not initialized');

        // クエリ組み立て
        let columns = '*';
        if (Array.isArray(select)) columns = select.join(', ');
        else if (typeof select === 'string' && select.trim()) columns = select;

        let query = supabase.from(tableName).select(columns);

        if (typeof filter === 'function') {
          query = filter(query) || query;
        }

        if (orderBy?.column) {
          query = query.order(orderBy.column, {
            ascending: !!orderBy.ascending,
            nullsFirst: orderBy.nullsFirst ?? false,
          });
        }

        if (limit) query = query.limit(limit);

        debugLog('executing query...', { tableName, columns });
        const { data: result, error: fetchError } = await query;

        if (fetchError) {
          debugLog('query error', fetchError);
          throw fetchError;
        }

        setData(result || []);
        setError(null);
        setRetrying(false);
        debugLog(`fetched ${result?.length || 0} rows from ${tableName}`);
      } catch (err) {
        const msg =
          err?.message ||
          'データの読み込みに失敗しました。ネットワーク接続を確認してください。';
        debugLog(`attempt ${attemptNumber} failed`, msg);

        if (attemptNumber < retryCount) {
          setRetrying(true);
          const delay = retryDelay * attemptNumber; // 緩やかなバックオフ
          setTimeout(() => fetchData(attemptNumber + 1), delay);
        } else {
          setError(msg);
          setRetrying(false);
        }
      } finally {
        if (attemptNumber === 1 || attemptNumber >= retryCount) {
          setLoading(false);
        }
      }
    },
    [tableName, select, filter, orderBy, limit, retryCount, retryDelay, supabase]
  );

  useEffect(() => {
    let isMounted = true;
    (async () => {
      if (!isMounted) return;
      setLoading(true);
      setError(null);
      await fetchData();
    })();

    return () => {
      debugLog('cleanup called');
      isMounted = false;
    };
  }, [fetchData]);

  // リアルタイム購読（必要な場合のみ）
  useEffect(() => {
    if (!realtime) return;

    const channel = supabase
      .channel(`public:${tableName}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: tableName,
        },
        () => {
          debugLog('realtime change detected → refetch', { tableName });
          fetchData();
        }
      )
      .subscribe((status) => {
        debugLog('realtime status', status);
      });

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [realtime, supabase, tableName, fetchData]);

  const refetch = useCallback(() => {
    debugLog('manual refetch');
    setLoading(true);
    setError(null);
    fetchData();
  }, [fetchData]);

  return { data, loading, error, retrying, refetch };
}

/* ──────────────────────────────────────────────────────────────
 * プレーヤー専用（ランキング等で使用）
 * avatar_url を必ず取得するよう select を明示
 * ────────────────────────────────────────────────────────────── */
export function usePlayersData() {
  debugLog('usePlayersData called');

  const { data, loading, error, retrying, refetch } = useSupabaseData({
    tableName: 'players',
    // 必要な列を明示（avatar_url を必ず含める）
    select: [
      'id',
      'handle_name',
      'avatar_url',
      'ranking_points',
      'handicap',
      'wins',
      'losses',
      'matches_played',
      'is_active',
      'is_deleted',
    ],
    orderBy: { column: 'ranking_points', ascending: false },
    realtime: true, // 更新があれば即時反映
  });

  // 一部の環境では is_active / is_deleted が無いことがあるため、存在する場合のみフィルタ
  const filteredData = data.filter((player) => {
    const activeOk =
      typeof player.is_active === 'undefined' ? true : player.is_active === true;
    const notDeleted =
      typeof player.is_deleted === 'undefined'
        ? true
        : player.is_deleted !== true;
    return activeOk && notDeleted;
  });

  debugLog('filtered players', {
    total: data.length,
    filtered: filteredData.length,
  });

  return { players: filteredData, loading, error, retrying, refetch };
}

/* ──────────────────────────────────────────────────────────────
 * 試合データ専用（最近の試合など）
 * ────────────────────────────────────────────────────────────── */
export function useMatchesData(limit) {
  debugLog('useMatchesData called', { limit });

  const { data, loading, error, retrying, refetch } = useSupabaseData({
    tableName: 'match_details', // ビューを使っている想定。必要に応じて変更
    select: '*',
    orderBy: { column: 'match_date', ascending: false },
    limit,
    realtime: false,
  });

  return { matches: data, loading, error, retrying, refetch };
}
