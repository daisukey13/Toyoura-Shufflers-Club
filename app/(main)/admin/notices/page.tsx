// app/admin/notices/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { FaPlus, FaEdit, FaTrash, FaEye, FaEyeSlash } from 'react-icons/fa';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const supabase = createClient();

interface Notice {
  id: string;
  title: string;
  content: string;
  date: string;
  is_published: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export default function AdminNoticesPage() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();

  // 一覧取得（依存に入れられるよう useCallback で安定化）
  const fetchNotices = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('notices')
        .select('*')
        .order('date', { ascending: false });

      if (error) throw error;
      if (data) setNotices(data as Notice[]);
    } catch (error) {
      console.error('Error fetching notices:', error);
    }
  }, []);

  // 管理者チェック + 一覧取得（依存に fetchNotices）
  const checkAdminAndFetchNotices = useCallback(async () => {
    try {
      // 管理者権限チェック
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push('/admin/login');
        return;
      }

      const { data: player, error } = await supabase
        .from('players')
        .select('is_admin')
        .eq('id', user.id)
        .single();

      if (error) {
        console.error('Error fetching player:', error);
        router.push('/');
        return;
      }

      if (!player?.is_admin) {
        router.push('/');
        return;
      }

      setIsAdmin(true);
      await fetchNotices();
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  }, [fetchNotices, router]);

  useEffect(() => {
    checkAdminAndFetchNotices();
  }, [checkAdminAndFetchNotices]);

  const togglePublish = async (notice: Notice) => {
    try {
      const { error } = await supabase
        .from('notices')
        .update({ is_published: !notice.is_published })
        .eq('id', notice.id);

      if (error) throw error;
      await fetchNotices();
    } catch (error) {
      console.error('Error toggling publish status:', error);
    }
  };

  const deleteNotice = async (id: string) => {
    if (!confirm('このお知らせを削除してもよろしいですか？')) return;

    try {
      const { error } = await supabase.from('notices').delete().eq('id', id);
      if (error) throw error;
      await fetchNotices();
    } catch (error) {
      console.error('Error deleting notice:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">読み込み中...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-yellow-100">お知らせ管理</h1>
          <Link
            href="/admin/notices/new"
            className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
          >
            <FaPlus /> 新規作成
          </Link>
        </div>

        <div className="space-y-4">
          {notices.length === 0 ? (
            <div className="glass-card rounded-xl p-8 text-center">
              <p className="text-gray-400">お知らせがありません</p>
            </div>
          ) : (
            notices.map((notice) => (
              <div key={notice.id} className="glass-card rounded-xl p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-4 mb-2">
                      <h3 className="text-xl font-semibold text-yellow-100">{notice.title}</h3>
                      <span
                        className={`px-3 py-1 rounded-full text-sm ${
                          notice.is_published
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {notice.is_published ? '公開中' : '非公開'}
                      </span>
                    </div>
                    <p className="text-gray-400 mb-2">
                      {new Date(notice.date).toLocaleDateString('ja-JP', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                    <p className="text-gray-300 line-clamp-2">{notice.content}</p>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => togglePublish(notice)}
                      className="p-2 rounded-lg hover:bg-purple-900/20 transition-colors"
                      title={notice.is_published ? '非公開にする' : '公開する'}
                    >
                      {notice.is_published ? (
                        <FaEyeSlash className="text-gray-400" />
                      ) : (
                        <FaEye className="text-purple-400" />
                      )}
                    </button>
                    <Link
                      href={`/admin/notices/${notice.id}/edit`}
                      className="p-2 rounded-lg hover:bg-purple-900/20 transition-colors"
                      title="編集"
                    >
                      <FaEdit className="text-purple-400" />
                    </Link>
                    <button
                      onClick={() => deleteNotice(notice.id)}
                      className="p-2 rounded-lg hover:bg-red-900/20 transition-colors"
                      title="削除"
                    >
                      <FaTrash className="text-red-400" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
