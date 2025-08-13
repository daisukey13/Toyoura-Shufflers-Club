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
  // 必要に応じて他カラムを追加
};

type AuthState = {
  user: User | undefined;          // 未判定: undefined / 未ログイン: null / ログイン中: User
  player: PlayerRow | null;
  isAdmin: boolean;
  loading: boolean;
  refreshAuth: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  user: undefined,
  player: null,
  isAdmin: false,
  loading: true,
  refreshAuth: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | undefined>(undefined);
  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // 競合防止用のリクエストID
  const reqIdRef = useRef(0);

  const fetchPlayerByUserId = async (uid: string) => {
    // auth_user_id 優先。存在しない場合に user_id をフォールバック
    const { data, error } = await supabase
      .from('players')
      .select(
        'id, auth_user_id, user_id, handle_name, is_admin, is_active, is_deleted'
      )
      .or(`auth_user_id.eq.${uid},user_id.eq.${uid}`)
      .eq('is_deleted', false)
      .limit(1)
      .maybeSingle();

    if (error) {
      // コンソールに留める（UIには出さない）
      console.warn('[AuthContext] fetchPlayer error:', error);
      return null;
    }
    return (data as PlayerRow | null) ?? null;
  };

  const applySession = async () => {
    setLoading(true);
    const myReqId = ++reqIdRef.current;

    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      console.warn('[AuthContext] getSession error:', error);
    }

    // 競合ガード：古いリクエストは破棄
    if (myReqId !== reqIdRef.current) return;

    const currentUser = session?.user ?? null;
    setUser(currentUser ?? null);

    if (currentUser) {
      const p = await fetchPlayerByUserId(currentUser.id);
      if (myReqId !== reqIdRef.current) return;
      setPlayer(p);
      setIsAdmin(!!p?.is_admin);
    } else {
      setPlayer(null);
      setIsAdmin(false);
    }

    setLoading(false);
  };

  // 公開API：手動で最新化
  const refreshAuth = async () => {
    await applySession();
  };

  // 初期化：初回マウント時にセッション適用
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!mounted) return;
      await applySession();
    })();

    // セッション変更の購読
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      // ここで即時反映（軽量に）
      setUser(session?.user ?? null);
      // プレイヤー情報は別リクエスト（競合ガード付き）
      if (session?.user?.id) {
        const myReqId = ++reqIdRef.current;
        const p = await fetchPlayerByUserId(session.user.id);
        if (myReqId !== reqIdRef.current) return;
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
    }),
    [user, player, isAdmin, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
