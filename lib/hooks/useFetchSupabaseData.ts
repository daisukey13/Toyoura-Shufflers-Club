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

/* ───────────────────────────── helpers ───────────────────────────── */
function isNil(v: any) {
  return v === null || v === undefined;
}
function toNumber(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function pickNumber(obj: any, keys: string[]): number | null {
  for (const k of keys) {
    const n = toNumber(obj?.[k]);
    if (n !== null) return n;
  }
  return null;
}

/* ───────────────────────────── Players schema compatibility ─────────────────────────────
 * ✅ DBによって players.ranking_points が無い (rating だけ) ことがあるため、
 *    取得後に ranking_points を rating で補完して UI 互換を維持する。
 */
function normalizePlayerRow(p0: any) {
  if (!p0 || typeof p0 !== 'object') return p0;
  const p = { ...p0 };
  const rp = pickNumber(p, ['ranking_points', 'rating']);
  if (isNil(p.ranking_points) && rp !== null) p.ranking_points = rp;
  if (isNil(p.rating) && rp !== null) p.rating = rp;
  return p;
}
function normalizePlayers(arr: any[]) {
  return (arr ?? []).map((x) => normalizePlayerRow(x));
}

function hasPlayersRankingPointsError(errText: string) {
  return /players\.ranking_points/i.test(errText) && /does not exist/i.test(errText);
}

/**
 * ✅ PATCH: match_details の列名ブレ吸収
 * - UI側が winner_points_change / loser_points_change を見ていても、delta/別名から補完する
 * - change が 0 でも delta 等が非0なら置き換える（「0pt固定」対策）
 */
function normalizeMatchRow(m0: any) {
  if (!m0 || typeof m0 !== 'object') return m0;
  const m = { ...m0 }; // ★副作用を避ける

  const affects = m?.affects_rating === false ? false : true;

  if (affects) {
    // points
    const wpCandidate = pickNumber(m, ['winner_points_delta', 'winner_rp_delta', 'md_w_change', 'm_w_change']);
    const lpCandidate = pickNumber(m, ['loser_points_delta', 'loser_rp_delta', 'md_l_change', 'm_l_change']);

    const wpChange = pickNumber(m, ['winner_points_change']);
    const lpChange = pickNumber(m, ['loser_points_change']);

    if (isNil(m.winner_points_change) && wpCandidate !== null) m.winner_points_change = wpCandidate;
    else if (wpChange === 0 && wpCandidate !== null && wpCandidate !== 0) m.winner_points_change = wpCandidate;

    if (isNil(m.loser_points_change) && lpCandidate !== null) m.loser_points_change = lpCandidate;
    else if (lpChange === 0 && lpCandidate !== null && lpCandidate !== 0) m.loser_points_change = lpCandidate;

    // handicap（将来の表示ズレ保険）
    const whCandidate = pickNumber(m, ['winner_handicap_delta', 'winner_hc_delta', 'winner_hc_change']);
    const lhCandidate = pickNumber(m, ['loser_handicap_delta', 'loser_hc_delta', 'loser_hc_change']);

    const whChange = pickNumber(m, ['winner_handicap_change']);
    const lhChange = pickNumber(m, ['loser_handicap_change']);

    if (isNil(m.winner_handicap_change) && whCandidate !== null) m.winner_handicap_change = whCandidate;
    else if (whChange === 0 && whCandidate !== null && whCandidate !== 0) m.winner_handicap_change = whCandidate;

    if (isNil(m.loser_handicap_change) && lhCandidate !== null) m.loser_handicap_change = lhCandidate;
    else if (lhChange === 0 && lhCandidate !== null && lhCandidate !== 0) m.loser_handicap_change = lhCandidate;
  }

  return m;
}
function normalizeMatches(arr: any[]) {
  return (arr ?? []).map((x) => normalizeMatchRow(x));
}

function isMatchDetailsAlias(name: string) {
  return name === 'match_details' || name === 'match_details_public' || name === 'match_details_mv';
}

/**
 * ✅ PATCH: match_details を読むときは public/mv に自動フォールバック
 * - 未ログイン閲覧: public → mv → match_details
 * - ログイン必須: mv → match_details → public
 */
function resolveTableCandidates(tableName: string, requireAuth: boolean): string[] {
  if (tableName !== 'match_details') return [tableName];
  return requireAuth
    ? ['match_details_mv', 'match_details', 'match_details_public']
    : ['match_details_public', 'match_details_mv', 'match_details'];
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

/* ───────────────────────────── MATCH EXTRAS (PATCH) ─────────────────────────────
 * match_details 系 VIEW に handicap_change が無い/0 固定のケースがあるため、
 * 基表 matches から winner/loser の points_change / handicap_change を合流する。
 * ※ 取れない (RLS/権限) 場合は黙ってスキップして UI は崩さない
 */
type MatchExtrasRow = {
  id: string;
  winner_points_change?: number | null;
  loser_points_change?: number | null;
  winner_handicap_change?: number | null;
  loser_handicap_change?: number | null;
};

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchMatchExtrasByIds(ids: string[], token: string) {
  const map = new Map<string, MatchExtrasRow>();
  const uniq = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.length > 0)));
  if (uniq.length === 0) return map;

  // URL 長対策で分割
  const groups = chunk(uniq, 120);

  for (const g of groups) {
    const inIds = g.map((id) => `"${id}"`).join(',');
    const url =
      `${SUPABASE_URL}/rest/v1/matches` +
      `?id=in.(${inIds})&select=id,winner_points_change,loser_points_change,winner_handicap_change,loser_handicap_change`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      // RLS/権限などで取れない場合は全体を諦める（部分的に混ざると紛らわしい）
      return new Map();
    }

    const rows = (await res.json()) as MatchExtrasRow[];
    (rows ?? []).forEach((r) => map.set(String(r.id), r));
  }

  return map;
}

