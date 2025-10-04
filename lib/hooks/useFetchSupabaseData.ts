// lib/hooks/useFetchSupabaseData.ts
'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

/* =========================
 * 環境変数（REST 用ヘッダ）
 * ========================= */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function headersJSON() {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

/* =========================
 * 型
 * ========================= */
export type PlayerPublic = {
  id: string;
  handle_name: string;
  avatar_url: string | null;
  address: string | null;
  is_active: boolean;
  ranking_points: number;
  handicap: number;
  matches_played: number;
  wins: number;
  losses: number;
  created_at: string;
  current_rank?: number | null; // 無い環境もあるので任意
};

export type MatchDetail = {
  id: string;
  match_date: string;
  winner_id: string;
  loser_id: string;
  winner_score: number;
  loser_score: number;
  winner_name?: string | null;
  loser_name?: string | null;
  winner_avatar?: string | null;
  loser_avatar?: string | null;
  // ビューに無い環境があるので型は任意・RESTでは要求しない
  venue?: string | null;
  tournament_name?: string | null;
};

/* ==========================================================
 * 共通：REST 経由で一覧を取得
 *   - select を明示（存在しない列は絶対に要求しない）
 * ========================================================== */
type FetchOptions = {
  tableName: string;
  select?: string; // 例: "id,handle_name"
  orderBy?: { column: string; ascending?: boolean };
  limit?: number;
  retryCount?: number;
  retryDelay?: number; // ms
};

export function useFetchSupabaseData(options: FetchOptions) {
  const {
    tableName,
    select = '*',
    orderBy,
    limit,
    retryCount = 3,
    retryDelay = 1000,
  } = options;

  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (attempt = 1, signal?: AbortSignal) => {
      try {
        setError(null);
        const params = new URLSearchParams();
        params.append('select', select);
        if (orderBy) {
          params.append('order', `${orderBy.column}.${orderBy.ascending ? 'asc' : 'desc'}`);
        }
        if (typeof limit === 'number') {
          params.append('limit', String(limit));
        }

        const url = `${SUPABASE_URL}/rest/v1/${tableName}?${params.toString()}`;
        const res = await fetch(url, { headers: headersJSON(), signal });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }

        const json = await res.json();
        setData(Array.isArray(json) ? json : []);
        setRetrying(false);
      } catch (e: any) {
        if (signal?.aborted) return;
        if (attempt < retryCount) {
          setRetrying(true);
          await new Promise((r) => setTimeout(r, retryDelay * attempt));
          return fetchData(attempt + 1, signal);
        }
        setError(e?.message || 'データの読み込みに失敗しました。');
        setRetrying(false);
      } finally {
        setLoading(false);
      }
    },
    [tableName, select, orderBy, limit, retryCount, retryDelay]
  );

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    fetchData(1, ac.signal);
    return () => ac.abort();
  }, [fetchData]);

  const refetch = useCallback(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchData(1, ac.signal);
  }, [fetchData]);

  return { data, loading, error, retrying, refetch };
}

/* ==========================================================
 * プレイヤー一覧（公開）
 * ========================================================== */
export function useFetchPlayersData() {
  const { data, loading, error, retrying, refetch } = useFetchSupabaseData({
    tableName: 'players',
    select: [
      'id',
      'handle_name',
      'avatar_url',
      'address',
      'is_active',
      'ranking_points',
      'handicap',
      'matches_played',
      'wins',
      'losses',
      'created_at',
      // 'current_rank' は無い環境もあるため要求しない
    ].join(','),
    orderBy: { column: 'ranking_points', ascending: false },
  });

  const players = (data as PlayerPublic[]).filter(
    (p) => p.is_active === true && (p as any).is_deleted !== true
  );

  return { players, loading, error, retrying, refetch };
}

/* ==========================================================
 * 試合一覧（match_details ビュー）
 *   - venue / tournament_name は要求しない（無い環境があるため）
 * ========================================================== */
const MATCH_DETAIL_SELECT = [
  'id',
  'match_date',
  'winner_id',
  'loser_id',
  'winner_score',
  'loser_score',
  'winner_name',
  'loser_name',
  'winner_avatar',
  'loser_avatar',
  // ← venue, tournament_name は要求しない
].join(',');

export function useFetchMatchesData(limit?: number) {
  const { data, loading, error, retrying, refetch } = useFetchSupabaseData({
    tableName: 'match_details',
    select: MATCH_DETAIL_SELECT,
    orderBy: { column: 'match_date', ascending: false },
    limit,
  });

  return { matches: data as MatchDetail[], loading, error, retrying, refetch };
}

