// lib/hooks/useUpsertNotice.ts
'use client';

import { createClient } from '@/lib/supabase/client';
import type { Notice } from './useNotices';

export type NoticeInput = {
  title: string;
  content: string;
  /** YYYY-MM-DD */
  date: string;
  is_published: boolean;
};

export function useUpsertNotice() {
  const supabase = createClient();

  /** セッション必須の共通チェック */
  const requireSession = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error(error.message);
    const session = data?.session;
    if (!session) throw new Error('ログインが必要です');
    return session;
  };

  /** お知らせ作成 */
  const createNotice = async (input: NoticeInput): Promise<Notice> => {
    const session = await requireSession();

    const payload = {
      ...input,
      created_by: session.user.id,
    };

    const { data, error } = await supabase
      .from('notices')
      // 型生成を使っていない環境だと `never` 推論になるため any キャストで回避
      .insert(payload as any)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as Notice;
  };

  /** お知らせ更新 */
  const updateNotice = async (
    id: string,
    input: Partial<NoticeInput>
  ): Promise<Notice> => {
    await requireSession();

    const { data, error } = await supabase
      .from('notices')
      .update({ ...(input as any), updated_at: new Date().toISOString() } as any)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as Notice;
  };

  /** お知らせ削除 */
  const deleteNotice = async (id: string): Promise<void> => {
    await requireSession();

    const { error } = await supabase.from('notices').delete().eq('id', id);
    if (error) throw new Error(error.message);
  };

  return { createNotice, updateNotice, deleteNotice };
}