function mergeExtrasIntoMatchDetailsRows(rows: any[], extras: Map<string, MatchExtrasRow>) {
  if (!Array.isArray(rows) || rows.length === 0) return rows ?? [];

  const merged = rows.map((m0) => {
    const m = normalizeMatchRow(m0);
    const ex = extras.get(String(m?.id ?? ''));
    if (!ex) return m;

    // affects_rating が false なら 0 扱いを尊重（ただし null の場合だけ入れる）
    const affects = m?.affects_rating === false ? false : true;

    const exWp = toNumber(ex.winner_points_change);
    const exLp = toNumber(ex.loser_points_change);
    const exWh = toNumber(ex.winner_handicap_change);
    const exLh = toNumber(ex.loser_handicap_change);

    const currWp = toNumber(m?.winner_points_change);
    const currLp = toNumber(m?.loser_points_change);
    const currWh = toNumber(m?.winner_handicap_change);
    const currLh = toNumber(m?.loser_handicap_change);

    const out: any = { ...m };

    if (affects) {
      // points
      if (isNil(out.winner_points_change) && exWp !== null) out.winner_points_change = exWp;
      else if (currWp === 0 && exWp !== null && exWp !== 0) out.winner_points_change = exWp;

      if (isNil(out.loser_points_change) && exLp !== null) out.loser_points_change = exLp;
      else if (currLp === 0 && exLp !== null && exLp !== 0) out.loser_points_change = exLp;

      // handicap
      if (isNil(out.winner_handicap_change) && exWh !== null) out.winner_handicap_change = exWh;
      else if (currWh === 0 && exWh !== null && exWh !== 0) out.winner_handicap_change = exWh;

      if (isNil(out.loser_handicap_change) && exLh !== null) out.loser_handicap_change = exLh;
      else if (currLh === 0 && exLh !== null && exLh !== 0) out.loser_handicap_change = exLh;
    } else {
      // affects=false の場合: nullだけ埋める（0固定を壊さない）
      if (isNil(out.winner_points_change) && exWp !== null) out.winner_points_change = exWp;
      if (isNil(out.loser_points_change) && exLp !== null) out.loser_points_change = exLp;
      if (isNil(out.winner_handicap_change) && exWh !== null) out.winner_handicap_change = exWh;
      if (isNil(out.loser_handicap_change) && exLh !== null) out.loser_handicap_change = exLh;
    }

    return normalizeMatchRow(out);
  });

  return merged;
}

