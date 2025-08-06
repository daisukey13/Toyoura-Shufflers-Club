// app/notices/[id]/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { FaArrowLeft, FaCalendar } from 'react-icons/fa';

const supabase = createClient();

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
  const params = useParams();
  const router = useRouter();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (params.id) {
      fetchNotice(params.id as string);
    }
  }, [params.id]);

  const fetchNotice = async (id: string) => {
    try {
      const { data, error } = await supabase
        .from('notices')
        .select('*')
        .eq('id', id)
        .eq('is_published', true)
        .single();

      if (error || !data) {
        router.push('/');
        return;
      }

      setNotice(data);
    } catch (error) {
      console.error('Error fetching notice:', error);
      router.push('/');
    } finally {
      setLoading(false);
    }
  };

  // formatTextの修正版（該当部分のみ）
const formatText = (text: string) => {
  if (!text) return '';
  
  let formatted = text;
  
  // 太字
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // リンク
  formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300 underline">$1</a>');
  
  // リスト
  formatted = formatted.replace(/^- (.+)$/gm, '<li>$1</li>');
  // sフラグを使わずに、改行を含む文字列をマッチ
  formatted = formatted.replace(/(<li>[\s\S]*<\/li>)/, '<ul>$1</ul>');
  
  // 改行
  formatted = formatted.replace(/\n/g, '<br />');
  
  return formatted;
};

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">読み込み中...</div>
      </div>
    );
  }

  if (!notice) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">お知らせが見つかりません</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-4xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 mb-8 transition-colors"
        >
          <FaArrowLeft /> トップページに戻る
        </Link>

        <div className="glass-card rounded-xl p-8">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-yellow-100 mb-4">
              {notice.title}
            </h1>
            
            <div className="flex items-center gap-2 text-gray-400">
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
              className="text-gray-300 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: formatText(notice.content) }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}