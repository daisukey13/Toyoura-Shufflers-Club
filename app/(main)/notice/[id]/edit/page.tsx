// app/admin/notices/[id]/edit/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';

const supabase = createClient();

export default function EditNoticePage() {
  const params = useParams();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [date, setDate] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    checkAdminAndFetchNotice();
  }, [params.id]);

  const checkAdminAndFetchNotice = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/admin/login');
        return;
      }

      const { data: player } = await supabase
        .from('players')
        .select('is_admin')
        .eq('id', user.id)
        .single();

      if (!player?.is_admin) {
        router.push('/');
        return;
      }

      setIsAdmin(true);

      // お知らせデータを取得
      const { data: notice, error } = await supabase
        .from('notices')
        .select('*')
        .eq('id', params.id)
        .single();

      if (error || !notice) {
        router.push('/admin/notices');
        return;
      }

      setTitle(notice.title);
      setContent(notice.content);
      setDate(notice.date);
      setIsPublished(notice.is_published);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !content) {
      alert('タイトルと内容を入力してください');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('notices')
        .update({
          title,
          content,
          date,
          is_published: isPublished,
          updated_at: new Date().toISOString()
        })
        .eq('id', params.id);

      if (error) throw error;

      router.push('/admin/notices');
    } catch (error) {
      console.error('Error updating notice:', error);
      alert('お知らせの更新に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  if (!isAdmin) {
    return null;
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

        <div className="glass-card rounded-xl p-8">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                タイトル
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors"
                placeholder="お知らせのタイトルを入力"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                日付
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                内容
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors h-48 resize-none"
                placeholder="お知らせの内容を入力（Markdownが使えます）"
                required
              />
              <p className="text-sm text-gray-400 mt-1">
                ※ Markdownで書式設定ができます（**太字**、*斜体*、- リスト など）
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="isPublished"
                checked={isPublished}
                onChange={(e) => setIsPublished(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <label htmlFor="isPublished" className="text-gray-300">
                公開する
              </label>
            </div>

            <div className="flex gap-4 pt-4">
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '更新中...' : 'お知らせを更新'}
              </button>
              <Link
                href="/admin/notices"
                className="px-6 py-3 border border-purple-500 text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors"
              >
                キャンセル
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}