/* ───────────────────────────── Core Hook ───────────────────────────── */

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
  const retryTimerRef = useRef<number | null>(null); // unmount 後 setState 防止

  const { cols: orderCols, asc } = useMemo(() => toOrderColumns(orderBy), [orderBy]);
  const baseKey = useMemo(
    () => JSON.stringify({ tableName, select, orderCols, asc, limit, queryParams, requireAuth }),
    [tableName, select, orderCols, asc, limit, queryParams, requireAuth],
  );

  const fetchOnce = useCallback(
    async (token: string | null): Promise<T[]> => {
      const tableCandidates = resolveTableCandidates(tableName, requireAuth);

      // 指定順に order 候補を試し、ダメなら順序無し
      const orderCandidates = orderCols.length ? [...orderCols] : [];
      orderCandidates.push('__NO_ORDER__');

      let lastErr: string | null = null;

      for (const tbl of tableCandidates) {
        for (const col of orderCandidates) {
          let url = `${SUPABASE_URL}/rest/v1/${tbl}?`;
          const params = new URLSearchParams();
          params.set('select', select);

          if (queryParams) {
            for (const [k, v] of Object.entries(queryParams)) {
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
            cache: 'no-store',
          });

          if (res.ok) {
            const json = (await res.json()) as any[];
            const baseOut = isMatchDetailsAlias(tableName) ? normalizeMatches(json) : (json ?? []);

            // ✅ playersは取得結果を補正して ranking_points 互換を維持
            const out = tableName === 'players' ? (normalizePlayers(baseOut) as any[]) : baseOut;

            return out as T[];
          }

          const errorText = await res.text().catch(() => '');
          lastErr = `HTTP ${res.status}: ${errorText}`;

          // ✅ players.ranking_points が無い環境: order で ranking_points を試していたら rating に差し替える
          // ここは「order候補を変えて次へ」で十分なので、そのまま次候補へ落とす（400の扱いに乗る）
          if (res.status === 400 && hasPlayersRankingPointsError(errorText) && col !== '__NO_ORDER__') {
            // 次の order 候補へ
            continue;
          }

          // 400: order 列が無い等 → 次候補へ（同じテーブル内）
          if (res.status === 400 && col !== '__NO_ORDER__') continue;

          // テーブル未存在 / RLS / 権限など → 次テーブル候補へ
          if ([400, 401, 403, 404].includes(res.status)) break;

          // それ以外は致命
          throw new Error(lastErr);
        }
      }

      throw new Error(lastErr || 'データの読み込みに失敗しました。');
    },
    [tableName, select, orderCols, asc, limit, queryParams, requireAuth],
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
  includeAdmins?: boolean; // 管理者も含める（既定 false）
}) {
  // ✅ ranking_points が無い環境があるので order は rating を優先
  // ✅ さらに players は useFetchSupabaseData 内で normalizePlayers がかかり ranking_points 互換を維持する
  const { data, loading, error, retrying, refetch } = useFetchSupabaseData({
    tableName: 'players',
    select: '*',
    orderBy: { columns: ['rating', 'ranking_points', 'id'], ascending: false },
    enabled: opts?.enabled ?? true,
    requireAuth: opts?.requireAuth ?? false,
  });

  const includeInactive = opts?.includeInactive ?? false;
  const includeDeleted = opts?.includeDeleted ?? false;
  const includeAdmins = opts?.includeAdmins ?? false;

  const filtered = useMemo(() => {
    return (data ?? []).filter((p: any) => {
      if (!includeAdmins && p?.is_admin === true) return false;
      if (!includeDeleted && p?.is_deleted === true) return false;
      // is_active === false だけ除外（null/未設定はアクティブ扱い）
      if (!includeInactive && p?.is_active === false) return false;
      return true;
    });
  }, [data, includeInactive, includeDeleted, includeAdmins]);

  return { players: filtered, loading, error, retrying, refetch };
}

