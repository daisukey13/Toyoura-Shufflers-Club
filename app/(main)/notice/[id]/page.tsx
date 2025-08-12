'use client';

import React from 'react';
import Link from 'next/link';
// プロジェクトの実パスに合わせて修正してください
// 例: '@/hooks/useFetchNoticeDetail' または '@/lib/hooks/useFetchNoticeDetail'
import { useFetchNoticeDetail } from '@/lib/hooks/useFetchNoticeDetail';

type PageProps = {
  params: { id: string };
};

export default function NoticeDetailPage({ params }: PageProps) {
  const noticeId = params.id as string;

  // 取得フックを一本化
  const { notice, loading, error } = useFetchNoticeDetail(noticeId);

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto p-4">
        <div className="h-6 w-40 bg-gray-200 rounded animate-pulse mb-3" />
        <div className="h-4 w-24 bg-gray-200 rounded animate-pulse mb-6" />
        <div className="space-y-3">
          <div className="h-4 w-full bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-5/6 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-2/3 bg-gray-200 rounded animate-pulse" />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-3xl mx-auto p-4">
        <div className="mb-4">
          <Link href="/notice" className="text-sm text-blue-600 hover:underline">
            ← お知らせ一覧に戻る
          </Link>
        </div>
        <div className="p-4 bg-red-50 text-red-700 rounded">
          お知らせの取得に失敗しました。ページを再読み込みするか、しばらくしてからお試しください。
        </div>
      </main>
    );
  }

  if (!notice) {
    return (
      <main className="max-w-3xl mx-auto p-4">
        <div className="mb-4">
          <Link href="/notice" className="text-sm text-blue-600 hover:underline">
            ← お知らせ一覧に戻る
          </Link>
        </div>
        <div className="p-4 bg-yellow-50 text-yellow-800 rounded">
          お知らせが見つかりませんでした。
        </div>
      </main>
    );
  }

  const title = notice.title ?? '無題';
  const createdAt =
    notice.created_at ? new Date(notice.created_at).toLocaleString() : '';

  return (
    <main className="max-w-3xl mx-auto p-4">
      <div className="mb-4">
        <Link href="/notice" className="text-sm text-blue-600 hover:underline">
          ← お知らせ一覧に戻る
        </Link>
      </div>

      <h1 className="text-2xl font-bold mb-2">{title}</h1>
      {createdAt && (
        <p className="text-sm text-gray-500 mb-6">{createdAt}</p>
      )}

      {/* contentがプレーンテキスト想定。HTMLが入る場合はサニタイズしたうえでdangerouslySetInnerHTMLに切替 */}
      <article className="prose max-w-none whitespace-pre-wrap break-words">
        {notice.content ?? ''}
      </article>
    </main>
  );
}

/**
 * メモ：
 * - このページはクライアントコンポーネント（use client）です。
 * - Edge Runtime 警告を避けたい場合は、このファイルで runtime を指定しないか、
 *   サーバーコンポーネント側のエンドポイント経由でデータ取得する構成に分離してください。
 */
