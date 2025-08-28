'use client';

import { createClient } from '@/lib/supabase/client';
import type { Notice } from './useNotices';

type NoticeInput = {
  title: string;
  content: string;
  date: string;         // YYYY-MM-DD
  is_published: boolean;
};

export function useUpsertNotice() {
  const supabase = createClient();

  const createNotice = async (input: NoticeInput) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('ログインが必要です');

    const payload = {
      ...input,
      created_by: session.user.id,
    };

    const { data, error } = await supabase
      .from('notices')
      .insert(payload)
      .select('*')
      .single<Notice>();

    if (error) throw error;
    return data;
  };

  const updateNotice = async (id: string, input: Partial<NoticeInput>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('ログインが必要です');

    const { data, error } = await supabase
      .from('notices')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single<Notice>();

    if (error) throw error;
    return data;
  };

  const deleteNotice = async (id: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('ログインが必要です');

    const { error } = await supabase.from('notices').delete().eq('id', id);
    if (error) throw error;
  };

  return { createNotice, updateNotice, deleteNotice };
}