/* ===== match_details の不足フィールドを players で補完する最小パッチ ===== */

type PlayerLite = { id: string; ranking_points: number | null; handicap: number | null; rating?: number | null };

async function fetchPlayersLite(playerIds: string[], requireAuth: boolean) {
  const token = await getAccessToken(requireAuth);
  if (requireAuth && !token) throw new Error('認証トークンが見つかりません（ログインが必要です）');

  const inPlayers = playerIds.map((id) => `"${id}"`).join(',');

  // ✅ ranking_points が無い環境があるため rating を併記し、後で ranking_points に補完する
  const url = `${SUPABASE_URL}/rest/v1/players?id=in.(${inPlayers})&select=id,rating,handicap`;

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

  const rows = (await res.json()) as any[];
  const map = new Map<string, PlayerLite>();
  (rows ?? []).forEach((p: any) => {
    const rp = pickNumber(p, ['ranking_points', 'rating']);
    map.set(String(p.id), {
      id: String(p.id),
      ranking_points: rp,
      handicap: toNumber(p?.handicap),
      rating: pickNumber(p, ['rating']),
    });
  });
  return map;
}

export function useFetchMatchesData(limit?: number, opts?: { enabled?: boolean; requireAuth?: boolean }) {
  const requireAuth = opts?.requireAuth ?? false;

  const {
    data: rawMatches,
    loading,
    error,
    retrying,
    refetch,
  } = useFetchSupabaseData({
    tableName: 'match_details', // ✅ alias: public/mv に自動フォールバック
    select: '*',
    orderBy: { columns: ['match_date', 'created_at', 'id'], ascending: false },
    limit,
    enabled: opts?.enabled ?? true,
    requireAuth,
  });

  // 表示用（補完後）データ
  const [matches, setMatches] = useState<any[]>([]);

  // 初期：列名ブレ吸収
  useEffect(() => {
    const arr = (rawMatches as any[]) ?? [];
    setMatches(normalizeMatches(arr));
  }, [rawMatches]);

  // ✅ PATCH: match_details に無い/0固定の change を基表 matches から合流（取れなければスキップ）
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const arr0 = (rawMatches as any[]) ?? [];
      if (arr0.length === 0) return;

      const token = (await getAccessToken(requireAuth)) ?? SUPABASE_ANON_KEY;

      try {
        const ids = Array.from(new Set(arr0.map((m: any) => String(m?.id ?? '')).filter((x: string) => x.length > 0)));
        const extras = await fetchMatchExtrasByIds(ids, token);
        if (cancelled) return;

        if (extras.size > 0) {
          const merged = mergeExtrasIntoMatchDetailsRows(arr0, extras);
          setMatches(merged);
        }
      } catch {
        // 取れなくても一覧は出す
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rawMatches, requireAuth]);

  // singles の RP/HC が穴あきかチェック（teams は除外）
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const arr = (rawMatches as any[]) ?? [];
      if (arr.length === 0) return;

      const needPlayerIds = new Set<string>();

      for (const m0 of arr) {
        const m = normalizeMatchRow(m0);

        const mode = m?.mode ?? null;
        const isTeams = mode === 'teams' || !!m?.winner_team_id || !!m?.loser_team_id;
        if (isTeams) continue;

        const wid = m?.winner_id ? String(m.winner_id) : '';
        const lid = m?.loser_id ? String(m.loser_id) : '';
        if (!wid || !lid) continue;

        if (isNil(m?.winner_current_points) || isNil(m?.winner_current_handicap)) needPlayerIds.add(wid);
        if (isNil(m?.loser_current_points) || isNil(m?.loser_current_handicap)) needPlayerIds.add(lid);
      }

      const ids = Array.from(needPlayerIds);
      if (ids.length === 0) return;

      try {
        const pmap = await fetchPlayersLite(ids, requireAuth);
        if (cancelled) return;

        const baseArr = (matches ?? arr) as any[];

        const next = baseArr.map((m0) => {
          const m = normalizeMatchRow(m0);

          const mode = m?.mode ?? null;
          const isTeams = mode === 'teams' || !!m?.winner_team_id || !!m?.loser_team_id;
          if (isTeams) return m;

          const wid = m?.winner_id ? String(m.winner_id) : '';
          const lid = m?.loser_id ? String(m.loser_id) : '';
          if (!wid || !lid) return m;

          const wp = pmap.get(wid);
          const lp = pmap.get(lid);

          return {
            ...m,
            winner_current_points: isNil(m?.winner_current_points) ? wp?.ranking_points ?? null : m.winner_current_points,
            winner_current_handicap: isNil(m?.winner_current_handicap) ? wp?.handicap ?? null : m.winner_current_handicap,
            loser_current_points: isNil(m?.loser_current_points) ? lp?.ranking_points ?? null : m.loser_current_points,
            loser_current_handicap: isNil(m?.loser_current_handicap) ? lp?.handicap ?? null : m.loser_current_handicap,
          };
        });

        setMatches(next);
      } catch {
        // 補完失敗しても一覧は出す
      }
    })();

    return () => {
      cancelled = true;
    };
    // matches は依存に入れるとループしやすいので rawMatches を基準にする
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    requireAuth: opts?.requireAuth ?? false,
  });

  return { teams: data, loading, error, retrying, refetch };
}

