'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FaArrowLeft, FaBullhorn, FaSpinner } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

type NoticeRow = {
  id: string;
  title: string | null;
  content: string | null; // ✅ ここが抜けていたのが原因
  date: string | null; // YYYY-MM-DD
  is_published: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

export default function NoticeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const noticeId = params?.id;

  const supabase = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return createClient();
  }, []);

  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 公開/非公開ガード用（管理者は非公開も閲覧可）
  const [viewerChecked, setViewerChecked] = useState(false);
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!supabase) return;

        // 未ログインでも公開お知らせは見える想定だが、
        // 管理者なら非公開も見せるために admin 判定だけしておく
        const r = await fetch('/auth/whoami', { cache: 'no-store', credentials: 'include' });
        const j = r.ok ? await r.json() : { authenticated: false };

        if (!j?.authenticated) {
          if (!cancelled) {
            setViewerIsAdmin(false);
            setViewerChecked(true);
          }
          return;
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user?.id) {
          if (!cancelled) {
            setViewerIsAdmin(false);
            setViewerChecked(true);
          }
          return;
        }

        // app_admins or players.is_admin のどちらかで admin
        const [adminResp, playerResp] = await Promise.all([
          (supabase.from('app_admins') as any).select('user_id').eq('user_id', user.id).maybeSingle(),
          (supabase.from('players') as any).select('is_admin').eq('id', user.id).maybeSingle(),
        ]);

        const isAdmin = !!adminResp?.data?.user_id || playerResp?.data?.is_admin === true;

        if (!cancelled) {
          setViewerIsAdmin(isAdmin);
          setViewerChecked(true);
        }
      } catch {
        if (!cancelled) {
          setViewerIsAdmin(false);
          setViewerChecked(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!supabase || !noticeId) return;

      setLoading(true);
      setError(null);

      try {
        // ✅ content を明示的に取得（* でも良いが、型ズレ対策で明示）
        const { data, error } = await (supabase.from('notices') as any)
          .select('id,title,content,date,is_published,created_at,updated_at')
          .eq('id', noticeId)
          .maybeSingle();

        if (cancelled) return;
        if (error) throw error;

        const row = (data ?? null) as NoticeRow | null;
        if (!row) {
          setNotice(null);
          setError('お知らせが見つかりませんでした。');
          return;
        }

        // 非公開は一般には見せない（管理者だけOK）
        if (row.is_published === false && viewerChecked && !viewerIsAdmin) {
          setNotice(null);
          setError('このお知らせは非公開です。');
          return;
        }

        setNotice(row);
      } catch (e: any) {
        if (!cancelled) {
          setNotice(null);
          setError(e?.message ?? '読み込みに失敗しました');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, noticeId, viewerChecked, viewerIsAdmin]);

  const dateLabel = useMemo(() => {
    if (!notice?.date) return '';
    try {
      return new Date(notice.date).toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return notice.date;
    }
  }, [notice?.date]);

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-6 sm:py-8">
        <div className="mb-4">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 text-purple-300 hover:text-purple-200"
          >
            <FaArrowLeft /> 戻る
          </button>
        </div>

        {loading && (
          <div className="max-w-4xl mx-auto glass-card rounded-2xl p-6 sm:p-8 border border-purple-500/30">
            <div className="text-gray-400 py-8 text-center">
              <FaSpinner className="inline mr-2 animate-spin" />
              読み込み中…
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="max-w-4xl mx-auto glass-card rounded-2xl p-6 sm:p-8 border border-red-500/40 bg-red-500/10">
            {error}
            <div className="mt-4">
              <Link href="/notices" className="text-purple-300 hover:text-purple-200">
                お知らせ一覧へ →
              </Link>
            </div>
          </div>
        )}

        {!loading && !error && notice && (
          <article className="max-w-4xl mx-auto glass-card rounded-2xl p-6 sm:p-8 border border-purple-500/30">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-yellow-100 flex items-center gap-2">
                  <FaBullhorn className="text-yellow-300" />
                  {notice.title || 'お知らせ'}
                </h1>
                {dateLabel && <div className="text-sm text-gray-400 mt-1">{dateLabel}</div>}
              </div>

              {viewerChecked && viewerIsAdmin && notice.is_published === false && (
                <div className="px-3 py-1 text-xs rounded-full border border-yellow-500/40 bg-yellow-500/10 text-yellow-200">
                  非公開（管理者表示）
                </div>
              )}
            </div>

            {/* プレーンテキスト想定：Markdown にしたい場合は将来パーサ導入 */}
            <div className="prose prose-invert max-w-none whitespace-pre-wrap break-words leading-relaxed">
              {notice.content ?? ''}
            </div>

            <div className="mt-6 pt-4 border-t border-white/10">
              <Link href="/notices" className="text-purple-300 hover:text-purple-200">
                お知らせ一覧へ →
              </Link>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
