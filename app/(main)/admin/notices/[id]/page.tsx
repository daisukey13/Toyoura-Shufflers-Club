// app/(main)/admin/notices/[id]/page.tsx
'use client';

import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FaArrowLeft, FaBullhorn, FaSave, FaTrash } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();
// ✅ database.types 側で notices が未定義でもビルドを通す（最小修正）
const fromAny = (table: string) => (supabase.from(table as any) as any);

type AdminRow = { user_id: string };
type PlayerFlagRow = { is_admin: boolean | null };

type NoticeRowLoose = {
  id: string;
  title: string | null;
  content: string | null;
  date: string | null; // YYYY-MM-DD 想定
  is_published: boolean | null;
  created_at?: string | null;
  created_by?: string | null;
};

const paramToString = (v: any) => {
  if (Array.isArray(v)) return String(v[0] ?? '').trim();
  return String(v ?? '').trim();
};

export default function AdminNoticeEditPage() {
  const router = useRouter();
  const params = useParams();

  const noticeId = useMemo(() => {
    const p = params as any;
    return paramToString(p?.id ?? '');
  }, [params]);

  const [authz, setAuthz] = useState<'checking' | 'ok' | 'no'>('checking');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [notice, setNotice] = useState<NoticeRowLoose | null>(null);

  // form
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [date, setDate] = useState(''); // YYYY-MM-DD
  const [isPublished, setIsPublished] = useState(false);

  // ─────────────────────────────────────────────
  // auth + admin check（既存の流れに合わせる）
  // ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const redirectTo = noticeId ? `/admin/notices/${noticeId}` : '/admin/notices';

        // まずは whoami
        const r = await fetch('/auth/whoami', { cache: 'no-store' });
        const j = r.ok ? await r.json() : { authenticated: false };
        if (!j?.authenticated) {
          router.replace(`/login?redirect=${encodeURIComponent(redirectTo)}`);
          return;
        }

        // Supabase user
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace(`/login?redirect=${encodeURIComponent(redirectTo)}`);
          return;
        }

        // admin 判定（app_admins または players.is_admin）
        const [adminResp, playerResp] = await Promise.all([
          (supabase.from('app_admins') as any).select('user_id').eq('user_id', user.id).maybeSingle(),
          (supabase.from('players') as any).select('is_admin').eq('id', user.id).maybeSingle(),
        ]);

        const adminRow = (adminResp?.data ?? null) as AdminRow | null;
        const playerRow = (playerResp?.data ?? null) as PlayerFlagRow | null;
        const isAdmin = Boolean(adminRow?.user_id) || playerRow?.is_admin === true;

        if (!isAdmin) {
          if (!cancelled) setAuthz('no');
          return;
        }

        if (!cancelled) {
          setAuthz('ok');
          void loadNotice();
        }
      } catch (e) {
        console.error('[admin/notices/[id]] auth error:', e);
        if (!cancelled) setAuthz('no');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, noticeId]);

  const loadNotice = async () => {
    if (!noticeId) return;

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { data, error: qErr } = await fromAny('notices')
        .select('*')
        .eq('id', noticeId)
        .maybeSingle();

      if (qErr) throw new Error(qErr.message || 'fetch failed');

      const row = (data ?? null) as NoticeRowLoose | null;
      setNotice(row);

      setTitle(String(row?.title ?? ''));
      setContent(String(row?.content ?? ''));
      setDate(String(row?.date ?? ''));
      setIsPublished(Boolean(row?.is_published));

      setLoading(false);
    } catch (e: any) {
      console.error('[admin/notices/[id]] load error:', e);
      setError(e?.message || 'お知らせの取得に失敗しました');
      setLoading(false);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!noticeId) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      // ✅ 更新可能列だけに絞る（id/created_at/created_by を混ぜない）
      const payload = {
        title: title.trim() || null,
        content: content ?? null,
        date: date.trim() || null,
        is_published: isPublished,
      };

      const { error: uErr } = await fromAny('notices').update(payload).eq('id', noticeId);
      if (uErr) throw new Error(uErr.message || 'update failed');

      setMessage('保存しました');
      await loadNotice();
    } catch (e2: any) {
      console.error('[admin/notices/[id]] save error:', e2);
      setError(`保存に失敗しました: ${e2?.message || 'エラー'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!noticeId) return;

    setError(null);
    setMessage(null);

    const ok = window.confirm('このお知らせを削除します。よろしいですか？');
    if (!ok) return;

    setSaving(true);
    try {
      const { error: dErr } = await fromAny('notices').delete().eq('id', noticeId);
      if (dErr) throw new Error(dErr.message || 'delete failed');

      router.replace('/admin/notices');
    } catch (e: any) {
      console.error('[admin/notices/[id]] delete error:', e);
      setError(`削除に失敗しました: ${e?.message || 'エラー'}`);
    } finally {
      setSaving(false);
    }
  };

  if (authz === 'checking') {
    return <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">認証を確認しています...</div>;
  }
  if (authz === 'no') {
    return <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">アクセス権限がありません</div>;
  }
  if (!noticeId) {
    return <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">IDが指定されていません</div>;
  }

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8">
        {/* header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full">
              <FaBullhorn className="text-2xl" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">お知らせ編集</h1>
              <div className="text-sm text-gray-300 mt-1">
                <span className="text-xs text-gray-400">（ID: {noticeId}）</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <Link href="/admin/notices" className="text-blue-300 underline inline-flex items-center gap-2">
              <FaArrowLeft /> 一覧へ戻る
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-4 rounded-md border border-green-500/50 bg-green-500/10 px-4 py-2 text-sm text-green-200">
            {message}
          </div>
        )}

        {loading ? (
          <div className="text-gray-300">読み込み中...</div>
        ) : !notice ? (
          <div className="text-gray-300">お知らせが見つかりませんでした。</div>
        ) : (
          <form
            onSubmit={handleSave}
            className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-4 md:p-6 space-y-4"
          >
            <div className="grid md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-xs text-gray-300">タイトル</div>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-purple-500/40 bg-gray-900/80 text-sm"
                  placeholder="タイトル"
                />
              </div>

              <div className="space-y-1">
                <div className="text-xs text-gray-300">日付（任意）</div>
                <input
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-purple-500/40 bg-gray-900/80 text-sm"
                  placeholder="YYYY-MM-DD"
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-gray-300">本文</div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full min-h-[220px] px-3 py-2 rounded border border-purple-500/40 bg-gray-900/80 text-sm whitespace-pre-wrap"
                placeholder="本文"
              />
              <div className="text-[11px] text-gray-400">※ プレーンテキスト想定（必要なら将来 Markdown 化）</div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={isPublished}
                  onChange={(e) => setIsPublished(e.target.checked)}
                  className="accent-purple-500"
                />
                公開する
              </label>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={saving}
                  className="px-4 py-2 rounded bg-rose-600 text-white text-xs md:text-sm disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <FaTrash /> 削除
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded bg-purple-600 text-white text-xs md:text-sm disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <FaSave /> {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>

            <div className="text-[11px] text-gray-400">
              作成: {String(notice.created_at ?? '') || '—'} / 公開: {isPublished ? 'ON' : 'OFF'}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
