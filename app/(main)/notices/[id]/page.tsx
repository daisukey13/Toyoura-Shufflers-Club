'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Tables } from '@/lib/database.types';

type NoticeRow = Tables<'notices'>;

const supabase = createClient();

function asString(v: string | string[] | undefined): string {
  if (!v) return '';
  return Array.isArray(v) ? v[0] : v;
}

function formatDate(dateLike?: string | null) {
  if (!dateLike) return '';
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return String(dateLike);
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function NoticeDetailPage() {
  const params = useParams();
  const router = useRouter();

  const noticeId = useMemo(() => asString((params as any)?.id), [params]);

  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeRow | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!noticeId) {
        router.push('/notices');
        return;
      }

      setLoading(true);

      const { data, error } = await supabase
        .from('notices')
        .select('id,title,content,date,created_at,is_published')
        .eq('id', noticeId)
        .eq('is_published', true)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        router.push('/notices');
        return;
      }

      setNotice(data as NoticeRow);
      setLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [noticeId, router]);

  const displayDate = useMemo(() => {
    if (!notice) return '';
    return formatDate(notice.date ?? notice.created_at);
  }, [notice]);

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <Link
            href="/notices"
            className="text-sm text-gray-300 hover:text-white underline underline-offset-4"
          >
            ← お知らせ一覧へ
          </Link>
        </div>

        <div className="glass-card rounded-xl p-6 md:p-8">
          {loading ? (
            <div className="text-gray-300">読み込み中...</div>
          ) : (
            <>
              <header className="mb-6">
                <h1 className="text-xl md:text-2xl font-bold text-yellow-100">
                  {notice?.title ?? ''}
                </h1>
                {displayDate ? <div className="mt-2 text-xs text-gray-400">{displayDate}</div> : null}
              </header>

              <div className="prose prose-invert max-w-none whitespace-pre-wrap break-words leading-relaxed">
                {notice?.content ?? ''}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
