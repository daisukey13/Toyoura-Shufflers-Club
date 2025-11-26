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

export interface MatchDetails {
  id: string;
  match_date: string;

  mode?: 'singles' | 'teams' | string | null;

  winner_id?: string | null;
  winner_name?: string | null;
  winner_avatar_url?: string | null;
  winner_current_points?: number | null;
  winner_current_handicap?: number | null;
  winner_points_change?: number | null;

  loser_id?: string | null;
  loser_name?: string | null;
  loser_avatar_url?: string | null;
  loser_score: number | null;
  loser_current_points?: number | null;
  loser_current_handicap?: number | null;
  loser_points_change?: number | null;

  winner_team_id?: string | null;
  winner_team_name?: string | null;
  loser_team_id?: string | null;
  loser_team_name?: string | null;

  is_tournament?: boolean | null;
  tournament_name?: string | null;
  venue?: string | null;
  notes?: string | null;
}

function normalizeMode(raw: string | null): 'singles' | 'teams' | string | null {
  if (!raw) return null;
  if (raw === 'player') return 'singles';
  return raw;
}

function isFinalized(row: MatchRow): boolean {
  // status が無い/曖昧な過去データもあるかもなので、最低限のガードを入れる
  if (row.status !== 'finalized') return false;

  const mode = normalizeMode(row.mode);

  if (mode === 'singles') {
    return !!row.winner_id && !!row.loser_id;
  }
  if (mode === 'teams') {
    return true;
  }
  // 未知の mode は安全側で落とす
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

    const allRows = (mRows ?? []) as MatchRow[];

    // ✅ 最小修正ポイント：結果が確定していないカードは「試合結果ページ」から除外
    const rows = allRows.filter(isFinalized);

    // （デバッグしたい場合だけ）
    // const dropped = allRows.length - rows.length;
    // if (dropped > 0) console.warn(`[useFetchMatchesData] dropped non-finalized rows: ${dropped}`);

    // tournament map
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

    // players map (for singles)
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

    // teams map (for teams)
    const matchIds = rows.map((r) => r.id);
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
      const { data: teamRows } = await supabase
        .from('teams')
        .select('id,name')
        .in('id', teamIds);

      (teamRows ?? []).forEach((t: any) => teamMap.set(String(t.id), t));
    }

    // match_id -> {team_no -> team_id}
    const mtMap = new Map<string, Map<number, string>>();
    for (const mt of matchTeams) {
      if (!mtMap.has(mt.match_id)) mtMap.set(mt.match_id, new Map());
      mtMap.get(mt.match_id)!.set(mt.team_no, mt.team_id);
    }

    const out: MatchDetails[] = rows.map((r) => {
      const mode = normalizeMode(r.mode);

      const t = r.tournament_id ? tournamentMap.get(r.tournament_id) : undefined;

      const isTournament =
        typeof r.is_tournament === 'boolean'
          ? r.is_tournament
          : !!r.tournament_id;

      // singles fields
      const wp = r.winner_id ? playerMap.get(r.winner_id) : undefined;
      const lp = r.loser_id ? playerMap.get(r.loser_id) : undefined;

      // teams fields
      const map = mtMap.get(r.id);
      const wTeamId =
        map && r.winner_team_no != null ? map.get(r.winner_team_no) ?? null : null;
      const lTeamId =
        map && r.loser_team_no != null ? map.get(r.loser_team_no) ?? null : null;

      const wTeam = wTeamId ? teamMap.get(wTeamId) : undefined;
      const lTeam = lTeamId ? teamMap.get(lTeamId) : undefined;

      return {
        id: r.id,
        match_date: r.match_date ?? new Date().toISOString(),
        mode,

        winner_id: r.winner_id,
        winner_name: wp?.handle_name ?? null,
        winner_avatar_url: wp?.avatar_url ?? null,
        winner_current_points: wp?.ranking_points ?? null,
        winner_current_handicap: wp?.handicap ?? null,
        winner_points_change: 0,

        loser_id: r.loser_id,
        loser_name: lp?.handle_name ?? null,
        loser_avatar_url: lp?.avatar_url ?? null,
        loser_score: r.loser_score ?? 0,
        loser_current_points: lp?.ranking_points ?? null,
        loser_current_handicap: lp?.handicap ?? null,
        loser_points_change: 0,

        winner_team_id: wTeamId,
        winner_team_name: wTeam?.name ?? null,
        loser_team_id: lTeamId,
        loser_team_name: lTeam?.name ?? null,

        is_tournament: isTournament,
        tournament_name: t?.name ?? null,
        venue: r.venue ?? null,
        notes: r.notes ?? null,
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
