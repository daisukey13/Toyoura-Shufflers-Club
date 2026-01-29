// app/(main)/admin/notices/page.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FaPlus, FaEdit, FaTrash, FaEye, FaEyeSlash } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

// ---- 型（ローカルで厳格化） ----
type PlayerFlagRow = { is_admin: boolean | null };

type Notice = {
  id: string;
  title: string;
  content: string;
  date: string | null; // YYYY-MM-DD or null
  is_published: boolean;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function asTime(v?: string | null) {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

function fmtUpdated(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDateLong(v?: string | null) {
  if (!v) return '';
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function AdminNoticesPage() {
  const router = useRouter();

  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [booting, setBooting] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
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

        // 管理者判定（from の型は緩め、結果をローカル型で受ける）
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
        await fetchNotices();
      } catch (e) {
        console.error('[admin/notices] admin bootstrap error:', e);
        router.replace('/');
      } finally {
        setBooting(false);
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchNotices = async () => {
    setLoading(true);
    try {
      // サーバー order を使わず、クライアントで安定ソート
      const { data, error } = await (supabase.from('notices') as any).select('*');
      if (error) throw error;

      const list = (data ?? []) as Notice[];

      const sorted = list.sort((a, b) => {
        // ✅ 優先キー: updated_at → 次点: date（YYYY-MM-DD）→ 次点: created_at
        const at = asTime(a.updated_at ?? a.date ?? a.created_at ?? null);
        const bt = asTime(b.updated_at ?? b.date ?? b.created_at ?? null);
        return bt - at; // 降順
      });

      setNotices(sorted);
    } catch (e) {
      console.error('[admin/notices] fetch error:', e);
      alert('お知らせの取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  const togglePublish = async (target: Notice) => {
    const next = !target.is_published;

    // 楽観的更新（表示だけ先に切り替える）
    setNotices((prev) => prev.map((n) => (n.id === target.id ? { ...n, is_published: next } : n)));

    try {
      const { error } = await (supabase.from('notices') as any)
        .update({ is_published: next } as any)
        .eq('id', target.id);
      if (error) throw error;

      // ✅ updated_at をDBトリガーで更新しているので、成功後に再取得して表示も最新にする
      await fetchNotices();
    } catch (e) {
      console.error('[admin/notices] toggle publish error:', e);

      // ロールバック
      setNotices((prev) => prev.map((n) => (n.id === target.id ? { ...n, is_published: !next } : n)));

      const msg = String((e as any)?.message || e);
      let hint = '';
      if (/row-level security|RLS/i.test(msg)) {
        hint = '\n（Supabase の RLS ポリシーで、管理者のみ UPDATE 可能か確認してください）';
      }
      alert(`公開状態の更新に失敗しました。\n詳細: ${msg}${hint}`);
    }
  };

  const deleteNotice = async (id: string) => {
    if (!confirm('このお知らせを削除してもよろしいですか？')) return;

    const snapshot = notices;

    // 楽観的
    setNotices((prev) => prev.filter((n) => n.id !== id));

    try {
      const { error } = await (supabase.from('notices') as any).delete().eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error('[admin/notices] delete error:', e);
      setNotices(snapshot);

      const msg = String((e as any)?.message || e);
      let hint = '';
      if (/row-level security|RLS/i.test(msg)) {
        hint = '\n（Supabase の RLS ポリシーで、管理者のみ DELETE 可能か確認してください）';
      }
      alert(`お知らせの削除に失敗しました。\n詳細: ${msg}${hint}`);
    }
  };

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">読み込み中...</div>
      </div>
    );
  }
  if (!isAdmin) return null;

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

        {loading ? (
          <div className="glass-card rounded-xl p-8 text-center">読み込み中...</div>
        ) : notices.length === 0 ? (
          <div className="glass-card rounded-xl p-8 text-center">
            <p className="text-gray-400">お知らせがありません</p>
          </div>
        ) : (
          <div className="space-y-4">
            {notices.map((notice) => {
              const base = notice.date || notice.created_at || null;
              const baseLabel = base ? fmtDateLong(base) : '日付なし';
              const updatedLabel = fmtUpdated(notice.updated_at);

              return (
                <div key={notice.id} className="glass-card rounded-xl p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-3 mb-2">
                        <h3 className="text-xl font-semibold text-yellow-100 break-all">{notice.title}</h3>
                        <span
                          className={`px-3 py-1 rounded-full text-sm whitespace-nowrap ${
                            notice.is_published ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-300'
                          }`}
                        >
                          {notice.is_published ? '公開中' : '非公開'}
                        </span>
                      </div>

                      <p className="text-gray-400 mb-2">
                        {baseLabel}
                        {updatedLabel ? (
                          <span className="text-[11px] text-gray-500">（最終更新: {updatedLabel}）</span>
                        ) : null}
                      </p>

                      <p
                        className="text-gray-300 overflow-hidden text-ellipsis"
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          whiteSpace: 'normal',
                        }}
                        title={notice.content}
                      >
                        {notice.content}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => togglePublish(notice)}
                        className="p-2 rounded-lg hover:bg-purple-900/20 transition-colors"
                        title={notice.is_published ? '非公開にする' : '公開する'}
                      >
                        {notice.is_published ? <FaEyeSlash className="text-gray-400" /> : <FaEye className="text-purple-400" />}
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
