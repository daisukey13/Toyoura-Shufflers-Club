// lib/hooks/useFetchMatchesData.ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

type MatchRow = {
  id: string;
  match_date: string | null;
  created_at?: string | null;
  mode: string | null;
  status: string | null;

  // singles
  winner_id: string | null;
  loser_id: string | null;
  winner_score: number | null;
  loser_score: number | null;

  // teams
  winner_team_no: number | null;
  loser_team_no: number | null;

  // meta
  tournament_id: string | null;
  is_tournament: boolean | null;
  venue: string | null;
  notes: string | null;

  // finish meta (環境差あり)
  end_reason?: string | null;
  finish_reason?: string | null;
  time_limit_seconds?: number | null;

  // delta（環境差あり）
  winner_points_delta?: number | null;
  loser_points_delta?: number | null;
  winner_handicap_delta?: number | null;
  loser_handicap_delta?: number | null;
  winner_points_change?: number | null;
  loser_points_change?: number | null;
  winner_handicap_change?: number | null;
  loser_handicap_change?: number | null;
  affects_rating?: boolean | null;
};

type FinalMatchRow = {
  id: string;
  created_at: string | null;
  winner_id: string | null;
  loser_id: string | null;
  winner_score: number | null;
  loser_score: number | null;

  end_reason?: string | null;
  finish_reason?: string | null;
  affects_rating?: boolean | null;

  // delta（環境差あり）
  winner_points_delta?: number | null;
  loser_points_delta?: number | null;
  winner_handicap_delta?: number | null;
  loser_handicap_delta?: number | null;
};

type PlayerRow = {
  id: string;
  handle_name: string | null;
  avatar_url: string | null;
  ranking_points: number | null;
  handicap: number | null;
};

type TournamentRow = {
  id: string;
  name: string | null;
};

type MatchTeamRow = {
  match_id: string;
  team_id: string;
  team_no: number;
};

type TeamRow = {
  id: string;
  name: string | null;
};

type UnifiedRow = {
  id: string;
  mode: string | null;
  status: string | null;
  match_date: string | null;

  winner_id: string | null;
  loser_id: string | null;
  winner_score: number | null;
  loser_score: number | null;

  winner_points_delta: number | null;
  loser_points_delta: number | null;
  winner_handicap_delta: number | null;
  loser_handicap_delta: number | null;

  winner_name: string | null;
  loser_name: string | null;
  winner_avatar_url: string | null;
  loser_avatar_url: string | null;

  finish_reason: string | null;
  affects_rating: boolean | null;
};

export interface MatchDetails {
  id: string;
  match_date: string;
  mode?: 'singles' | 'teams' | string | null;

  // singles
  winner_id?: string | null;
  loser_id?: string | null;
  winner_name?: string | null;
  loser_name?: string | null;
  winner_avatar_url?: string | null;
  loser_avatar_url?: string | null;
  winner_score?: number | null;
  loser_score?: number | null;

  // delta（統一）
  winner_points_delta?: number | null;
  loser_points_delta?: number | null;
  winner_handicap_delta?: number | null;
  loser_handicap_delta?: number | null;

  // finish meta
  finish_reason?: string | null;
  affects_rating?: boolean | null;

  // teams
  winner_team_id?: string | null;
  winner_team_name?: string | null;
  loser_team_id?: string | null;
  loser_team_name?: string | null;

  // optional meta
  is_tournament?: boolean | null;
  tournament_name?: string | null;
  venue?: string | null;
  notes?: string | null;

  // 互換用
  winner_current_points?: number | null;
  loser_current_points?: number | null;
  winner_current_handicap?: number | null;
  loser_current_handicap?: number | null;
}

function normalizeMode(raw: string | null): 'singles' | 'teams' | string | null {
  if (!raw) return null;
  if (raw === 'player') return 'singles';
  return raw;
}

function toNumOrNull(v: any): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function pickDeltaNumber(obj: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}
function pickBoolOrNull(v: any): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return null;
}
function pickStringOrNull(v: any): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

/** ✅ エラー配列などが混ざっても MatchRow だけ通す */
function isMatchRow(v: unknown): v is MatchRow {
  if (!v || typeof v !== 'object') return false;
  const o = v as any;
  return typeof o.id === 'string' && 'match_date' in o && 'mode' in o && 'status' in o;
}

