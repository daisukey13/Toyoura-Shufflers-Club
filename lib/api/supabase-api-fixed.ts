// lib/api/supabase-api.ts
// Fetch APIベースの統一Supabaseクライアント（型エラー回避版）

import { ENV } from '@/lib/config/env';

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  status: number;
}

interface RetryOptions {
  maxRetries?: number;
  retryDelay?: number;
  onRetry?: (attempt: number, error: any) => void;
}

export class SupabaseAPI {
  private static baseUrl = ENV.SUPABASE_URL;
  private static apiKey = ENV.SUPABASE_ANON_KEY;
  
  private static headers = {
    'apikey': SupabaseAPI.apiKey,
    'Authorization': `Bearer ${SupabaseAPI.apiKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  private static async fetchWithRetry<T>(
    endpoint: string,
    options: RequestInit = {},
    retryOptions: RetryOptions = {}
  ): Promise<ApiResponse<T>> {
    const { maxRetries = 3, retryDelay = 1000, onRetry } = retryOptions;
    
    let lastError: any;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          ...options,
          headers: {
            ...this.headers,
            ...options.headers,
          },
        });

        const data = await response.json().catch(() => null);
        
        if (!response.ok) {
          throw {
            status: response.status,
            statusText: response.statusText,
            data
          };
        }

        return {
          data: data as T,
          error: null,
          status: response.status
        };
      } catch (error: any) {
        lastError = error;
        
        if (attempt < maxRetries - 1) {
          if (onRetry) {
            onRetry(attempt + 1, error);
          }
          await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
        }
      }
    }
    
    return {
      data: null,
      error: lastError?.message || 'Network request failed',
      status: lastError?.status || 500
    };
  }

  // === Players API ===
  static async getPlayers(options?: {
    orderBy?: string;
    limit?: number;
    offset?: number;
  }): Promise<ApiResponse<any[]>> {
    const params = new URLSearchParams();
    if (options?.orderBy) params.append('order', options.orderBy);
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.offset) params.append('offset', options.offset.toString());
    
    const queryString = params.toString();
    const endpoint = `/rest/v1/players${queryString ? `?${queryString}` : ''}`;
    
    return this.fetchWithRetry<any[]>(endpoint);
  }

  static async getPlayerById(id: string): Promise<ApiResponse<any>> {
    const response = await this.fetchWithRetry<any[]>(
      `/rest/v1/players?id=eq.${id}`,
      { method: 'GET' }
    );
    
    if (response.data && response.data.length > 0) {
      return { ...response, data: response.data[0] };
    }
    
    return { data: null, error: 'Player not found', status: 404 };
  }

  static async searchPlayers(query: string): Promise<ApiResponse<any[]>> {
    const endpoint = `/rest/v1/players?or=(full_name.ilike.*${query}*,handle_name.ilike.*${query}*)`;
    return this.fetchWithRetry<any[]>(endpoint);
  }

  static async updatePlayer(id: string, updates: any): Promise<ApiResponse<any>> {
    const response = await this.fetchWithRetry<any[]>(
      `/rest/v1/players?id=eq.${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(updates)
      }
    );
    
    if (response.data && response.data.length > 0) {
      return { ...response, data: response.data[0] };
    }
    
    return { data: null, error: response.error || "Player not found", status: 404 };
  }

  static async createPlayer(data: any): Promise<ApiResponse<any>> {
    const playerData = {
      ...data,
      handicap: 30,
      ranking_points: 1000,
      matches_played: 0,
      wins: 0,
      losses: 0,
      is_active: true,
      is_admin: false
    };
    
    const response = await this.fetchWithRetry<any[]>(
      '/rest/v1/players',
      {
        method: 'POST',
        body: JSON.stringify(playerData)
      }
    );
    
    if (response.data && response.data.length > 0) {
      return { ...response, data: response.data[0] };
    }
    
    return { data: null, error: response.error || "Failed to create player", status: 400 };
  }

  // === Matches API ===
  static async getMatches(limit?: number): Promise<ApiResponse<any[]>> {
    const endpoint = limit 
      ? `/rest/v1/match_details?select=*&order=match_date.desc&limit=${limit}`
      : '/rest/v1/match_details?select=*&order=match_date.desc';
    
    return this.fetchWithRetry<any[]>(endpoint);
  }

  static async getMatchById(id: string): Promise<ApiResponse<any>> {
    const response = await this.fetchWithRetry<any[]>(
      `/rest/v1/match_details?match_id=eq.${id}`,
      { method: 'GET' }
    );
    
    if (response.data && response.data.length > 0) {
      return { ...response, data: response.data[0] };
    }
    
    return { data: null, error: 'Match not found', status: 404 };
  }

  static async createMatch(matchData: any): Promise<ApiResponse<any>> {
    const response = await this.fetchWithRetry<any>(
      '/rest/v1/matches',
      {
        method: 'POST',
        body: JSON.stringify(matchData)
      }
    );
    
    return response;
  }

  // === Auth Helper ===
  static async getCurrentUser(userId: string): Promise<ApiResponse<any>> {
    return this.getPlayerById(userId);
  }
}