// types/matches.ts

export interface Match {
  id: string;
  match_date: string;
  winner_id: string;
  loser_id: string;
  winner_score: number;
  loser_score: number;
  winner_type?: string;
  tournament_id?: string;
  is_tournament: boolean;
  winner_points_change: number;
  loser_points_change: number;
  winner_handicap_change: number;
  loser_handicap_change: number;
  venue?: string;
  notes?: string;
  is_verified: boolean;
  submitted_by?: string;
  registered_by?: string;
  created_at: string;
  updated_at: string;
}

export interface MatchDetails extends Match {
  winner_name: string;
  winner_avatar: string;
  winner_current_points: number;
  winner_current_handicap: number;
  loser_name: string;
  loser_avatar: string;
  loser_current_points: number;
  loser_current_handicap: number;
  tournament_name?: string;
  tournament_bonus?: number;
  submitted_by_name?: string;
  registered_by_name?: string;
}

export interface MatchFormData {
  match_date: string;
  winner_id: string;
  loser_id: string;
  loser_score: number;
  tournament_id?: string;
  venue?: string;
  notes?: string;
}

export interface Tournament {
  id: string;
  name: string;
  tournament_date: string;
  bonus_coefficient: number;
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
