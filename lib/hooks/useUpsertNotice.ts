// lib/hooks/useUpsertNotice.ts
"use client";

import { createClient } from "@/lib/supabase/client";
import type { Notice } from "./useNotices";

export type NoticeInput = {
  title: string;
  content: string;
  /** YYYY-MM-DD */
  date: string;
  is_published: boolean;
};

// 最小限の行型（内部整形用・fromのジェネリクスには使わない）
type NoticeRow = {
  id: string;
  title: string;
  content: string;
  date: string; // DBは date 型だが、クライアントでは string 扱い
  is_published: boolean;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type NoticeInsert = Omit<NoticeRow, "id" | "created_at" | "updated_at">;
type NoticeUpdate = Partial<
  Pick<NoticeRow, "title" | "content" | "date" | "is_published">
> & {
  updated_at?: string | null;
};

export function useUpsertNotice() {
  const supabase = createClient();

  /** セッション必須の共通チェック */
  const requireSession = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error(error.message);
    const session = data?.session;
    if (!session) throw new Error("ログインが必要です");
    return session;
  };

  /** お知らせ作成 */
  const createNotice = async (input: NoticeInput): Promise<Notice> => {
    const session = await requireSession();

    const payload: NoticeInsert = {
      ...input,
      created_by: session.user.id,
    };

    // ★ 型地獄回避：from のジェネリクスは使わず any に寄せる
    const { data, error } = await (supabase.from("notices") as any)
      .insert(payload as any)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return data as Notice;
  };

  /** お知らせ更新 */
  const updateNotice = async (
    id: string,
    input: Partial<NoticeInput>,
  ): Promise<Notice> => {
    await requireSession();

    const updatePayload: NoticeUpdate = {
      ...input,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await (supabase.from("notices") as any)
      .update(updatePayload as any)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return data as Notice;
  };

  /** お知らせ削除 */
  const deleteNotice = async (id: string): Promise<void> => {
    await requireSession();

    const { error } = await (supabase.from("notices") as any)
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
  };

  return { createNotice, updateNotice, deleteNotice };
}
