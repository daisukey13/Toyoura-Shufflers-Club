import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

console.log('Supabase設定:', {
  url: supabaseUrl,
  hasKey: !!supabaseAnonKey
})

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

// シンプルなクライアント（モバイル対応）
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false, // セッションを保持しない
    autoRefreshToken: false, // 自動更新を無効化
    detectSessionInUrl: false
  },
  realtime: {
    enabled: false // リアルタイム機能を無効化
  }
})

// プリセットアバターの取得
export async function getPresetAvatars() {
  try {
    console.log('getPresetAvatars関数が呼ばれました');
    
    const { data, error } = await supabase.storage
      .from('avatars')
      .list('preset', {
        limit: 100,
        offset: 0
      })

    if (error) {
      console.error('アバターリスト取得エラー:', error)
      throw error
    }

    if (!data || data.length === 0) {
      console.log('アバターが見つかりません')
      return []
    }

    console.log('取得したファイル数:', data.length);

    // 各ファイルの公開URLを生成
    const avatarsWithUrls = data
      .filter(file => file.name && !file.name.startsWith('.')) // 隠しファイルを除外
      .map(file => {
        const { data: { publicUrl } } = supabase.storage
          .from('avatars')
          .getPublicUrl(`preset/${file.name}`)
        
        console.log(`アバターURL: ${file.name} -> ${publicUrl}`) // デバッグ用
        
        return {
          name: file.name,
          url: publicUrl
        }
      })

    console.log('最終的なアバター配列:', avatarsWithUrls);
    return avatarsWithUrls
  } catch (error) {
    console.error('getPresetAvatars エラー:', error)
    return []
  }
}

// プレーヤーの作成
export async function createPlayer(handleName, fullName, avatarUrl) {
  console.log('createPlayer called with:', { handleName, fullName, avatarUrl });
  
  try {
    const { data, error } = await supabase
      .from('players')
      .insert([{ 
        handle_name: handleName,
        full_name: fullName,
        avatar_url: avatarUrl,
        handicap: 30,
        ranking_points: 1000,
        matches_played: 0,
        wins: 0,
        losses: 0,
        is_active: true
      }])
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }
    
    console.log('Player created successfully:', data);
    return data;
  } catch (error) {
    console.error('createPlayer error details:', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code
    });
    throw error;
  }
}

// プレーヤーの取得
export async function getPlayers() {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

// スコアの保存
export async function saveScore(playerId, score) {
  const { data, error } = await supabase
    .from('scores')
    .insert([{ player_id: playerId, score }])
    .select()
    .single()

  if (error) throw error
  return data
}

// ランキングの取得
export async function getTopScores(limit = 10) {
  const { data, error } = await supabase
    .from('scores')
    .select(`
      *,
      player:players(*)
    `)
    .order('score', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data
}