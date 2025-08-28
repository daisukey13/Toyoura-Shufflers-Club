// app/(main)/notices/[id]/page.tsx
'use client';

import Link from 'next/link';
import { FaArrowLeft, FaCalendarAlt } from 'react-icons/fa';
import { useFetchNoticeDetail } from '@/lib/hooks/useFetchNoticeDetail';

type PageProps = { params: { id: string } };

export default function NoticeDetailPage({ params }: PageProps) {
  const id = params.id as string;
  const { notice, loading, error } = useFetchNoticeDetail(id);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#2a2a3e] text-white">
        <div className="container mx-auto px-4 py-10 max-w-3xl">
          <div className="glass-card rounded-2xl p-6 sm:p-8 border border-purple-500/30">
            <div className="h-6 w-40 bg-white/10 rounded animate-pulse mb-3" />
            <div className="h-4 w-24 bg-white/10 rounded animate-pulse mb-6" />
            <div className="space-y-3">
              <div className="h-4 w-full bg-white/10 rounded animate-pulse" />
              <div className="h-4 w-5/6 bg-white/10 rounded animate-pulse" />
              <div className="h-4 w-2/3 bg-white/10 rounded animate-pulse" />
            </div>
          </div>

          <div className="mt-6">
            <Link
              href="/notices"
              className="text-sm text-purple-300 hover:underline inline-flex items-center gap-2"
              prefetch={false}
            >
              <FaArrowLeft /> お知らせ一覧に戻る
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (error || !notice) {
    return (
      <main className="min-h-screen bg-[#2a2a3e] text-white">
        <div className="container mx-auto px-4 py-10 max-w-3xl">
          <div className="mb-4">
            <Link
              href="/notices"
              className="text-sm text-purple-300 hover:underline inline-flex items-center gap-2"
              prefetch={false}
            >
              <FaArrowLeft /> お知らせ一覧に戻る
            </Link>
          </div>
          <div className="glass-card rounded-xl p-6 border border-red-500/30 bg-red-500/10">
            <p className="text-red-300">お知らせが見つかりませんでした。</p>
          </div>
        </div>
      </main>
    );
  }

  const title = notice.title ?? '無題';
  const dateValue =
  (notice as any).date ??
  (notice as any).created_at ??
  null;
 const dateText = dateValue
  ? new Date(dateValue).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
  : '';

  return (
    <main className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-10 max-w-3xl">
        <div className="mb-6">
          <Link
            href="/notices"
            className="text-sm text-purple-300 hover:underline inline-flex items-center gap-2"
            prefetch={false}
          >
            <FaArrowLeft /> お知らせ一覧に戻る
          </Link>
        </div>

        <article className="glass-card rounded-2xl p-6 sm:p-8 border border-purple-500/30">
          <h1 className="text-2xl sm:text-3xl font-bold text-yellow-100 mb-3 break-words">
            {title}
          </h1>

          {dateText && (
            <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
              <FaCalendarAlt />
              <span>{dateText}</span>
            </div>
          )}

          {/* プレーンテキスト想定：Markdown にしたい場合は将来パーサ導入 */}
          <div className="prose prose-invert max-w-none whitespace-pre-wrap break-words leading-relaxed">
            {notice.content ?? ''}
          </div>
        </article>
      </div>
    </main>
  );
}