function isFinalized(row: MatchRow): boolean {
  if (row.status !== 'finalized') return false;
  const mode = normalizeMode(row.mode);
  if (mode === 'singles') return !!row.winner_id && !!row.loser_id;
  if (mode === 'teams') return true;
  return false;
}

function uniqStrings(xs: Array<string | null | undefined>): string[] {
  return Array.from(new Set(xs.filter((v): v is string => !!v)));
}

/* ===============================
 * ✅ 「存在しない列」で 400 になるのを回避する
 *   - schema cache / column does not exist を検出
 *   - select を候補順にフォールバック
 * =============================== */
function isMissingColumnErrorMessage(msg: string, col: string) {
  const m = String(msg || '').toLowerCase();
  const c = col.toLowerCase();
  return (
    (m.includes('schema cache') && m.includes(`'${c}'`)) ||
    (m.includes('does not exist') && m.includes('column') && m.includes(c))
  );
}

async function safeSelectMany<T>(
  baseQuery: any,
  selectCandidates: string[],
): Promise<{ data: T[]; error: any; usedSelect: string }> {
  let lastErr: any = null;

  for (const sel of selectCandidates) {
    const { data, error } = await baseQuery.select(sel);
    if (!error) return { data: (data ?? []) as T[], error: null, usedSelect: sel };

    const msg = String(error.message || '');

    // sel に含まれるどれかの列が無いだけなら、別 sel を試す
    const cols = sel
      .split(',')
      .map((s) => s.trim())
      .map((s) => s.split(' ')[0]); // "col as alias" 対策

    const missing = cols.find((c) => isMissingColumnErrorMessage(msg, c));
    if (missing) {
      lastErr = error;
      continue;
    }

    // 別原因なら終了
    lastErr = error;
    break;
  }

  return { data: [] as T[], error: lastErr, usedSelect: '' };
}

export function useFetchMatchesData() {
  const [matches, setMatches] = useState<MatchDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    setError(null);
    setLoading(true);

    // ─────────────────────────────
    // 1) matches（通常 + 大会のリーグ/トーナメントもここに来る）
    //    ✅ delta/affects/finish も「列があれば」拾う（無ければフォールバック）
    // ─────────────────────────────
    const matchesSelectCandidatesForRest = [
      // delta + affects + finish まで全部ある環境
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
        'winner_team_no',
        'loser_team_no',
        'tournament_id',
        'is_tournament',
        'venue',
        'notes',
        'end_reason',
        'finish_reason',
        'time_limit_seconds',
        'winner_points_delta',
        'loser_points_delta',
        'winner_handicap_delta',
        'loser_handicap_delta',
        'winner_points_change',
        'loser_points_change',
        'winner_handicap_change',
        'loser_handicap_change',
        'affects_rating',
      ].join(','),
      // finish はあるが delta は無い環境
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
        'winner_team_no',
        'loser_team_no',
        'tournament_id',
        'is_tournament',
        'venue',
        'notes',
        'end_reason',
        'finish_reason',
        'time_limit_seconds',
      ].join(','),
      // 最小（昔の構成）
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
        'winner_team_no',
        'loser_team_no',
        'tournament_id',
        'is_tournament',
        'venue',
        'notes',
      ].join(','),
      '*',
    ];

// ✅ matches を REST 経由で取得（.order が無い環境でも動く）
const headers = {
  apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
  'Content-Type': 'application/json',
};

const baseUrl =
  `${process.env.NEXT_PUBLIC_SUPABASE_URL!}/rest/v1/matches` +
  `?order=match_date.desc.nullslast` +
  `&limit=500`;



let mRowsRaw: MatchRow[] = [];
let mErr: { message: string } | null = null;

for (const sel of matchesSelectCandidatesForRest) {
  const url = `${baseUrl}&select=${encodeURIComponent(sel)}`;
  const res = await fetch(url, { headers, cache: 'no-store' });

  if (res.ok) {
    mRowsRaw = (await res.json()) as MatchRow[];
    mErr = null;
    break;
  }

  const text = await res.text().catch(() => '');
  // 400 は「列が無い」パターンなので次の select にフォールバック
  if (res.status === 400) {
    mErr = { message: text || 'Bad Request' };
    continue;
  }

  // それ以外は致命
  mErr = { message: `HTTP ${res.status}: ${text}` };
  break;
}

