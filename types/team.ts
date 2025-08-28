// /types/team.ts
export type Team = {
  id: string;
  name: string;
  avatar_url?: string | null;
  notes?: string | null;
  is_active: boolean;
  created_by?: string | null;
  created_at: string;
};

export type TeamMember = {
  team_id: string;
  player_id: string;
  role?: string | null;
  joined_at: string;
};

export type TeamStats = {
  id: string;
  name: string;
  avatar_url?: string | null;
  notes?: string | null;
  is_active: boolean;
  created_by?: string | null;
  created_at: string;
  member_count: number;
  avg_ranking_points: number | null;
  avg_handicap: number | null;
};
