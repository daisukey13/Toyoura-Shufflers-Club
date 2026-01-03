// lib/hooks/useFetchSupabaseData.ts
'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * NOTE
 * - 読み取りは基本「公開でもOK」を想定し、読み取り系ラッパの既定 requireAuth は false。
 * - `match_details` は VIEW（読み取り専用）想定。書き込みは `matches` に対して行ってください。
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type OrderBy =
  | { column: string; ascending?: boolean }
  | { columns: string[]; ascending?: boolean };

type BaseOptions = {
  tableName: string;
  select?: string; // default: '*'
  orderBy?: OrderBy; // 複数列候補を順に試す
  limit?: number;
  retryCount?: number; // default: 3
  retryDelay?: number; // default: 1000 (指数バックオフ気味に使用)
  enabled?: boolean; // default: true
  requireAuth?: boolean; // default: true（読み取り系ラッパでは false を指定）
  queryParams?: Record<string, string>; // 追加クエリ（eq系など）
};

function toOrderColumns(orderBy?: OrderBy): { cols: string[]; asc: boolean } {
  if (!orderBy) return { cols: [], asc: false };
  if ('columns' in orderBy) {
    return { cols: orderBy.columns, asc: !!orderBy.ascending };
  }
  return { cols: [orderBy.column], asc: !!orderBy.ascending };
}

