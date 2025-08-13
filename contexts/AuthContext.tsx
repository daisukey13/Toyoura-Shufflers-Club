// contexts/AuthContext.tsx
'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/browserClient';

type PlayerRow = {
  id: string;
  auth_user_id: string | null;
  user_id: string | null;
  handle_name: string | null;
  team_name?: string | null;
  is_admin: boolean | null;
  is_active: boolean | null;
  is_deleted: boolean | null;
  // DBに存在しなくてもOKな派生フィールド（UI用）
  display_name?: string | null;
  avatar_url?: string | null;
};

type AuthState = {
  // 未判定: undefined / 未ログイン: null / ログイン中: User
  user: User | null | undefined;
  player: PlayerRow | null;
  isAdmin: boolean;
  loading: boolean;
  refreshAuth: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  user: undefined,
  player: null,
  isAdmin: false,
  loading: true,
  refreshAuth: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const reqIdRef = useRef(0);

  // players から当該ユーザーのプレイヤー情報を取得し、表示名を合成
  const fetchPlayerByUserId = async (uid: string) => {
    const { data, error } = await supabase
      .from('players')
      .select(
        [
          'id',
          'auth_user_id',
          'user_id',
          'handle_name',
          'team_name',
          'is_admin',
          'is_active',
          'is_deleted',
          'avatar_url',
        ].join(','),
      )
      .or(`auth_user_id.eq.${uid},user_id.eq.${uid}`)
      .eq('is_deleted', false)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('[AuthContext] fetchPlayer error:', error);
      return null;
    }
    if (!data) return null;

    const merged: PlayerRow = {
      ...data,
      display_name:
        // 将来 display_name カラムが追加された場合に備えて拾う
        (data as any).display_name ??
        data.handle_name ??
        (data as any).team_name ??
        null,
    };

    return merged;
  };

  const applySession = async () => {
    setLoading(true);
    const myReq = ++reqIdRef.current;

    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) console.warn('[AuthContext] getSession error:', error);

    // 古いリクエストは破棄
    if (myReq !== reqIdRef.current) return;

    const currentUser = session?.user ?? null;
    setUser(currentUser);

    if (currentUser) {
      const p = await fetchPlayerByUserId(currentUser.id);
      if (myReq !== reqIdRef.current) return;
      setPlayer(p);
      setIsAdmin(!!p?.is_admin);
    } else {
      setPlayer(null);
      setIsAdmin(false);
    }

    setLoading(false);
  };

  const refreshAuth = async () => {
    await applySession();
  };

  const signOut = async () => {
    try {
      setLoading(true);
      const { error } = await supabase.auth.signOut();
      if (error) console.warn('[AuthContext] signOut error:', error);
    } finally {
      // ローカル状態をクリア
      setUser(null);
      setPlayer(null);
      setIsAdmin(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!mounted) return;
      await applySession();
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null);

      if (session?.user?.id) {
        const myReq = ++reqIdRef.current;
        const p = await fetchPlayerByUserId(session.user.id);
        if (myReq !== reqIdRef.current) return;
        setPlayer(p);
        setIsAdmin(!!p?.is_admin);
      } else {
        setPlayer(null);
        setIsAdmin(false);
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      player,
      isAdmin,
      loading,
      refreshAuth,
      signOut,
    }),
    [user, player, isAdmin, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
