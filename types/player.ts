// types/player.ts
export interface Player {
  id: string;
  auth_user_id?: string;
  full_name: string;
  handle_name: string;
  email: string;
  phone?: string;
  address?: string;
  avatar_url?: string;
  team_id?: string;
  handicap: number;
  ranking_points: number;
  matches_played: number;
  wins: number;
  losses: number;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  current_rank?: number; // 現在順位（計算値）
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  created_at: string;
}
