// contexts/AuthContext.tsx

'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Player } from '@/types/player';

interface AuthContextType {
  isAdmin: boolean;
  adminPlayer: Player | null;
  login: (handleName: string, password: string) => Promise<boolean>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const supabase = createClient();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPlayer, setAdminPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // セッションストレージから管理者情報を復元
    const storedAdmin = sessionStorage.getItem('adminPlayer');
    if (storedAdmin) {
      const player = JSON.parse(storedAdmin);
      setAdminPlayer(player);
      setIsAdmin(true);
    }
    setLoading(false);
  }, []);

  const login = async (handleName: string, password: string): Promise<boolean> => {
    try {
      // ハードコードされた認証情報をチェック
      if (handleName === 'admin' && password === '31121963') {
        // adminプレイヤーの情報を取得
        const { data, error } = await supabase
          .from('players')
          .select('*')
          .eq('handle_name', 'admin')
          .eq('is_admin', true)
          .single();

        if (error) {
          // adminプレイヤーが存在しない場合は作成
          const { data: newAdmin, error: createError } = await supabase
            .from('players')
            .insert({
              handle_name: 'admin',
              full_name: '管理者',
              email: 'admin@shuffleboard.com',
              phone: '000-0000-0000',
              is_admin: true,
              is_active: true,
              ranking_points: 9999,
              handicap: 0,
            })
            .select()
            .single();

          if (!createError && newAdmin) {
            setAdminPlayer(newAdmin);
            setIsAdmin(true);
            sessionStorage.setItem('adminPlayer', JSON.stringify(newAdmin));
            return true;
          }
          return false;
        }

        if (data) {
          setAdminPlayer(data);
          setIsAdmin(true);
          sessionStorage.setItem('adminPlayer', JSON.stringify(data));
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  };

  const logout = () => {
    setIsAdmin(false);
    setAdminPlayer(null);
    sessionStorage.removeItem('adminPlayer');
  };

  return (
    <AuthContext.Provider value={{ isAdmin, adminPlayer, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};