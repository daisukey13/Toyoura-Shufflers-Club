'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { FaArrowLeft, FaSave, FaTimes, FaExclamationTriangle } from 'react-icons/fa';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("環境変数が設定されていません");
}
interface Notice {
  id: string;
  title: string;
  content: string;
  date: string;
  is_published: boolean;
  created_by: string;
  created_at: string;
  updated_at?: string;
}

export default function EditNoticePage() {
  const params = useParams();
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const noticeId = params.id as string;

  const [notice, setNotice] = useState<Notice | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [date, setDate] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // 管理者権限チェック
    if (!user) {
      router.push('/admin/login');
      return;
    }

    if (!isAdmin) {
      router.push('/');
      return;
    }

    // お知らせデータを取得
    fetchNotice();
  }, [user, isAdmin, router]);

  const fetchNotice = async () => {
    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/notices?id=eq.${noticeId}&select=*`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch notice');
      }

      const data = await response.json();
      if (!data || data.length === 0) {
        throw new Error('Notice not found');
      }

      const noticeData = data[0];
      setNotice(noticeData);
      setTitle(noticeData.title);
      setContent(noticeData.content);
      setDate(noticeData.date);
      setIsPublished(noticeData.is_published);
    } catch (error) {
      console.error('Error fetching notice:', error);
      setError('お知らせの取得に失敗しました');
      router.push('/admin/notices');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title || !content) {
      setError('タイトルと内容を入力してください');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const updateData = {
        title,
        content,
        date,
        is_published: isPublished,
        updated_at: new Date().toISOString()
      };

      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/notices?id=eq.${noticeId}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(updateData)
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update notice');
      }

      router.push('/admin/notices');
    } catch (error) {
      console.error('Error updating notice:', error);
      setError('お知らせの更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('このお知らせを削除してもよろしいですか？')) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/notices?id=eq.${noticeId}`,
        {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to delete notice');
      }

      router.push('/admin/notices');
    } catch (error) {
      console.error('Error deleting notice:', error);
      setError('お知らせの削除に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400 mx-auto mb-4"></div>
          <div className="text-white text-xl">読み込み中...</div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#2a2a3e] p-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-yellow-100 mb-2">お知らせ編集</h1>
          <Link 
            href="/admin/notices" 
            className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 transition-colors"
          >
            <FaArrowLeft /> お知らせ一覧に戻る
          </Link>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-500/30 rounded-lg">
            <div className="flex items-center gap-2 text-red-400">
              <FaExclamationTriangle />
              <span>{error}</span>
            </div>
          </div>
        )}

        <div className="glass-card rounded-xl p-6 sm:p-8 border border-purple-500/30">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                タイトル
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors text-white"
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
                className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors text-white"
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
                className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors text-white h-48 resize-none"
                placeholder="お知らせの内容を入力（Markdownが使えます）"
                required
              />
              <p className="text-sm text-gray-400 mt-1">
                ※ Markdownで書式設定ができます（**太字**、[リンク](URL)、- リスト など）
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="isPublished"
                checked={isPublished}
                onChange={(e) => setIsPublished(e.target.checked)}
                className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500"
              />
              <label htmlFor="isPublished" className="text-gray-300">
                公開する
              </label>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:transform-none disabled:cursor-not-allowed text-white font-medium flex items-center justify-center gap-2"
              >
                <FaSave />
                {saving ? '更新中...' : 'お知らせを更新'}
              </button>
              
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="px-6 py-3 bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium flex items-center justify-center gap-2"
              >
                <FaTimes />
                削除
              </button>
              
              <Link
                href="/admin/notices"
                className="px-6 py-3 border border-purple-500 text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <FaTimes />
                キャンセル
              </Link>
            </div>
          </form>
        </div>

        {/* プレビューセクション */}
        <div className="mt-8 glass-card rounded-xl p-6 sm:p-8 border border-purple-500/30">
          <h2 className="text-xl font-semibold text-yellow-100 mb-4">プレビュー</h2>
          <div className="space-y-4">
            <h3 className="text-2xl font-bold text-white">{title || 'タイトル未入力'}</h3>
            <p className="text-gray-400">
              {date ? new Date(date).toLocaleDateString('ja-JP', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              }) : '日付未設定'}
            </p>
            <div className="text-gray-300 whitespace-pre-wrap">
              {content || '内容未入力'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}