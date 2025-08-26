// app/admin/notices/new/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const supabase = createClient();

export default function NewNoticePage() {
  const router = useRouter();

  // フォーム状態
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  // DBの型が "date" 前提：YYYY-MM-DD を入れる
  const [date, setDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [isPublished, setIsPublished] = useState(false);

  // 画面状態
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // 起動時に管理者チェック
  useEffect(() => {
    (async () => {
      try {
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;

        if (!user) {
          // 未ログイン → 管理画面ログイン or トップへ
          router.replace('/'); // 必要なら /login 等に変更
          return;
        }

        // players.is_admin で権限判定（RLSは app_admins 側で別途厳密化しておくと安全）
        const { data: player, error: plErr } = await supabase
          .from('players')
          .select('is_admin')
          .eq('id', user.id)
          .maybeSingle();

        if (plErr) throw plErr;
        if (!player?.is_admin) {
          router.replace('/');
          return;
        }

        setIsAdmin(true);
      } catch (e) {
        console.error('[admin/notices/new] admin check error:', e);
        router.replace('/');
      } finally {
        setBooting(false);
      }
    })();
  }, [router]);

  // 送信
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;

    if (!title.trim() || !content.trim()) {
      alert('タイトルと内容を入力してください');
      return;
    }

    setLoading(true);
    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!user) throw new Error('Not authenticated');

      // notices: title, content, date, is_published, created_by
      const payload = {
        title: title.trim(),
        content: content,         // Markdown/テキストをそのまま
        date,                     // "YYYY-MM-DD" のまま（DBが date 型前提）
        is_published: isPublished,
        created_by: user.id,
      };

      const { error: insErr } = await supabase.from('notices').insert(payload);
      if (insErr) throw insErr;

      alert('お知らせを作成しました');
      router.replace('/admin/notices');
    } catch (err: any) {
      console.error('[admin/notices/new] create error:', err);
      const msg = String(err?.message || err);
      let hint = '';
      if (/row-level security|RLS/i.test(msg)) {
        hint = '\n（Supabase の RLS ポリシーで、管理者のみ INSERT を許可しているか確認してください）';
      }
      if (/column .* does not exist|relation .* does not exist/i.test(msg)) {
        hint = '\n（notices テーブルのカラム: title, content, date, is_published, created_by を確認してください）';
      }
      alert(`お知らせの作成に失敗しました。\n詳細: ${msg}${hint}`);
    } finally {
      setLoading(false);
    }
  };

  // 起動中 or 権限なし時は何も描画しない（リダイレクト優先）
  if (booting || !isAdmin) return null;

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-yellow-100 mb-2">新規お知らせ作成</h1>
          <Link href="/admin/notices" className="text-purple-400 hover:text-purple-300">
            ← お知らせ一覧に戻る
          </Link>
        </div>

        <form onSubmit={handleSubmit} className="glass-card rounded-xl p-8">
          <div className="space-y-6">
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

            {/* 日付（date 型） */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">日付</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors"
                required
              />
            </div>

            {/* 内容 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">内容</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none transition-colors h-48 resize-none"
                placeholder="お知らせの内容を入力（Markdownが使えます）"
                required
              />
              <p className="text-sm text-gray-400 mt-1">
                ※ Markdownで書式設定ができます（<b>**太字**</b>、<i>*斜体*</i>、- リスト など）
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
                すぐに公開する
              </label>
            </div>

            {/* アクション */}
            <div className="flex gap-4 pt-4">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '作成中...' : 'お知らせを作成'}
              </button>
              <Link
                href="/admin/notices"
                className="px-6 py-3 border border-purple-500 text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors"
              >
                キャンセル
              </Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