/** 内部: アクセストークン取得（必要なら少し待機してリトライ） */
async function getAccessToken(requireAuth: boolean, tries = 3, delayMs = 300) {
  const supabase = createClient();
  for (let i = 0; i < tries; i++) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    if (token) return token;
    if (!requireAuth) return null; // 認証不要なら即 null でOK（Anonキーで読む）
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

export function useFetchSupabaseData<T = any>(options: BaseOptions) {
  const {
    tableName,
    select = '*',
    orderBy,
    limit,
    retryCount = 3,
    retryDelay = 1000,
    enabled = true,
    requireAuth = true,
    queryParams,
  } = options;

  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  // フェッチ制御
  const inflightKeyRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastKeyRef = useRef<string | null>(null); // StrictMode の二重実行回避（キーが同じ場合のみ抑止）
  const retryTimerRef = useRef<number | null>(null); // ★PATCH: unmount 後 setState 防止

  const { cols: orderCols, asc } = useMemo(() => toOrderColumns(orderBy), [orderBy]);
  const baseKey = useMemo(
    () => JSON.stringify({ tableName, select, orderCols, asc, limit, queryParams, requireAuth }),
    [tableName, select, orderCols, asc, limit, queryParams, requireAuth],
  );

  const fetchOnce = useCallback(
    async (token: string | null): Promise<T[]> => {
      // 指定順に order 候補を試し、ダメなら順序無し
      const candidates = orderCols.length ? [...orderCols] : [];
      candidates.push('__NO_ORDER__');

      for (const col of candidates) {
        let url = `${SUPABASE_URL}/rest/v1/${tableName}?`;
        const params = new URLSearchParams();
        params.set('select', select);

        if (queryParams) {
          for (const [k, v] of Object.entries(queryParams)) {
            // undefined などが混ざっても壊れないように
            if (typeof v === 'string' && v.length > 0) params.set(k, v);
          }
        }

        if (col !== '__NO_ORDER__') {
          params.append('order', `${col}.${asc ? 'asc' : 'desc'}`);
        }
        if (typeof limit === 'number') params.append('limit', String(limit));

        url += params.toString();

        // 以前のリクエストを中断
        abortRef.current?.abort();
        abortRef.current = new AbortController();

        const res = await fetch(url, {
          method: 'GET',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token ?? SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          signal: abortRef.current.signal,
          cache: 'no-store', // ★PATCH: 最新を取りたい（ランキング等）
        });

        if (!res.ok) {
          // 列が存在しないなどの 400 は次候補へ
          if (res.status === 400 && col !== '__NO_ORDER__') continue;
          const errorText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }

        const json = (await res.json()) as T[];
        return json ?? [];
      }

      return [];
    },
    [tableName, select, orderCols, asc, limit, queryParams],
  );

  const fetchData = useCallback(
    async (attemptNumber = 1) => {
      if (!enabled) return;

      if (inflightKeyRef.current === baseKey) return; // 二重フェッチ抑止
      inflightKeyRef.current = baseKey;

      // 進行中の retry タイマーがあれば止める
      if (retryTimerRef.current != null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      setLoading(true);
      setError(null);

      try {
        const token = await getAccessToken(requireAuth);
        if (requireAuth && !token) {
          throw new Error('認証トークンが見つかりません（ログインが必要です）');
        }

        const rows = await fetchOnce(token);
        setData(rows);
        setRetrying(false);
      } catch (err: any) {
        if (attemptNumber < retryCount) {
          setRetrying(true);
          retryTimerRef.current = window.setTimeout(() => {
            fetchData(attemptNumber + 1);
          }, retryDelay * attemptNumber);
        } else {
          setError(err?.message || 'データの読み込みに失敗しました。');
          setRetrying(false);
        }
      } finally {
        if (attemptNumber === 1 || attemptNumber >= retryCount) setLoading(false);
        inflightKeyRef.current = null;
      }
    },
    [enabled, baseKey, retryCount, retryDelay, fetchOnce, requireAuth],
  );

  useEffect(() => {
    if (!enabled) return;

    // StrictMode の初回二重実行を回避（baseKey が同じ時だけ抑止）
    if (process.env.NODE_ENV !== 'production') {
      if (lastKeyRef.current === baseKey) return;
      lastKeyRef.current = baseKey;
    }

    fetchData();

    return () => {
      abortRef.current?.abort();
      if (retryTimerRef.current != null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, baseKey]);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchData();
  }, [fetchData]);

  return { data, loading, error, retrying, refetch };
}

/* =========================================================
 * 読み取り系ラッパ（既定で requireAuth: false）
 * =========================================================*/

export function useFetchPlayersData(opts?: {
  enabled?: boolean;
  requireAuth?: boolean;
  includeInactive?: boolean; // 非アクティブも含める
  includeDeleted?: boolean; // is_deleted も含める
  includeAdmins?: boolean; // ★PATCH: 管理者も含める（既定 false）
}) {
  const { data, loading, error, retrying, refetch } = useFetchSupabaseData({
    tableName: 'players',
    select: '*',
    orderBy: { columns: ['ranking_points', 'id'], ascending: false },
    enabled: opts?.enabled ?? true,
    requireAuth: opts?.requireAuth ?? false, // 公開閲覧を許容
  });

  const includeInactive = opts?.includeInactive ?? false;
  const includeDeleted = opts?.includeDeleted ?? false;
  const includeAdmins = opts?.includeAdmins ?? false;

  const filtered = useMemo(() => {
    return (data ?? []).filter((p: any) => {
      // ★PATCH: admin を既定で除外（ランキング等に混ざる事故防止）
      if (!includeAdmins && p?.is_admin === true) return false;

      // deleted を除外（列が無い/未設定でも動くように）
      if (!includeDeleted && p?.is_deleted === true) return false;

      // ★最重要: is_active === true ではなく「false だけ除外」
      // これで null/未設定の既存データは “アクティブ扱い” のままになる
      if (!includeInactive && p?.is_active === false) return false;

      return true;
    });
  }, [data, includeInactive, includeDeleted, includeAdmins]);

  return { players: filtered, loading, error, retrying, refetch };
}

/* ===== ここから: match_details の不足フィールドを players で補完する最小パッチ ===== */

type PlayerLite = { id: string; ranking_points: number | null; handicap: number | null };

async function fetchPlayersLite(playerIds: string[], requireAuth: boolean) {
  const token = await getAccessToken(requireAuth);
  if (requireAuth && !token) throw new Error('認証トークンが見つかりません（ログインが必要です）');

  // REST の in は "..." で囲うのが安全
  const inPlayers = playerIds.map((id) => `"${id}"`).join(',');
  const url =
    `${SUPABASE_URL}/rest/v1/players` +
    `?id=in.(${inPlayers})&select=id,ranking_points,handicap`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token ?? SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`players fetch failed: ${t}`);
  }

  const rows = (await res.json()) as PlayerLite[];
  const map = new Map<string, PlayerLite>();
  (rows ?? []).forEach((p) => map.set(String(p.id), p));
  return map;
}

