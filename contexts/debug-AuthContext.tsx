'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { User } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'

interface Player {
  id: string
  display_name: string
  is_admin: boolean
}

interface AuthContextType {
  user: User | null
  player: Player | null
  isAdmin: boolean
  loading: boolean
  signOut: () => Promise<void>
  refreshAuth: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  player: null,
  isAdmin: false,
  loading: true,
  signOut: async () => {},
  refreshAuth: async () => {},
})

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [player, setPlayer] = useState<Player | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  // プレーヤー情報を取得する関数
  const fetchPlayer = async (userId: string) => {
    console.log('Fetching player for user:', userId)
    
    const { data, error } = await supabase
      .from('players')
      .select('id, display_name, is_admin')
      .eq('user_id', userId)
      .single()

    if (error) {
      console.error('Error fetching player:', error)
      console.error('Error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      return null
    }

    console.log('Player data fetched successfully:', data)
  if (data) {
  console.log('Is admin?', data.is_admin);
  console.log('Display name:', data.display_name);
}

  // 認証状態を更新する関数
  const refreshAuth = async () => {
    console.log('refreshAuth: Starting auth refresh...')
    
    try {
      // 現在のセッションを取得
      const { data: { session }, error } = await supabase.auth.getSession()
      
      if (error) {
        console.error('refreshAuth: Error getting session:', error)
        setUser(null)
        setPlayer(null)
        setLoading(false)
        return
      }

      if (session?.user) {
        console.log('refreshAuth: Session found, user:', session.user.id)
        setUser(session.user)
        
        // プレーヤー情報を取得
        const playerData = await fetchPlayer(session.user.id)
        if (playerData) {
          console.log('refreshAuth: Setting player data:', playerData)
          setPlayer(playerData)
          console.log('refreshAuth: Player set with admin status:', playerData.is_admin)
        } else {
          console.log('refreshAuth: No player data found')
          setPlayer(null)
        }
      } else {
        console.log('refreshAuth: No session found')
        setUser(null)
        setPlayer(null)
      }
    } catch (error) {
      console.error('refreshAuth: Unexpected error:', error)
      setUser(null)
      setPlayer(null)
    } finally {
      console.log('refreshAuth: Setting loading to false')
      setLoading(false)
    }
  }

  // 初回マウント時とセッション変更時の処理
  useEffect(() => {
    console.log('AuthProvider: Component mounted, checking session...')
    
    // 初回の認証チェック
    refreshAuth()

    // 認証状態の変更を監視
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('AuthProvider: Auth state changed:', event, session?.user?.id)
      
      if (event === 'SIGNED_IN' && session) {
        console.log('AuthProvider: User signed in, updating state...')
        setUser(session.user)
        const playerData = await fetchPlayer(session.user.id)
        if (playerData) {
          console.log('AuthProvider: Player data in auth change:', playerData)
          setPlayer(playerData)
        }
        setLoading(false)
      } else if (event === 'SIGNED_OUT') {
        console.log('AuthProvider: User signed out')
        setUser(null)
        setPlayer(null)
        setLoading(false)
      } else if (event === 'TOKEN_REFRESHED' && session) {
        console.log('AuthProvider: Token refreshed')
        // トークンがリフレッシュされた場合も更新
        setUser(session.user)
        const playerData = await fetchPlayer(session.user.id)
        if (playerData) {
          setPlayer(playerData)
        }
        setLoading(false)
      }
    })

    return () => {
      console.log('AuthProvider: Cleaning up subscription')
      subscription.unsubscribe()
    }
  }, [])  // supabaseを依存配列から除外

  // ログアウト処理
  const signOut = async () => {
    try {
      console.log('signOut: Starting sign out process...')
      await supabase.auth.signOut()
      setUser(null)
      setPlayer(null)
      router.push('/')
    } catch (error) {
      console.error('signOut: Error signing out:', error)
    }
  }

  // isAdminの計算
  const isAdmin = player?.is_admin === true

  // デバッグ用：状態が更新されるたびにログ出力
  useEffect(() => {
    console.log('AuthProvider State Update:', {
      user: user?.id,
      player: player,
      isAdmin: isAdmin,
      loading: loading
    })
  }, [user, player, isAdmin, loading])

  const value = {
    user,
    player,
    isAdmin,
    loading,
    signOut,
    refreshAuth,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