/* =========================================================
 * 詳細系フック（既定: requireAuth: false）
 * =========================================================*/

function computeDelta(after: number | null, before: number | null) {
  if (typeof after === 'number' && typeof before === 'number') return after - before;
  return null;
}

function normalizeMyDeltas(m: any, playerId: string) {
  const isWinner = String(m?.winner_id ?? '') === String(playerId);
  const side = isWinner ? 'winner' : 'loser';

  const pointsAfter = pickNumber(
    m,
    isWinner
      ? ['winner_current_points', 'winner_points_after', 'winner_rp_after', 'winner_ranking_points_after']
      : ['loser_current_points', 'loser_points_after', 'loser_rp_after', 'loser_ranking_points_after'],
  );

  const pointsBefore = pickNumber(
    m,
    isWinner
      ? ['winner_prev_points', 'winner_previous_points', 'winner_points_before', 'winner_rp_before', 'winner_ranking_points_before']
      : ['loser_prev_points', 'loser_previous_points', 'loser_points_before', 'loser_rp_before', 'loser_ranking_points_before'],
  );

  const pointsDelta =
    pickNumber(
      m,
      isWinner
        ? ['winner_points_delta', 'winner_points_change', 'winner_rp_delta', 'winner_rp_change', 'winner_ranking_points_delta']
        : ['loser_points_delta', 'loser_points_change', 'loser_rp_delta', 'loser_rp_change', 'loser_ranking_points_delta'],
    ) ?? computeDelta(pointsAfter, pointsBefore);

  const hcAfter = pickNumber(
    m,
    isWinner
      ? ['winner_current_handicap', 'winner_handicap_after', 'winner_hc_after']
      : ['loser_current_handicap', 'loser_handicap_after', 'loser_hc_after'],
  );

  const hcBefore = pickNumber(
    m,
    isWinner
      ? ['winner_prev_handicap', 'winner_previous_handicap', 'winner_handicap_before', 'winner_hc_before']
      : ['loser_prev_handicap', 'loser_previous_handicap', 'loser_handicap_before', 'loser_hc_before'],
  );

  const hcDelta =
    pickNumber(
      m,
      isWinner
        ? ['winner_handicap_delta', 'winner_handicap_change', 'winner_hc_delta', 'winner_hc_change']
        : ['loser_handicap_delta', 'loser_handicap_change', 'loser_hc_delta', 'loser_hc_change'],
    ) ?? computeDelta(hcAfter, hcBefore);

  const rankAfter = pickNumber(
    m,
    isWinner
      ? ['winner_rank_after', 'winner_rank', 'winner_position', 'winner_current_rank']
      : ['loser_rank_after', 'loser_rank', 'loser_position', 'loser_current_rank'],
  );

  const rankDelta = pickNumber(
    m,
    isWinner ? ['winner_rank_delta', 'winner_rank_change'] : ['loser_rank_delta', 'loser_rank_change'],
  );

  return {
    my_side: side,
    my_points_after: pointsAfter,
    my_points_delta: pointsDelta,
    my_handicap_after: hcAfter,
    my_handicap_delta: hcDelta,
    my_rank_after: rankAfter,
    my_rank_delta: rankDelta,
  };
}