export function useFetchMatchesData(
  limit?: number,
  opts?: { enabled?: boolean; requireAuth?: boolean },
) {
  const requireAuth = opts?.requireAuth ?? false;

  const {
    data: rawMatches,
    loading,
    error,
    retrying,
    refetch,
  } = useFetchSupabaseData({
    tableName: 'match_details', // VIEW（読み取り専用）
    select: '*',
    orderBy: { columns: ['match_date', 'created_at', 'id'], ascending: false }, // 列が無ければ自動で次候補/順不同へ
    limit,
    enabled: opts?.enabled ?? true,
    requireAuth, // 公開閲覧を許容
  });

  // 表示用（補完後）データ
  const [matches, setMatches] = useState<any[]>([]);

  useEffect(() => {
    setMatches(rawMatches as any[]);
  }, [rawMatches]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const arr = (rawMatches as any[]) ?? [];
      if (arr.length === 0) return;

      // singles の RP/HC が穴あきかチェック（teams は除外）
      const needPlayerIds = new Set<string>();

      const isNil = (v: any) => v === null || v === undefined;

      for (const m of arr) {
        const mode = m?.mode ?? null;
        const isTeams = mode === 'teams' || !!m?.winner_team_id || !!m?.loser_team_id;
        if (isTeams) continue;

        const wid = m?.winner_id ? String(m.winner_id) : '';
        const lid = m?.loser_id ? String(m.loser_id) : '';
        if (!wid || !lid) continue;

        // match_details が RP/HC を返していない (= null) 場合に補完
        if (isNil(m?.winner_current_points) || isNil(m?.winner_current_handicap)) needPlayerIds.add(wid);
        if (isNil(m?.loser_current_points) || isNil(m?.loser_current_handicap)) needPlayerIds.add(lid);
      }

      const ids = Array.from(needPlayerIds);
      if (ids.length === 0) return; // 補完不要

      try {
        const pmap = await fetchPlayersLite(ids, requireAuth);
        if (cancelled) return;

        const next = arr.map((m) => {
          const mode = m?.mode ?? null;
          const isTeams = mode === 'teams' || !!m?.winner_team_id || !!m?.loser_team_id;
          if (isTeams) return m;

          const wid = m?.winner_id ? String(m.winner_id) : '';
          const lid = m?.loser_id ? String(m.loser_id) : '';
          if (!wid || !lid) return m;

          const wp = pmap.get(wid);
          const lp = pmap.get(lid);

          // 既に入っている値は尊重し、null のときだけ埋める
          return {
            ...m,
            winner_current_points: isNil(m?.winner_current_points) ? (wp?.ranking_points ?? null) : m.winner_current_points,
            winner_current_handicap: isNil(m?.winner_current_handicap) ? (wp?.handicap ?? null) : m.winner_current_handicap,
            loser_current_points: isNil(m?.loser_current_points) ? (lp?.ranking_points ?? null) : m.loser_current_points,
            loser_current_handicap: isNil(m?.loser_current_handicap) ? (lp?.handicap ?? null) : m.loser_current_handicap,
          };
        });

        setMatches(next);
      } catch {
        // 補完失敗しても一覧は出す（何もしない）
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rawMatches, requireAuth]);

  return { matches, loading, error, retrying, refetch };
}

/** チームランキング（team_rankings VIEW） */
export type TeamRankingRow = {
  id: string;
  name: string;
  team_size?: number | null;
  avg_rp?: number | null;
  avg_hc?: number | null;
  played?: number | null;
  wins?: number | null;
  losses?: number | null;
  win_pct?: number | null;
  last_match_at?: string | null;
};

export function useTeamRankings(opts?: {
  enabled?: boolean;
  requireAuth?: boolean; // 既定: false（公開ビューを想定）
  order?: 'avg_rp' | 'win_pct' | 'last_match_at';
  direction?: 'asc' | 'desc';
  limit?: number;
}) {
  const orderCol = opts?.order ?? 'avg_rp';
  const asc = (opts?.direction ?? 'desc') === 'asc';

  const { data, loading, error, retrying, refetch } = useFetchSupabaseData<TeamRankingRow>({
    tableName: 'team_rankings',
    select: 'id,name,team_size,avg_rp,avg_hc,played,wins,losses,win_pct,last_match_at',
    orderBy: { column: orderCol, ascending: asc },
    limit: opts?.limit,
    enabled: opts?.enabled ?? true,
    requireAuth: opts?.requireAuth ?? false,
  });

  return { teams: data, loading, error, retrying, refetch };
}