if (mErr) {
  if (mountedRef.current) {
    setError(mErr.message);
    setLoading(false);
  }
  return;
}



    // ─────────────────────────────
    // 2) final_matches（決勝）
    //    ✅ delta 列の有無で 400 にならないようにフォールバック
    // ─────────────────────────────
    const finalsSelectCandidates = [
      // delta 列まである環境
      [
        'id',
        'created_at',
        'winner_id',
        'loser_id',
        'winner_score',
        'loser_score',
        'end_reason',
        'finish_reason',
        'affects_rating',
        'winner_points_delta',
        'loser_points_delta',
        'winner_handicap_delta',
        'loser_handicap_delta',
      ].join(','),
      // delta なし環境
      [
        'id',
        'created_at',
        'winner_id',
        'loser_id',
        'winner_score',
        'loser_score',
        'end_reason',
        'finish_reason',
        'affects_rating',
      ].join(','),
      // 最小
      ['id', 'created_at', 'winner_id', 'loser_id', 'winner_score', 'loser_score'].join(','),
      '*',
    ];

          // ✅ final_matches も REST 経由で取得（.order が無い環境でも動く）
      
     

      const fBaseUrl =
        `${process.env.NEXT_PUBLIC_SUPABASE_URL!}/rest/v1/final_matches` +
        `?order=created_at.desc.nullslast` +
        `&limit=200`;

      let fRowsRaw: any[] = [];
      let fErr: { message: string } | null = null;

      for (const sel of finalsSelectCandidates) {
        const url = `${fBaseUrl}&select=${encodeURIComponent(sel)}`;
        const res = await fetch(url, { headers, cache: 'no-store' });

        if (res.ok) {
          fRowsRaw = (await res.json()) as any[];
          fErr = null;
          break;
        }

        const text = await res.text().catch(() => '');
        if (res.status === 400) {
          // 400 は「列が無い」→ 次の select へ
          fErr = { message: text || 'Bad Request' };
          continue;
        }

        // それ以外は致命
        fErr = { message: `HTTP ${res.status}: ${text}` };
        break;
      }


    // final_matches は「読めない環境でも落とさない」
    const fRows: FinalMatchRow[] =
      !fErr && Array.isArray(fRowsRaw)
        ? (fRowsRaw as any[]).map((x) => ({
            id: String(x?.id ?? ''),
            created_at: (x?.created_at ?? null) as string | null,
            winner_id: (x?.winner_id ?? null) as string | null,
            loser_id: (x?.loser_id ?? null) as string | null,
            winner_score: toNumOrNull(x?.winner_score),
            loser_score: toNumOrNull(x?.loser_score),
            end_reason: pickStringOrNull(x?.end_reason ?? null),
            finish_reason: pickStringOrNull(x?.finish_reason ?? null),
            affects_rating: pickBoolOrNull(x?.affects_rating),

            winner_points_delta: toNumOrNull(x?.winner_points_delta),
            loser_points_delta: toNumOrNull(x?.loser_points_delta),
            winner_handicap_delta: toNumOrNull(x?.winner_handicap_delta),
            loser_handicap_delta: toNumOrNull(x?.loser_handicap_delta),
          }))
        : [];

    // ─────────────────────────────
    // 3) mRows を型ガードして finalized のみに
    // ─────────────────────────────
    const raw = Array.isArray(mRowsRaw) ? (mRowsRaw as unknown[]) : [];
    const allRows = raw.filter(isMatchRow);
    const rows = allRows.filter(isFinalized);

    // finals → MatchDetails（最低限 + delta 取れたら入れる）
    const finalsAsDetails: MatchDetails[] = fRows
      .filter((r) => !!r.id)
      .map((r) => ({
        id: r.id,
        match_date: (r.created_at ?? new Date().toISOString()) as string,
        mode: 'singles',
        winner_id: r.winner_id ?? null,
        loser_id: r.loser_id ?? null,
        winner_score: r.winner_score ?? null,
        loser_score: r.loser_score ?? null,

        winner_points_delta: r.winner_points_delta ?? null,
        loser_points_delta: r.loser_points_delta ?? null,
        winner_handicap_delta: r.winner_handicap_delta ?? null,
        loser_handicap_delta: r.loser_handicap_delta ?? null,

        finish_reason: (r.end_reason ?? r.finish_reason ?? null) as string | null,
        affects_rating: typeof r.affects_rating === 'boolean' ? r.affects_rating : null,
        is_tournament: true,
        tournament_name: 'Finals',
      }));

    // tournaments（通常matches由来）
    const tournamentIds = uniqStrings(rows.map((r) => r.tournament_id));
    const tournamentMap = new Map<string, TournamentRow>();
    if (tournamentIds.length > 0) {
      const { data: tRows } = await supabase.from('tournaments').select('id,name').in('id', tournamentIds);
      (tRows ?? []).forEach((t: any) => tournamentMap.set(String(t.id), t));
    }

    // unified feed（既存仕様：通常matches分のみ）
    const matchIds = rows.map((r) => r.id);
    const unifiedMap = new Map<string, UnifiedRow>();
    if (matchIds.length > 0) {
      const { data: uRows } = await supabase
        .from('unified_match_feed')
        .select(
          [
            'id',
            'mode',
            'status',
            'match_date',
            'winner_id',
            'loser_id',
            'winner_score',
            'loser_score',
            'winner_points_delta',
            'loser_points_delta',
            'winner_handicap_delta',
            'loser_handicap_delta',
            'winner_name',
            'loser_name',
            'winner_avatar_url',
            'loser_avatar_url',
            'finish_reason',
            'affects_rating',
          ].join(','),
        )
        .in('id', matchIds);

      (uRows ?? []).forEach((u: any) => unifiedMap.set(String(u.id), u as UnifiedRow));
    }

    // players（fallback補完）：通常rows + finals
    const playerIds = uniqStrings([
      ...rows.flatMap((r) => [r.winner_id, r.loser_id]),
      ...finalsAsDetails.flatMap((r) => [r.winner_id ?? null, r.loser_id ?? null]),
    ]);

    const playerMap = new Map<string, PlayerRow>();
    if (playerIds.length > 0) {
      const { data: pRows } = await supabase
        .from('players')
        .select('id,handle_name,avatar_url,ranking_points,handicap')
        .in('id', playerIds);

      (pRows ?? []).forEach((p: any) => playerMap.set(String(p.id), p));
    }

    // teams（通常matchesのみ）
    const matchTeams: MatchTeamRow[] = [];
    if (matchIds.length > 0) {
      const { data: mtRows } = await supabase.from('match_teams').select('match_id,team_id,team_no').in('match_id', matchIds);

      (mtRows ?? []).forEach((x: any) =>
        matchTeams.push({
          match_id: String(x.match_id),
          team_id: String(x.team_id),
          team_no: Number(x.team_no),
        }),
      );
    }

    const teamIds = Array.from(new Set(matchTeams.map((x) => x.team_id)));
    const teamMap = new Map<string, TeamRow>();
    if (teamIds.length > 0) {
      const { data: teamRows } = await supabase.from('teams').select('id,name').in('id', teamIds);
      (teamRows ?? []).forEach((t: any) => teamMap.set(String(t.id), t));
    }

    const mtMap = new Map<string, Map<number, string>>();
    for (const mt of matchTeams) {
      if (!mtMap.has(mt.match_id)) mtMap.set(mt.match_id, new Map());
      mtMap.get(mt.match_id)!.set(mt.team_no, mt.team_id);
    }

    // 通常matches → MatchDetails
    // ✅ unified(view)優先は維持しつつ、無ければ matches 本体の delta/finish/affects を使う
    const normalOut: MatchDetails[] = rows.map((r) => {
      const mode = normalizeMode(r.mode);
      const t = r.tournament_id ? tournamentMap.get(r.tournament_id) : undefined;
      const isTournament = typeof r.is_tournament === 'boolean' ? r.is_tournament : !!r.tournament_id;
      const u = unifiedMap.get(r.id);

      const wid = r.winner_id ?? u?.winner_id ?? null;
      const lid = r.loser_id ?? u?.loser_id ?? null;

      const wp = wid ? playerMap.get(wid) : undefined;
      const lp = lid ? playerMap.get(lid) : undefined;

      const map = mtMap.get(r.id);
      const wTeamId = map && r.winner_team_no != null ? map.get(r.winner_team_no) ?? null : null;
      const lTeamId = map && r.loser_team_no != null ? map.get(r.loser_team_no) ?? null : null;
      const wTeam = wTeamId ? teamMap.get(wTeamId) : undefined;
      const lTeam = lTeamId ? teamMap.get(lTeamId) : undefined;

      // matches 本体の delta（列名ゆれ吸収）
      const rWpd = pickDeltaNumber(r, ['winner_points_delta', 'winner_points_change']);
      const rLpd = pickDeltaNumber(r, ['loser_points_delta', 'loser_points_change']);
      const rWhd = pickDeltaNumber(r, ['winner_handicap_delta', 'winner_handicap_change']);
      const rLhd = pickDeltaNumber(r, ['loser_handicap_delta', 'loser_handicap_change']);
      const rAffects = pickBoolOrNull((r as any).affects_rating);
      const rFinish =
        pickStringOrNull((r as any).finish_reason) ?? pickStringOrNull((r as any).end_reason) ?? null;

      return {
        id: r.id,
        match_date: (r.match_date ?? u?.match_date ?? r.created_at ?? new Date().toISOString()) as string,
        mode: mode ?? u?.mode ?? null,

        winner_id: wid,
        loser_id: lid,

        winner_name: u?.winner_name ?? wp?.handle_name ?? null,
        loser_name: u?.loser_name ?? lp?.handle_name ?? null,

        winner_avatar_url: u?.winner_avatar_url ?? wp?.avatar_url ?? null,
        loser_avatar_url: u?.loser_avatar_url ?? lp?.avatar_url ?? null,

        winner_score: (u?.winner_score ?? r.winner_score ?? 15) as number,
        loser_score: (u?.loser_score ?? r.loser_score ?? 0) as number,

        winner_points_delta: u?.winner_points_delta ?? rWpd ?? null,
        loser_points_delta: u?.loser_points_delta ?? rLpd ?? null,
        winner_handicap_delta: u?.winner_handicap_delta ?? rWhd ?? null,
        loser_handicap_delta: u?.loser_handicap_delta ?? rLhd ?? null,

        finish_reason: u?.finish_reason ?? rFinish,
        affects_rating: typeof u?.affects_rating === 'boolean' ? u.affects_rating : rAffects,

        winner_team_id: wTeamId,
        winner_team_name: wTeam?.name ?? null,
        loser_team_id: lTeamId,
        loser_team_name: lTeam?.name ?? null,

        is_tournament: isTournament,
        tournament_name: t?.name ?? null,
        venue: r.venue ?? null,
        notes: r.notes ?? null,

        winner_current_points: wp?.ranking_points ?? null,
        loser_current_points: lp?.ranking_points ?? null,
        winner_current_handicap: wp?.handicap ?? null,
        loser_current_handicap: lp?.handicap ?? null,
      };
    });

    // finals（名前/アバター補完）
    const finalsOut: MatchDetails[] = finalsAsDetails.map((m) => {
      const wp = m.winner_id ? playerMap.get(m.winner_id) : undefined;
      const lp = m.loser_id ? playerMap.get(m.loser_id) : undefined;

      return {
        ...m,
        winner_name: m.winner_name ?? wp?.handle_name ?? null,
        loser_name: m.loser_name ?? lp?.handle_name ?? null,
        winner_avatar_url: m.winner_avatar_url ?? wp?.avatar_url ?? null,
        loser_avatar_url: m.loser_avatar_url ?? lp?.avatar_url ?? null,
      };
    });

    // 最終：通常 + finals を時系列で統合
    const combined = [...normalOut, ...finalsOut].sort((a, b) => {
      const at = new Date(a.match_date).getTime();
      const bt = new Date(b.match_date).getTime();
      return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
    });

    if (mountedRef.current) {
      setMatches(combined);
      setLoading(false);
    }
  }, []);

  const refetch = useCallback(async () => {
    setRetrying(true);
    await fetchAll();
    if (mountedRef.current) setRetrying(false);
  }, [fetchAll]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchAll();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchAll]);

  return { matches, loading, error, retrying, refetch };
}
