// contexts/AuthContext.tsx
'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
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

/**
 * サーバ側(cookie)へセッション同期（/auth/whoami が cookie で true になるため）
 */
async function syncSessionToServer(event: string, session: Session | null) {
  try {
    const payload = {
      event,
      session: session
        ? {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_at: session.expires_at ?? null,
          }
        : null,
    };

    await fetch('/auth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      cache: 'no-store',
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn('[AuthContext] syncSessionToServer failed:', e);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // 競合防止（リクエストの世代管理）
  const reqIdRef = useRef(0);

  // cookie同期の多重送信防止（トークンが変わった時だけ送る）
  const lastSyncedRef = useRef<{ at: string | null; rt: string | null }>({ at: null, rt: null });

  const fetchPlayerByUserId = async (uid: string): Promise<PlayerRow | null> => {
    try {
      const res = await supabase
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

      if (res.error) {
        console.warn('[AuthContext] fetchPlayer error:', res.error);
        return null;
      }

      const row = (res.data ?? null) as PlayerRow | null;
      if (!row) return null;

      return {
        ...row,
        display_name: (row as any).display_name ?? row.handle_name ?? row.team_name ?? null,
      };
    } catch (e) {
      console.warn('[AuthContext] fetchPlayer exception:', e);
      return null;
    }
  };

  const maybeSyncCookie = async (event: string, session: Session | null) => {
    const at = session?.access_token ?? null;
    const rt = session?.refresh_token ?? null;

    // SIGNED_OUT は必ず送る（cookieを消すため）
    if (event === 'SIGNED_OUT') {
      lastSyncedRef.current = { at: null, rt: null };
      await syncSessionToServer(event, null);
      return;
    }

    // トークンが変わっていなければ送らない（ループ/負荷対策）
    if (at && rt) {
      if (lastSyncedRef.current.at === at && lastSyncedRef.current.rt === rt) return;
      lastSyncedRef.current = { at, rt };
      await syncSessionToServer(event, session);
    }
  };

  const applySession = async () => {
    setLoading(true);
    const myReq = ++reqIdRef.current;

    const { data, error } = await supabase.auth.getSession();
    if (error) console.warn('[AuthContext] getSession error:', error);

    if (myReq !== reqIdRef.current) return;

    const session = data?.session ?? null;

    // 初回描画でも cookie 同期を試みる
    await maybeSyncCookie('SESSION_CHECK', session);

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
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) console.warn('[AuthContext] signOut error:', error);
    } finally {
      await maybeSyncCookie('SIGNED_OUT', null);
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

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      await maybeSyncCookie(event, session ?? null);

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
      subscription.unsubscribe();
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
