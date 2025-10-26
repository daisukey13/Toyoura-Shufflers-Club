// contexts/debug-AuthContext.tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/browserClient";

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
};

type AuthState = {
  user: User | null | undefined;
  player: PlayerRow | null;
  isAdmin: boolean;
  loading: boolean;
  refreshAuth: () => Promise<void>;
  signOut: () => Promise<void>;
};

const DebugAuthContext = createContext<AuthState>({
  user: undefined,
  player: null,
  isAdmin: false,
  loading: true,
  refreshAuth: async () => {},
  signOut: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const reqIdRef = useRef(0);

  const fetchPlayerByUserId = async (uid: string) => {
    const { data: raw, error } = await (supabase.from("players") as any)
      .select(
        "id,auth_user_id,user_id,handle_name,team_name,is_admin,is_active,is_deleted,avatar_url,display_name",
      )
      .or(`auth_user_id.eq.${uid},user_id.eq.${uid}`)
      .eq("is_deleted", false as any)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("[debug-AuthContext] fetchPlayer error:", error);
      return null;
    }
    if (!raw) return null;

    const d = raw as any;
    const merged: PlayerRow = {
      id: String(d.id),
      auth_user_id: d.auth_user_id ?? null,
      user_id: d.user_id ?? null,
      handle_name: d.handle_name ?? null,
      team_name: d.team_name ?? null,
      is_admin: typeof d.is_admin === "boolean" ? d.is_admin : null,
      is_active: typeof d.is_active === "boolean" ? d.is_active : null,
      is_deleted: typeof d.is_deleted === "boolean" ? d.is_deleted : null,
      display_name: d.display_name ?? d.handle_name ?? d.team_name ?? null,
      avatar_url: d.avatar_url ?? null,
    };

    return merged;
  };

  const applySession = async () => {
    setLoading(true);
    const myReq = ++reqIdRef.current;

    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();
    if (error) console.warn("[debug-AuthContext] getSession error:", error);

    if (myReq !== reqIdRef.current) return;

    const currentUser = session?.user ?? null;
    setUser(currentUser);
    console.log("[debug-AuthContext] user:", currentUser?.id);

    if (currentUser) {
      const p = await fetchPlayerByUserId(currentUser.id);
      if (myReq !== reqIdRef.current) return;
      setPlayer(p);
      setIsAdmin(!!p?.is_admin);
      console.log("[debug-AuthContext] player:", p);
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
      if (error) console.warn("[debug-AuthContext] signOut error:", error);
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

    const { data: sub } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
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
      },
    );

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
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
    [user, player, isAdmin, loading],
  );

  return (
    <DebugAuthContext.Provider value={value}>
      {children}
    </DebugAuthContext.Provider>
  );
};

export const useAuth = () => useContext(DebugAuthContext);