// ✅ 400になったら select を切り替えて再試行（final_matches の列差吸収用）
async function fetchJsonWithSelectFallback(
  baseUrlWithoutSelect: string,
  headers: Record<string, string>,
  selectCandidates: string[],
): Promise<any[]> {
  let lastErr: any = null;

  for (const sel of selectCandidates) {
    const url = `${baseUrlWithoutSelect}&select=${encodeURIComponent(sel)}`;
    const res = await fetch(url, { headers, cache: 'no-store' });

    if (res.ok) {
      const json = (await res.json()) as any[];
      return Array.isArray(json) ? json : [];
    }

    const text = await res.text().catch(() => '');
    lastErr = new Error(`HTTP ${res.status}: ${text}`);

    // ✅ 列がない等の 400 は次の select を試す
    if (res.status === 400) continue;

    // 401/403/404 は打ち切り
    if ([401, 403, 404].includes(res.status)) break;

    throw lastErr;
  }

  console.warn('[fetchJsonWithSelectFallback] failed:', lastErr);
  return [];
}

function pickStr(v: any): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}
function pickBool(v: any): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return null;
}

// （以下、あなたが貼ってくれたコードの残りは “そのまま” でOK）
// ※ ここより下は players.ranking_points を REST で叩いていないため、今回の400原因とは無関係。
//    既存ロジックを崩さないため、変更しません。

