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
  is_admin: boolean | null;
  is_active: boolean | null;
  is_deleted: boolean | null;
};

type AuthState = {
  user: User | null | undefined;   // 未判定: undefined / 未ログイン: null / ログイン中: User
  player: PlayerRow | null;
  isAdmin: boolean;
  loading: boolean;
  refreshAuth: () => Promise<void>;
  signOut: () => Promise<void>;    // ← 追加（互換用）
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

  const fetchPlayerByUserId = async (uid: string) => {
    const { data, error } = await supabase
      .from('players')
      .select('id, auth_user_id, user_id, handle_name, is_admin, is_active, is_deleted')
      .or(`auth_user_id.eq.${uid},user_id.eq.${uid}`)
      .eq('is_deleted', false)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('[AuthContext] fetchPlayer error:', error);
      return null;
    }
    return (data as PlayerRow | null) ?? null;
  };

  const applySession = async () => {
    setLoading(true);
    const myReq = ++reqIdRef.current;

    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) console.warn('[AuthContext] getSession error:', error);
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

  // 追加：サインアウト（互換）
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
    () => ({ user, player, isAdmin, loading, refreshAuth, signOut }),
    [user, player, isAdmin, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