/* ==========================================================
 * プレイヤー詳細（公開 + 直近試合）
 *   - venue / tournament_name は要求しない
 * ========================================================== */
export function useFetchPlayerDetail(playerId: string) {
  const [player, setPlayer] = useState<PlayerPublic | null>(null);
  const [matches, setMatches] = useState<MatchDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPlayerData = useCallback(
    async (attempt = 1, signal?: AbortSignal) => {
      if (!playerId) {
        setLoading(false);
        return;
      }
      try {
        setError(null);

        // 1) player
        {
          const params = new URLSearchParams();
          params.append(
            'select',
            [
              'id',
              'handle_name',
              'avatar_url',
              'address',
              'is_active',
              'ranking_points',
              'handicap',
              'matches_played',
              'wins',
              'losses',
              'created_at',
            ].join(',')
          );
          params.append('id', `eq.${playerId}`);

          const res = await fetch(`${SUPABASE_URL}/rest/v1/players?${params}`, {
            headers: headersJSON(),
            signal,
          });
          if (!res.ok) throw new Error(`Failed to fetch player: ${res.status}`);
          const json = await res.json();
          const row: PlayerPublic | undefined = json?.[0];
          if (!row) throw new Error('Player not found');
          setPlayer(row);
        }

        // 2) matches（勝者/敗者いずれかに該当）
        {
          const m = new URLSearchParams();
          m.append('select', MATCH_DETAIL_SELECT);
          m.append('or', `(winner_id.eq.${playerId},loser_id.eq.${playerId})`);
          m.append('order', 'match_date.desc');
          m.append('limit', '50');

          const res = await fetch(`${SUPABASE_URL}/rest/v1/match_details?${m}`, {
            headers: headersJSON(),
            signal,
          });
          const json: MatchDetail[] = res.ok ? await res.json() : [];
          setMatches(Array.isArray(json) ? json : []);
        }

        setRetrying(false);
      } catch (e: any) {
        if (signal?.aborted) return;
        if (attempt < 3) {
          setRetrying(true);
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          return fetchPlayerData(attempt + 1, signal);
        }
        setError(e?.message || 'データ取得に失敗しました');
        setRetrying(false);
      } finally {
        setLoading(false);
      }
    },
    [playerId]
  );

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    fetchPlayerData(1, ac.signal);
    return () => ac.abort();
  }, [fetchPlayerData]);

  const refetch = useCallback(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchPlayerData(1, ac.signal);
  }, [fetchPlayerData]);

  return { player, matches, loading, error, retrying, refetch };
}

/* ==========================================================
 * お知らせ詳細
 * ========================================================== */
export function useFetchNoticeDetail(noticeId: string) {
  const [notice, setNotice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!noticeId) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();

    (async () => {
      try {
        setError(null);
        const params = new URLSearchParams();
        params.append('select', '*');
        params.append('id', `eq.${noticeId}`);

        const res = await fetch(`${SUPABASE_URL}/rest/v1/notices?${params}`, {
          headers: headersJSON(),
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`Failed to fetch notice: ${res.status}`);
        const json = await res.json();
        if (!json?.[0]) throw new Error('Notice not found');
        setNotice(json[0]);
      } catch (e: any) {
        if (!ac.signal.aborted) setError(e?.message || '取得に失敗しました');
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [noticeId]);

  return { notice, loading, error };
}

/* ==========================================================
 * 更新・作成（書き込みは supabase-js で RLS 通過）
 * ========================================================== */
export async function updatePlayer(playerId: string, updates: Partial<PlayerPublic>) {
  try {
    const { data, error } = await supabase
      .from('players')
      .update(updates)
      .eq('id', playerId)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (e: any) {
    return { data: null, error: e?.message || 'update failed' };
  }
}

/**
 * 試合作成は `matches` テーブルへ（ビュー `match_details` へは挿入不可）
 * 例）{ match_date, winner_id, loser_id, winner_score, loser_score, is_tournament?, tournament_name?, venue? }
 */
export async function createMatch(matchData: Record<string, any>) {
  try {
    const payload = {
      match_date: matchData.match_date ?? new Date().toISOString(),
      winner_id: matchData.winner_id,
      loser_id: matchData.loser_id,
      winner_score: matchData.winner_score,
      loser_score: matchData.loser_score,
      is_tournament: !!matchData.is_tournament,
      tournament_name: matchData.tournament_name ?? null,
      venue: matchData.venue ?? null,
    };

    const { data, error } = await supabase
      .from('matches')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (e: any) {
    return { data: null, error: e?.message || 'create match failed' };
  }
}