async function fetchTournamentMatchesFromMatchesTable(playerId: string, token: string) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const base =
    `${SUPABASE_URL}/rest/v1/matches?` +
    `or=(${encodeURIComponent(`winner_id.eq.${playerId},loser_id.eq.${playerId}`)})` +
    `&status=eq.finalized` +
    `&order=match_date.desc.nullslast` +
    `&limit=200`;

  const selects = [
    [
      'id',
      'match_date',
      'created_at',
      'mode',
      'status',
      'winner_id',
      'loser_id',
      'winner_score',
      'loser_score',
      'tournament_id',
      'is_tournament',
      'venue',
      'notes',
      'finish_reason',
      'end_reason',
      'affects_rating',
      'winner_points_delta',
      'loser_points_delta',
      'winner_handicap_delta',
      'loser_handicap_delta',
      'winner_points_change',
      'loser_points_change',
      'winner_handicap_change',
      'loser_handicap_change',
    ].join(','),
    [
      'id',
      'match_date',
      'created_at',
      'mode',
      'status',
      'winner_id',
      'loser_id',
      'winner_score',
      'loser_score',
      'tournament_id',
      'is_tournament',
      'venue',
      'notes',
      'finish_reason',
      'end_reason',
      'affects_rating',
    ].join(','),
  ];

  const rows = await fetchJsonWithSelectFallback(base, headers, selects);

  const tIds = Array.from(new Set((rows ?? []).map((r) => String(r?.tournament_id ?? '')).filter((s) => s.length > 0)));
  const tMap = new Map<string, any>();
  if (tIds.length > 0) {
    const inT = tIds.map((id) => `"${id}"`).join(',');
    const tUrl = `${SUPABASE_URL}/rest/v1/tournaments?id=in.(${encodeURIComponent(inT)})&select=id,name`;
    const tRes = await fetch(tUrl, { headers, cache: 'no-store' });
    const tJson = tRes.ok ? ((await tRes.json()) as any[]) : [];
    for (const t of tJson ?? []) tMap.set(String(t?.id ?? ''), t);
  }

  const pIds = Array.from(
    new Set(
      (rows ?? [])
        .flatMap((r) => [r?.winner_id, r?.loser_id])
        .map((x) => String(x ?? ''))
        .filter((s) => s.length > 0),
    ),
  );
  const pMap = new Map<string, any>();
  if (pIds.length > 0) {
    const inP = pIds.map((id) => `"${id}"`).join(',');
    const pUrl = `${SUPABASE_URL}/rest/v1/players?id=in.(${encodeURIComponent(inP)})&select=id,handle_name,avatar_url`;
    const pRes = await fetch(pUrl, { headers, cache: 'no-store' });
    const pJson = pRes.ok ? ((await pRes.json()) as any[]) : [];
    for (const p of pJson ?? []) pMap.set(String(p?.id ?? ''), p);
  }

  return (rows ?? []).map((r: any) => {
    const wid = pickStr(r?.winner_id);
    const lid = pickStr(r?.loser_id);

    const wp = wid ? pMap.get(wid) : null;
    const lp = lid ? pMap.get(lid) : null;

    const t = r?.tournament_id ? tMap.get(String(r.tournament_id)) : null;

    return normalizeMatchRow({
      id: String(r?.id ?? ''),
      match_date: pickStr(r?.match_date) ?? pickStr(r?.created_at) ?? new Date().toISOString(),
      mode: pickStr(r?.mode) ?? null,
      status: pickStr(r?.status) ?? null,

      winner_id: wid,
      loser_id: lid,
      winner_name: pickStr(wp?.handle_name) ?? null,
      loser_name: pickStr(lp?.handle_name) ?? null,
      winner_avatar_url: pickStr(wp?.avatar_url) ?? null,
      loser_avatar_url: pickStr(lp?.avatar_url) ?? null,

      winner_score: toNumber(r?.winner_score),
      loser_score: toNumber(r?.loser_score),

      winner_points_delta: toNumber(r?.winner_points_delta),
      loser_points_delta: toNumber(r?.loser_points_delta),
      winner_handicap_delta: toNumber(r?.winner_handicap_delta),
      loser_handicap_delta: toNumber(r?.loser_handicap_delta),
      winner_points_change: toNumber(r?.winner_points_change),
      loser_points_change: toNumber(r?.loser_points_change),
      winner_handicap_change: toNumber(r?.winner_handicap_change),
      loser_handicap_change: toNumber(r?.loser_handicap_change),

      finish_reason: pickStr(r?.finish_reason) ?? pickStr(r?.end_reason) ?? null,
      affects_rating: pickBool(r?.affects_rating),

      is_tournament: typeof r?.is_tournament === 'boolean' ? r.is_tournament : !!r?.tournament_id,
      tournament_name: pickStr(t?.name) ?? null,
      venue: pickStr(r?.venue) ?? null,
      notes: pickStr(r?.notes) ?? null,
    });
  });
}

// 以降（fetchFinalMatchesForPlayer / fetchMatchDetailsForPlayer / useFetchPlayerDetail / updatePlayer / createMatch）は
// あなたの貼ってくれたコードをそのまま残してください（変更不要）。
