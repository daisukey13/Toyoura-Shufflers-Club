// lib/supabase.js
'use client';

// ✅ ここで新しい client を作らない（Multiple GoTrueClient / ログアウト対策）
export { createClient, supabase } from '@/lib/supabase/client';

// 既存の util 関数は supabase(singleton) を使って動かす
import { supabase } from '@/lib/supabase/client';

// プリセットアバターの取得
export async function getPresetAvatars() {
  try {
    if (process.env.NODE_ENV !== 'production') {
      console.log('getPresetAvatars関数が呼ばれました');
    }

    const { data, error } = await supabase.storage.from('avatars').list('preset', {
      limit: 100,
      offset: 0,
    });

    if (error) {
      console.error('アバターリスト取得エラー:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      if (process.env.NODE_ENV !== 'production') console.log('アバターが見つかりません');
      return [];
    }

    const avatarsWithUrls = data
      .filter((file) => file?.name && !file.name.startsWith('.'))
      .map((file) => {
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(`preset/${file.name}`);

        return {
          name: file.name,
          url: urlData?.publicUrl || '',
        };
      })
      .filter((a) => a.url);

    return avatarsWithUrls;
  } catch (error) {
    console.error('getPresetAvatars エラー:', error);
    return [];
  }
}

// ⚠️ 注意：players 直INSERTは RLS により失敗する運用が多いです。
// いまの新規登録フローは /api/register/provision を使っているので、可能ならこちらは未使用にしてください。
export async function createPlayer(handleName, fullName, avatarUrl) {
  console.log('createPlayer called with:', { handleName, fullName, avatarUrl });

  const { data, error } = await supabase
    .from('players')
    .insert([
      {
        handle_name: handleName,
        full_name: fullName,
        avatar_url: avatarUrl,
        handicap: 30,
        ranking_points: 1000,
        matches_played: 0,
        wins: 0,
        losses: 0,
        is_active: true,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error('Supabase error:', error);
    throw error;
  }
  return data;
}

export async function getPlayers() {
  const { data, error } = await supabase.from('players').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function saveScore(playerId, score) {
  const { data, error } = await supabase.from('scores').insert([{ player_id: playerId, score }]).select().single();
  if (error) throw error;
  return data;
}

export async function getTopScores(limit = 10) {
  const { data, error } = await supabase
    .from('scores')
    .select(
      `
      *,
      player:players(*)
    `
    )
    .order('score', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}
