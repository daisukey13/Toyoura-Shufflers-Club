'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { FaArrowLeft, FaCalendar, FaExclamationTriangle } from 'react-icons/fa';
import { useFetchNoticeDetail } from '@/lib/hooks/useFetchSupabaseData';

interface Notice {
  id: string;
  title: string;
  content: string;
  date: string;
  is_published: boolean;
  created_by: string;
  created_at: string;
}

export default function NoticeDetailPage() {
  const router = useRouter();
  const noticeId = params.id as string;
  
  // Fetch APIフックを使用
  const { notice, loading, error } = useFetchNoticeDetail(noticeId);

  useEffect(() => {
    // お知らせが非公開の場合はトップページへリダイレクト
    if (!loading && notice && !notice.is_published) {
      router.push('/');
    }
  }, [notice, loading, router]);

  // テキストフォーマット関数
  const formatText = (text: string) => {
    if (!text) return '';
    
    let formatted = text;
    
    // 太字
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // リンク
    formatted = formatted.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g, 
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300 underline">$1</a>'
    );
    
    // リスト処理の改善
    const lines = formatted.split('\n');
    const processedLines = [];
    let inList = false;
    
    for (const line of lines) {
      if (line.startsWith('- ')) {
        if (!inList) {
          processedLines.push('<ul class="list-disc list-inside my-2">');
          inList = true;
        }
        processedLines.push(`<li>${line.substring(2)}</li>`);
      } else {
        if (inList) {
          processedLines.push('</ul>');
          inList = false;
        }
        processedLines.push(line);
      }
    }
    
    if (inList) {
      processedLines.push('</ul>');
    }
    
    formatted = processedLines.join('\n');
    
    // 改行
    formatted = formatted.replace(/\n/g, '<br />');
    
    return formatted;
  };

  // ローディング中
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2a2a3e]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400 mx-auto mb-4"></div>
          <div className="text-white text-xl">読み込み中...</div>
        </div>
      </div>
    );
  }

  // エラー表示
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2a2a3e] p-4">
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-6 max-w-md">
          <div className="flex items-center gap-3 text-red-400 mb-2">
            <FaExclamationTriangle className="text-xl" />
            <h3 className="font-semibold">エラーが発生しました</h3>
          </div>
          <p className="text-gray-300">{error}</p>
          <Link
            href="/"
            className="mt-4 inline-block px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            トップページに戻る
          </Link>
        </div>
      </div>
    );
  }

  // お知らせが見つからない、または非公開
  if (!notice || !notice.is_published) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2a2a3e]">
        <div className="text-center">
          <div className="text-white text-xl mb-4">お知らせが見つかりません</div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            <FaArrowLeft /> トップページに戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#2a2a3e] p-4 pb-20 lg:pb-4">
      <div className="max-w-4xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 mb-6 sm:mb-8 transition-colors"
        >
          <FaArrowLeft /> トップページに戻る
        </Link>

        <div className="glass-card rounded-xl p-6 sm:p-8 border border-purple-500/30">
          <div className="mb-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-yellow-100 mb-4">
              {notice.title}
            </h1>
            
            <div className="flex items-center gap-2 text-gray-400 text-sm sm:text-base">
              <FaCalendar />
              <time dateTime={notice.date}>
                {new Date(notice.date).toLocaleDateString('ja-JP', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </time>
            </div>
          </div>

          <div className="prose prose-invert max-w-none">
            <div 
              className="text-gray-300 leading-relaxed notice-content"
              dangerouslySetInnerHTML={{ __html: formatText(notice.content) }}
            />
          </div>
        </div>

        {/* 追加のアクション */}
        <div className="mt-8 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all transform hover:scale-105"
          >
            <FaArrowLeft /> トップページに戻る
          </Link>
        </div>
      </div>

      {/* カスタムスタイル */}
      <style jsx global>{`
        .notice-content strong {
          color: #fbbf24;
          font-weight: 600;
        }
        
        .notice-content ul {
          margin: 1rem 0;
        }
        
        .notice-content li {
          margin: 0.5rem 0;
          color: #d1d5db;
        }
        
        .notice-content a {
          word-break: break-word;
        }
        
        .notice-content br {
          display: block;
          content: "";
          margin: 0.5rem 0;
        }
      `}</style>
    </div>
  );
}