/** チーム一覧（UI 選択用） */
export type TeamRow = { id: string; name: string };

export function useTeamsList(opts?: {
  enabled?: boolean;
  requireAuth?: boolean;
  order?: 'name' | 'created_at';
  direction?: 'asc' | 'desc';
  limit?: number;
}) {
  const orderCol = opts?.order ?? 'name';
  const asc = (opts?.direction ?? 'asc') === 'asc';

  const { data, loading, error, retrying, refetch } = useFetchSupabaseData<TeamRow>({
    tableName: 'teams',
    select: 'id,name',
    orderBy: { column: orderCol, ascending: asc },
    limit: opts?.limit,
    enabled: opts?.enabled ?? true,
    requireAuth: opts?.requireAuth ?? false, // 公開で読める運用なら false、RLS が厳しいなら true に変更
  });

  return { teams: data, loading, error, retrying, refetch };
}

/* =========================================================
 * 詳細系フック（既定: requireAuth: false）
 * =========================================================*/

export function useFetchPlayerDetail(
  playerId: string,
  opts?: { enabled?: boolean; requireAuth?: boolean },
) {
  const [player, setPlayer] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const enabled = opts?.enabled ?? true;
  const requireAuth = opts?.requireAuth ?? false;

  useEffect(() => {
    if (!enabled || !playerId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const supabase = createClient();

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const token =
          (await supabase.auth.getSession()).data.session?.access_token ??
          (requireAuth ? null : SUPABASE_ANON_KEY);

        if (requireAuth && !token) throw new Error('認証トークンが見つかりません');

        // プレイヤー情報（inactiveでも取得OK）
        const playerUrl = `${SUPABASE_URL}/rest/v1/players?id=eq.${playerId}&select=*`;
        const playerRes = await fetch(playerUrl, {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          cache: 'no-store',
        });
        if (!playerRes.ok) throw new Error(`Failed to fetch player: ${playerRes.status}`);
        const playerData = await playerRes.json();
        if (!playerData?.[0]) throw new Error('Player not found');
        if (cancelled) return;

        // 試合履歴（VIEW）
        const matchUrl =
          `${SUPABASE_URL}/rest/v1/match_details` +
          `?or=(winner_id.eq.${playerId},loser_id.eq.${playerId})&order=match_date.desc&limit=50`;
        const matchesRes = await fetch(matchUrl, {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          cache: 'no-store',
        });
        const matchesData = matchesRes.ok ? await matchesRes.json() : [];
        if (cancelled) return;

        setPlayer(playerData[0]);
        setMatches(matchesData || []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || '読み込みに失敗しました');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [playerId, enabled, requireAuth]);

  const refetch = useCallback(() => {
    // 必要に応じて再取得ロジックを実装
  }, []);

  return { player, matches, loading, error, refetch };
}

/* =========================================================
 * 変更系ユーティリティ（必ずユーザートークンで実行）
 * =========================================================*/

export async function updatePlayer(playerId: string, updates: any) {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error('ログインが必要です');
    const token = session.access_token;

    const url = `${SUPABASE_URL}/rest/v1/players?id=eq.${playerId}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`, // ★ ユーザーのアクセストークン
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Failed to update player: ${t}`);
    }
    const json = await res.json();
    return { data: json?.[0] ?? null, error: null };
  } catch (e: any) {
    return { data: null, error: e?.message || '更新に失敗しました' };
  }
}

export async function createMatch(matchData: any) {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error('ログインが必要です');
    const token = session.access_token;

    const url = `${SUPABASE_URL}/rest/v1/matches`; // ★ VIEW ではなく基表へ
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`, // ★ ユーザーのアクセストークン
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(matchData),
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Failed to create match: ${t}`);
    }
    const json = await res.json();
    return { data: json?.[0] ?? null, error: null };
  } catch (e: any) {
    return { data: null, error: e?.message || '登録に失敗しました' };
  }
}
