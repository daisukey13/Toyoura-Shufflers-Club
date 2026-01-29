// app/(main)/notices/[id]/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FaArrowLeft, FaBullhorn, FaCalendarAlt } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();
const fromAny = (table: string) => (supabase.from(table as any) as any);

type Notice = {
  id: string;
  title: string | null;
  content: string | null;
  date: string | null; // YYYY-MM-DD or null
  is_published: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const paramToString = (v: any) => {
  if (Array.isArray(v)) return String(v[0] ?? '').trim();
  return String(v ?? '').trim();
};

// date(YYYY-MM-DD) と updated_at(ISO) の「日付だけ」を比較するためのキー
const dateKeyFromYmd = (ymd?: string | null) => {
  const s = String(ymd ?? '').trim();
  if (!s) return '';
  // "YYYY-MM-DD" 前提
  return s.slice(0, 10);
};

const dateKeyFromIso = (iso?: string | null) => {
  const s = String(iso ?? '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '';
  // 日本時間で YYYY-MM-DD に揃える（同日判定のブレ防止）
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d); // e.g. "2026-01-28"
};

const fmtDateLong = (v?: string | null) => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const fmtUpdated = (iso?: string | null) => {
  const s = String(iso ?? '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function NoticeDetailPage() {
  const router = useRouter();
  const params = useParams();

  const noticeId = useMemo(() => {
    const p = params as any;
    return paramToString(p?.id ?? '');
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!noticeId) return;

      setLoading(true);
      setError(null);
      try {
        // 公開のみ表示（表画面）
        const { data, error: qErr } = await fromAny('notices')
          .select('*')
          .eq('id', noticeId)
          .eq('is_published', true)
          .maybeSingle();

        if (qErr) throw new Error(qErr.message || 'fetch failed');

        const row = (data ?? null) as Notice | null;

        if (!cancelled) {
          setNotice(row);
          setLoading(false);
        }
      } catch (e: any) {
        console.error('[notices/[id]] load error:', e);
        if (!cancelled) {
          setError(e?.message || 'お知らせの取得に失敗しました');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [noticeId]);

  if (!noticeId) {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">
        IDが指定されていません
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#2a2a3e] text-white">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-3xl mx-auto glass-card rounded-xl p-8 text-center">
            読み込み中…
          </div>
        </div>
      </div>
    );
  }

  if (error || !notice) {
    return (
      <div className="min-h-screen bg-[#2a2a3e] text-white">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-3xl mx-auto glass-card rounded-xl p-8 text-center text-gray-300">
            お知らせが見つかりませんでした。
            <div className="mt-4">
              <button
                onClick={() => router.replace('/notices')}
                className="underline text-purple-300"
              >
                一覧へ戻る
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const baseDateKey = dateKeyFromYmd(notice.date) || dateKeyFromIso(notice.created_at ?? null);
  const updatedKey = dateKeyFromIso(notice.updated_at ?? null);
  const updatedLabel = fmtUpdated(notice.updated_at ?? null);

  // ✅ 同日なら非表示
  const showUpdated = Boolean(updatedLabel && updatedKey && baseDateKey && updatedKey !== baseDateKey);

  const mainDateLabel = notice.date
    ? fmtDateLong(notice.date)
    : fmtDateLong(notice.created_at ?? null) || '';

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto">
          {/* header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full">
                <FaBullhorn className="text-2xl" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-yellow-100 break-words">
                  {notice.title || '無題'}
                </h1>
                <div className="mt-2 flex items-center gap-2 text-sm text-gray-400">
                  <FaCalendarAlt />
                  <span>{mainDateLabel || '日付なし'}</span>
                  {showUpdated ? (
                    <span className="text-[11px] text-gray-500">
                      （最終更新: {updatedLabel}）
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <Link
              href="/notices"
              className="text-blue-300 underline inline-flex items-center gap-2 text-sm"
            >
              <FaArrowLeft /> 一覧へ戻る
            </Link>
          </div>

          {/* body */}
          <div className="glass-card rounded-xl p-6 border border-purple-500/30">
            <div className="text-gray-200 whitespace-pre-wrap break-words leading-relaxed">
              {notice.content || ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
