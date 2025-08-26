// app/components/TopNotices.tsx
import { supabaseServer } from '@/lib/supabase-server';
import Link from 'next/link';

type Notice = {
  id: string;
  title: string;
  body: string;
  published_at: string | null;
  pinned: boolean;
};

export default async function TopNotices() {
  const { data, error } = await supabaseServer
    .from('notices')
    .select('id, title, body, published_at, pinned')
    .eq('status', 'published')
    .lte('published_at', new Date().toISOString())
    .order('pinned', { ascending: false })
    .order('published_at', { ascending: false })
    .limit(5);

  if (error) {
    // 失敗時は静かに非表示
    return null;
  }
  const notices = (data ?? []) as Notice[];
  if (notices.length === 0) return null;

  return (
    <section className="container mx-auto px-4 py-6">
      <h2 className="text-xl font-semibold mb-3 text-white">お知らせ</h2>
      <ul className="space-y-3">
        {notices.map((n) => (
          <li key={n.id} className="rounded-lg border border-purple-500/20 bg-gray-900/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-medium text-white">
                {n.pinned && <span className="mr-2 inline-block rounded bg-purple-600 px-2 py-0.5 text-xs">重要</span>}
                {n.title}
              </h3>
              {n.published_at && (
                <time className="text-xs text-gray-400">
                  {new Date(n.published_at).toLocaleDateString('ja-JP')}
                </time>
              )}
            </div>
            <p className="mt-2 text-sm text-gray-300 line-clamp-3 whitespace-pre-wrap">
              {n.body}
            </p>
            {/* 必要なら詳細ページへ */}
            {/* <Link href={`/notices/${n.id}`} className="mt-2 inline-block text-sm text-purple-300 underline">続きを読む</Link> */}
          </li>
        ))}
      </ul>
      {/* 一覧ページを作る場合 */}
      {/* <div className="mt-4">
        <Link href="/notices" className="text-sm text-purple-300 underline">お知らせをもっと見る</Link>
      </div> */}
    </section>
  );
}
