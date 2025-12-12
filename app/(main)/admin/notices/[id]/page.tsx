// app/(main)/admin/notices/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

/** Supabase クライアント（App Router クライアント側） */
const supabase = createClient();

/* ========= 型定義 ========= */

type PlayerFlagRow = { is_admin: boolean | null };

type NoticeRow = {
  id: string;
  title: string;
  content: string;
  date: string | null; // YYYY-MM-DD or null
  is_published: boolean;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/* ========= コンポーネント ========= */

export default function EditNoticePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const noticeId = params?.id;

  // 権限・起動状態
  const [booting, setBooting] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // フォーム
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [date, setDate] = useState<string>('');
  const [isPublished, setIsPublished] = useState(false);

  // 画面状態
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /* ==============================
     起動時: 認証 & 管理者チェック
     ============================== */
  useEffect(() => {
    if (!noticeId) return;

    (async () => {
      try {
        // 認証
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        if (!user) {
          router.replace('/');
          return;
        }

        // 管理者判定
        const { data: pRow, error: plErr } = await (supabase.from('players') as any)
          .select('is_admin')
          .eq('id', user.id)
          .maybeSingle();

        if (plErr) throw plErr;
        const player = (pRow ?? null) as PlayerFlagRow | null;
        if (!player?.is_admin) {
          router.replace('/');
          return;
        }

        setIsAdmin(true);

        // お知らせ本体を読み込み
        await fetchNotice(noticeId);
      } catch (e) {
        console.error('[admin/notices/[id]] bootstrap error:', e);
        router.replace('/');
      } finally {
        setBooting(false);
      }
    })();
  }, [noticeId, router]);

  /* ==============================
     単一お知らせ取得
     ============================== */
  const fetchNotice = async (id: string) => {
    setLoading(true);
    try {
      const { data, error } = await (supabase.from('notices') as any)
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error || !data) {
        console.error('[admin/notices/[id]] fetch error:', error);
        alert('お知らせの取得に失敗しました。');
        router.replace('/admin/notices');
        return;
      }

      const n = data as NoticeRow;
      setTitle(n.title ?? '');
      setContent(n.content ?? '');
      setIsPublished(!!n.is_published);

      // date(YYYY-MM-DD) があればそれを採用。なければ created_at から日付だけ拾う。
      if (n.date) {
        setDate(n.date);
      } else if (n.created_at) {
        const d = new Date(n.created_at);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        setDate(`${y}-${m}-${dd}`);
      } else {
        setDate(new Date().toISOString().split('T')[0]);
      }
    } catch (e) {
      console.error('[admin/notices/[id]] fetch fatal:', e);
      alert('お知らせの取得に失敗しました。');
      router.replace('/admin/notices');
    } finally {
      setLoading(false);
    }
  };

  /* ==============================
     更新
     ============================== */
  const handleSave = async () => {
    if (saving) return;
    if (!title.trim() || !content.trim()) {
      alert('タイトルと内容を入力してください');
      return;
    }
    if (!noticeId) return;

    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        content,
        date: date || null, // 空なら null で保存
        is_published: isPublished,
      };

      const { error } = await (supabase.from('notices') as any)
        .update(payload as any)
        .eq('id', noticeId);

      if (error) throw error;

      alert('お知らせを更新しました');
      router.replace('/admin/notices');
    } catch (e: any) {
      console.error('[admin/notices/[id]] update error:', e);
      const msg = String(e?.message || e);
      let hint = '';
      if (/row-level security|RLS/i.test(msg)) {
        hint = '\n（Supabase の RLS ポリシーで、管理者のみ UPDATE 可能か確認してください）';
      }
      alert(`お知らせの更新に失敗しました。\n詳細: ${msg}${hint}`);
    } finally {
      setSaving(false);
    }
  };

  /* ==============================
     削除
     ============================== */
  const handleDelete = async () => {
    if (!noticeId) return;
    if (!confirm('このお知らせを削除してもよろしいですか？')) return;

    try {
      const { error } = await (supabase.from('notices') as any)
        .delete()
        .eq('id', noticeId);
      if (error) throw error;

      alert('お知らせを削除しました');
      router.replace('/admin/notices');
    } catch (e: any) {
      console.error('[admin/notices/[id]] delete error:', e);
      const msg = String(e?.message || e);
      let hint = '';
      if (/row-level security|RLS/i.test(msg)) {
        hint = '\n（Supabase の RLS ポリシーで、管理者のみ DELETE 可能か確認してください）';
      }
      alert(`お知らせの削除に失敗しました。\n詳細: ${msg}${hint}`);
    }
  };

  /* ==============================
     レンダリング
     ============================== */

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-gray-200">読み込み中...</div>
      </div>
    );
  }

  if (!isAdmin) return null;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-gray-200">お知らせを読み込んでいます...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-yellow-100 mb-2">お知らせ編集</h1>
          <Link href="/admin/notices" className="text-purple-400 hover:text-purple-300">
            ← お知らせ一覧に戻る
          </Link>
        </div>

        <div className="glass-card rounded-xl p-8 space-y-6">
          {/* タイトル */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">タイトル</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors"
              placeholder="お知らせのタイトルを入力"
              required
            />
          </div>

          {/* 日付 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">日付</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors"
            />
          </div>

          {/* 内容 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              内容（Markdown可）
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 transition-colors h-48 resize-none"
              placeholder="お知らせの内容を入力"
              required
            />
            <p className="text-sm text-gray-400 mt-1">
              ※ Markdownで書式設定ができます（**太字**、*斜体*、- リスト など）
            </p>
          </div>

          {/* 公開フラグ */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isPublished"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <label htmlFor="isPublished" className="text-gray-300">
              公開中にする
            </label>
          </div>

          {/* ボタン群 */}
          <div className="flex gap-4 pt-4">
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="flex-1 px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? '保存中...' : '更新する'}
            </button>

            <button
              type="button"
              onClick={handleDelete}
              className="px-6 py-3 border border-red-500 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              削除
            </button>

            <button
              type="button"
              onClick={() => router.replace('/admin/notices')}
              className="px-6 py-3 border border-gray-500 text-gray-300 hover:bg-gray-500/10 rounded-lg transition-colors"
            >
              キャンセル
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
