// contexts/AuthContext.tsx
'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

// ★ ここで 1 度だけ取得（client.ts 側が __supabase__ に固定しているため多重生成を防げます）
const supabase = createClient();

type PlayerRow = {
  id: string;
  auth_user_id: string | null;
  user_id: string | null;
  handle_name: string | null;
  team_name?: string | null;
  is_admin: boolean | null;
  is_active: boolean | null;
  is_deleted: boolean | null;
  // UI 派生
  display_name?: string | null;
  avatar_url?: string | null;
  email?: string | null;
};

type AuthState = {
  user: User | null | undefined; // 未判定: undefined / 未ログイン: null / ログイン中: User
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

  // 競合防止（同時リクエストの世代管理）
  const reqIdRef = useRef(0);
  // StrictMode の二重実行対策（購読の多重化を抑止）
  const subscribedRef = useRef(false);

  /** players から当該ユーザーのプレイヤー情報を取得し、表示名を合成（列差異にフォールバック） */
  const fetchPlayerByUserId = async (uid: string): Promise<PlayerRow | null> => {
    try {
      // まずは想定スキーマ
      let q = supabase
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
            'email',
          ].join(',')
        )
        .or(`auth_user_id.eq.${uid},user_id.eq.${uid}`)
        .eq('is_deleted', false)
        .limit(1)
        .maybeSingle();

      let res = await q;
      // 列差異（is_deleted 無し等）の場合は緩めに再試行
      if (res.error && /column .* does not exist/i.test(String(res.error.message))) {
        res = await supabase
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
              'avatar_url',
              'email',
            ].join(',')
          )
          .or(`auth_user_id.eq.${uid},user_id.eq.${uid}`)
          .limit(1)
          .maybeSingle();
      }

      if (res.error) {
        console.warn('[AuthContext] fetchPlayer error:', res.error);
        return null;
      }
      const row = (res.data ?? null) as PlayerRow | null;
      if (!row) return null;

      const merged: PlayerRow = {
        ...row,
        display_name: (row as any).display_name ?? row.handle_name ?? row.team_name ?? null,
      };
      return merged;
    } catch (e) {
      console.warn('[AuthContext] fetchPlayer exception:', e);
      return null;
    }
  };

  const applySession = async () => {
    setLoading(true);
    const myReq = ++reqIdRef.current;

    const { data, error } = await supabase.auth.getSession();
    if (error) console.warn('[AuthContext] getSession error:', error);

    // 古い要求は破棄
    if (myReq !== reqIdRef.current) return;

    const currentUser = data?.session?.user ?? null;
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
      // サーバ Cookie 同期を使っている場合のみ：
      // await fetch('/auth/callback', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ event:'SIGNED_OUT', session:null }) });
    } finally {
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

    // 開発の StrictMode でも二重購読しないようにガード
    if (subscribedRef.current) return () => {};
    subscribedRef.current = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);

      if (nextUser?.id) {
        const myReq = ++reqIdRef.current;
        const p = await fetchPlayerByUserId(nextUser.id);
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
      subscription?.unsubscribe();
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
