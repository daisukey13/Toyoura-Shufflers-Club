'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useNoticeDetail } from '@/lib/hooks/useAPI';
import { FaArrowLeft, FaBell, FaCalendar, FaExclamationCircle, FaExclamationTriangle, FaInfoCircle } from 'react-icons/fa';

export default function NoticeDetailPage() {
  const router = useRouter();
  const params = useParams();
  const noticeId = params.id as string;
  
  // 統一APIフックを使用
  const { data: notice, loading, error } = useNoticeDetail(noticeId);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400 mx-auto mb-4"></div>
          <div className="text-white">お知らせを読み込んでいます...</div>
        </div>
      </div>
    );
  }

  if (error || !notice) {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex items-center justify-center">
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-6 max-w-md">
          <div className="flex items-center gap-3 text-red-400 mb-2">
            <FaExclamationTriangle className="text-xl" />
            <h3 className="font-semibold">エラーが発生しました</h3>
          </div>
          <p className="text-gray-300">{error || 'お知らせが見つかりません'}</p>
          <button
            onClick={() => router.push('/notices')}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            一覧に戻る
          </button>
        </div>
      </div>
    );
  }

  const getPriorityIcon = () => {
    switch (notice.priority) {
      case 'high':
        return <FaExclamationCircle className="text-red-400" />;
      case 'medium':
        return <FaExclamationTriangle className="text-yellow-400" />;
      default:
        return <FaInfoCircle className="text-blue-400" />;
    }
  };

  const getPriorityColor = () => {
    switch (notice.priority) {
      case 'high':
        return 'border-red-500/30 bg-red-900/20';
      case 'medium':
        return 'border-yellow-500/30 bg-yellow-900/20';
      default:
        return 'border-blue-500/30 bg-blue-900/20';
    }
  };

  return (
    <div className="min-h-screen bg-[#2a2a3e]">
      <div className="container mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="mb-8">
          <Link
            href="/notices"
            className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 transition-colors mb-4"
          >
            <FaArrowLeft />
            <span>お知らせ一覧に戻る</span>
          </Link>
          
          <h1 className="text-4xl font-bold text-white bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent flex items-center gap-3">
            <FaBell className="text-purple-400" />
            お知らせ詳細
          </h1>
        </div>

        {/* お知らせ内容 */}
        <div className={`max-w-4xl mx-auto bg-gray-900/60 backdrop-blur-md rounded-2xl border ${getPriorityColor()} p-6`}>
          <div className="flex items-start gap-4 mb-6">
            <div className="text-2xl mt-1">
              {getPriorityIcon()}
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-white mb-2">{notice.title}</h2>
              <div className="flex items-center gap-4 text-gray-400 text-sm">
                <div className="flex items-center gap-1">
                  <FaCalendar />
                  <span>{new Date(notice.created_at).toLocaleDateString('ja-JP')}</span>
                </div>
                <div className="px-2 py-1 rounded-full text-xs font-medium bg-gray-800/50">
                  {notice.priority === 'high' && '重要'}
                  {notice.priority === 'medium' && '通常'}
                  {notice.priority === 'low' && '低'}
                </div>
              </div>
            </div>
          </div>

          <div className="prose prose-invert max-w-none">
            <div className="text-gray-300 whitespace-pre-wrap">
              {notice.content}
            </div>
          </div>

          {notice.updated_at !== notice.created_at && (
            <div className="mt-6 pt-6 border-t border-gray-700">
              <p className="text-sm text-gray-500">
                最終更新: {new Date(notice.updated_at).toLocaleDateString('ja-JP')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
