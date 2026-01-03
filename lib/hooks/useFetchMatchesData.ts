// lib/hooks/useFetchMatchesData.ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

type MatchRow = {
  id: string;
  match_date: string | null;
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

  // optional (ある環境だけ)
  end_reason?: string | null;
  time_limit_seconds?: number | null;
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

  // finish meta（unified view）
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

  // 互換用（必要なら使える）
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

/** ✅ 最小修正：matches の戻りが any / エラー配列混在でも落ちないように MatchRow だけ通す */
function isMatchRow(v: unknown): v is MatchRow {
  if (!v || typeof v !== 'object') return false;
  const o = v as any;
  return (
    typeof o.id === 'string' &&
    ('match_date' in o) &&
    ('mode' in o) &&
    ('status' in o)
  );
}

function isFinalized(row: MatchRow): boolean {
  if (row.status !== 'finalized') return false;
  const mode = normalizeMode(row.mode);
  if (mode === 'singles') return !!row.winner_id && !!row.loser_id;
  if (mode === 'teams') return true;
  return false;
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

    const { data: mRows, error: mErr } = await supabase
      .from('matches')
      .select(
        [
          'id',
          'match_date',
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
      )
      .order('match_date', { ascending: false })
      .limit(500);

    if (mErr) {
      if (mountedRef.current) {
        setError(mErr.message);
        setLoading(false);
      }
      return;
    }

    // ✅ ここが今回の本命：危険な as MatchRow[] をやめて型ガードで絞る
    const allRows = (Array.isArray(mRows) ? mRows : []).filter(isMatchRow);
    const rows = allRows.filter(isFinalized);

    // tournaments
    const tournamentIds = Array.from(
      new Set(rows.map((r) => r.tournament_id).filter((v): v is string => !!v)),
    );
    const tournamentMap = new Map<string, TournamentRow>();
    if (tournamentIds.length > 0) {
      const { data: tRows } = await supabase
        .from('tournaments')
        .select('id,name')
        .in('id', tournamentIds);

      (tRows ?? []).forEach((t: any) => tournamentMap.set(String(t.id), t));
    }

    // unified feed (names/avatars/deltas/finish meta)
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

    // players （fallback補完）
    const playerIds = Array.from(
      new Set(
        rows
          .flatMap((r) => [r.winner_id, r.loser_id])
          .filter((v): v is string => !!v),
      ),
    );
    const playerMap = new Map<string, PlayerRow>();
    if (playerIds.length > 0) {
      const { data: pRows } = await supabase
        .from('players')
        .select('id,handle_name,avatar_url,ranking_points,handicap')
        .in('id', playerIds);

      (pRows ?? []).forEach((p: any) => playerMap.set(String(p.id), p));
    }

    // teams
    const matchTeams: MatchTeamRow[] = [];
    if (matchIds.length > 0) {
      const { data: mtRows } = await supabase
        .from('match_teams')
        .select('match_id,team_id,team_no')
        .in('match_id', matchIds);

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

    const out: MatchDetails[] = rows.map((r) => {
      const mode = normalizeMode(r.mode);
      const t = r.tournament_id ? tournamentMap.get(r.tournament_id) : undefined;

      const isTournament =
        typeof r.is_tournament === 'boolean' ? r.is_tournament : !!r.tournament_id;

      const u = unifiedMap.get(r.id);

      // singles
      const wid = r.winner_id ?? u?.winner_id ?? null;
      const lid = r.loser_id ?? u?.loser_id ?? null;

      const wp = wid ? playerMap.get(wid) : undefined;
      const lp = lid ? playerMap.get(lid) : undefined;

      // teams
      const map = mtMap.get(r.id);
      const wTeamId =
        map && r.winner_team_no != null ? map.get(r.winner_team_no) ?? null : null;
      const lTeamId =
        map && r.loser_team_no != null ? map.get(r.loser_team_no) ?? null : null;
      const wTeam = wTeamId ? teamMap.get(wTeamId) : undefined;
      const lTeam = lTeamId ? teamMap.get(lTeamId) : undefined;

      return {
        id: r.id,
        match_date: (r.match_date ?? u?.match_date ?? new Date().toISOString()) as string,
        mode: mode ?? u?.mode ?? null,

        winner_id: wid,
        loser_id: lid,

        winner_name: u?.winner_name ?? wp?.handle_name ?? null,
        loser_name: u?.loser_name ?? lp?.handle_name ?? null,

        winner_avatar_url: u?.winner_avatar_url ?? wp?.avatar_url ?? null,
        loser_avatar_url: u?.loser_avatar_url ?? lp?.avatar_url ?? null,

        winner_score: (u?.winner_score ?? r.winner_score ?? 15) as number,
        loser_score: (u?.loser_score ?? r.loser_score ?? 0) as number,

        // delta統一（view優先）
        winner_points_delta: u?.winner_points_delta ?? null,
        loser_points_delta: u?.loser_points_delta ?? null,
        winner_handicap_delta: u?.winner_handicap_delta ?? null,
        loser_handicap_delta: u?.loser_handicap_delta ?? null,

        finish_reason: u?.finish_reason ?? null,
        affects_rating: typeof u?.affects_rating === 'boolean' ? u.affects_rating : null,

        winner_team_id: wTeamId,
        winner_team_name: wTeam?.name ?? null,
        loser_team_id: lTeamId,
        loser_team_name: lTeam?.name ?? null,

        is_tournament: isTournament,
        tournament_name: t?.name ?? null,
        venue: r.venue ?? null,
        notes: r.notes ?? null,

        // 互換（表示で使うなら）
        winner_current_points: wp?.ranking_points ?? null,
        loser_current_points: lp?.ranking_points ?? null,
        winner_current_handicap: wp?.handicap ?? null,
        loser_current_handicap: lp?.handicap ?? null,
      };
    });

    if (mountedRef.current) {
      setMatches(out);
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
