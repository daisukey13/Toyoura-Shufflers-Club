// app/(main)/teams/page.tsx
'use client';

import React, {
  useState,
  useMemo,
  useCallback,
  lazy,
  Suspense,
  memo,
  useDeferredValue,
  useTransition,
  useEffect,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { FaUsers, FaTrophy, FaPercent, FaSearch } from 'react-icons/fa';

import { useTeamRankings, TeamRankItem } from '@/lib/hooks/useTeamRankings';
import { MobileLoadingState } from '@/components/MobileLoadingState';

/* ---------------- Suspense fallback ---------------- */
function Fallback() {
  return (
    <div className="container mx-auto px-4 py-10 text-center text-gray-300">
      画面を読み込み中…
    </div>
  );
}

/* ---------------- Virtual list (for many rows) ---------------- */
const VirtualList = lazy(() => import('@/components/VirtualList'));

/* ---------------- Rank Badge ---------------- */
const RankBadge = memo(function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="relative">
        <div className="absolute -inset-1 bg-yellow-400 rounded-full blur-sm animate-pulse" />
        <div className="relative bg-gradient-to-br from-yellow-400 to-yellow-600 text-gray-900 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-base sm:text-lg">
          1
        </div>
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="relative">
        <div className="absolute -inset-1 bg-gray-300 rounded-full blur-sm" />
        <div className="relative bg-gradient-to-br from-gray-300 to-gray-500 text-gray-900 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-base sm:text-lg">
          2
        </div>
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="relative">
        <div className="absolute -inset-1 bg-orange-500 rounded-full blur-sm" />
        <div className="relative bg-gradient-to-br from-orange-400 to-orange-600 text-gray-900 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-base sm:text-lg">
          3
        </div>
      </div>
    );
  }
  return (
    <div className="bg-purple-900/30 text-purple-300 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-sm sm:text-base">
      #{rank}
    </div>
  );
});

/* ---------------- Team Card ---------------- */
const TeamCard = memo(function TeamCard({
  team,
  rank,
}: {
  team: TeamRankItem;
  rank: number;
}) {
  const isTop3 = rank <= 3;
  const frame =
    rank === 1
      ? 'from-yellow-400/50 to-yellow-600/50'
      : rank === 2
      ? 'from-gray-300/50 to-gray-500/50'
      : rank === 3
      ? 'from-orange-400/50 to-orange-600/50'
      : 'from-purple-600/20 to-pink-600/20';

  const href = `/teams/${encodeURIComponent(String(team.id))}`;

  return (
    <Link href={href} prefetch={false} aria-label={`${team.name} のプロフィール`}>
      <div
        className={`glass-card rounded-xl p-4 sm:p-6 hover:scale-[1.02] transition-all cursor-pointer ${
          isTop3 ? 'border-2' : 'border'
        } border-gradient bg-gradient-to-r ${frame} min-h-[140px]`}
      >
        <div className="flex items-center gap-3 sm:gap-4">
          <RankBadge rank={rank} />
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-purple-600/20 border-2 border-purple-500 flex items-center justify-center">
            <FaUsers className="text-purple-200 text-xl sm:text-2xl" />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-lg sm:text-xl font-bold text-yellow-100 mb-1 truncate">
              {team.name}
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-gray-400">
              <span className="px-2 py-1 rounded-full bg-purple-900/30 text-purple-300">
                メンバー: {team.team_size ?? 0}
              </span>
              <span className="px-2 py-1 rounded-full bg-purple-900/30 text-purple-300">
                平均HC: {team.avg_hc ?? 0}
              </span>
            </div>
          </div>

          <div className="text-right flex-shrink-0">
            <div className={`text-2xl sm:text-3xl font-bold ${isTop3 ? 'text-yellow-100' : 'text-purple-300'}`}>
              {Math.round(team.avg_rp ?? 0)}
            </div>
            <div className="text-xs sm:text-sm text-gray-400">平均RP</div>
          </div>
        </div>

        <div className="mt-3 sm:mt-4 grid grid-cols-4 gap-2 sm:gap-4 text-center">
          <div className="bg-purple-900/30 rounded-lg py-1.5 sm:py-2">
            <div className="text-yellow-300 font-bold text-sm sm:text-base">{team.played ?? 0}</div>
            <div className="text-xs text-gray-500">試合</div>
          </div>
          <div className="bg-purple-900/30 rounded-lg py-1.5 sm:py-2">
            <div className="text-green-400 font-bold text-sm sm:text-base">{team.wins ?? 0}</div>
            <div className="text-xs text-gray-500">勝</div>
          </div>
          <div className="bg-purple-900/30 rounded-lg py-1.5 sm:py-2">
            <div className="text-red-400 font-bold text-sm sm:text-base">{team.losses ?? 0}</div>
            <div className="text-xs text-gray-500">敗</div>
          </div>
          <div className="bg-purple-900/30 rounded-lg py-1.5 sm:py-2">
            <div className="text-blue-400 font-bold text-sm sm:text-base">
              {team.win_pct != null ? `${(team.win_pct * 100).toFixed(1)}%` : '—'}
            </div>
            <div className="text-xs text-gray-500">勝率</div>
          </div>
        </div>
      </div>
    </Link>
  );
});

/* ---------------- Page Inner (wrapped by Suspense) ---------------- */
type SortKey = 'avg_rp' | 'win_pct' | 'name';

function TeamsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  // URL 同期: ?q= / ?sort= / ?dir=
  const initialQ = search.get('q') ?? '';
  const initialSort = (search.get('sort') as SortKey) ?? 'avg_rp';
  const initialDir =
    (search.get('dir') as 'asc' | 'desc') ?? (initialSort === 'name' ? 'asc' : 'desc');

  const [q, setQ] = useState(initialQ);
  const [sortBy, setSortBy] = useState<SortKey>(initialSort);
  const [dir, setDir] = useState<'asc' | 'desc'>(initialDir);
  const [isPending, startTransition] = useTransition();

  // URL を置換（履歴を汚さない & 空クエリで ? を残さない）
  useEffect(() => {
    const sp = new URLSearchParams();
    if (q.trim()) sp.set('q', q.trim());
    if (!(sortBy === 'avg_rp' && dir === 'desc')) {
      sp.set('sort', sortBy);
      sp.set('dir', dir);
    }
    const qs = sp.toString();
    const next = qs ? `${pathname}?${qs}` : `${pathname}`;
    router.replace(next, { scroll: false });
  }, [q, sortBy, dir, router, pathname]);

  // 取得（VIEW: team_rankings）
  const { teams, loading, error, retrying, refetch } = useTeamRankings({
    enabled: true,
    orderBy: sortBy as any,
    ascending: dir === 'asc',
  });

  // 検索はクライアント側でフィルタ
  const deferredQ = useDeferredValue(q);
  const filtered = useMemo(() => {
    const kw = deferredQ.trim().toLowerCase();
    if (!kw) return teams;
    return teams.filter((t) => (t.name ?? '').toLowerCase().includes(kw));
  }, [teams, deferredQ]);

  // ソートは念のためクライアントでも実施（安定）
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const sign = dir === 'asc' ? 1 : -1;
      if (sortBy === 'name') {
        return sign * (a.name ?? '').localeCompare(b.name ?? '');
      }
      if (sortBy === 'win_pct') {
        return sign * ((a.win_pct ?? 0) - (b.win_pct ?? 0));
      }
      // avg_rp
      return sign * ((a.avg_rp ?? 0) - (b.avg_rp ?? 0));
    });
    return arr;
  }, [filtered, sortBy, dir]);

  const renderItem = useCallback(
    (index: number) => {
      const t = sorted[index];
      if (!t) return null;
      return <TeamCard key={t.id} team={t} rank={index + 1} />;
    },
    [sorted]
  );

  return (
    <div className="container mx-auto px-4 py-6 sm:py-8">
      {/* ヘッダー */}
      <div className="text-center mb-6 sm:mb-8">
        <div className="inline-block p-3 sm:p-4 mb-3 sm:mb-4 rounded-full bg-gradient-to-br from-purple-400/20 to-pink-600/20">
          <FaUsers className="text-4xl sm:text-5xl text-purple-300" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold mb-2 sm:mb-3 text-yellow-100">チーム一覧</h1>
        <p className="text-gray-400 text-sm sm:text-base">チームの戦績と平均RPをチェック</p>
      </div>

      {/* 検索・ソート */}
      <div className="max-w-3xl mx-auto mb-6 sm:mb-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* 検索 */}
          <div className="relative flex-1">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="チーム名で検索"
              className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-purple-900/30 border border-purple-500/30 text-yellow-100 placeholder:text-gray-400 focus:outline-none focus:border-purple-400"
            />
          </div>

          {/* ソート */}
          <div className="inline-flex rounded-lg overflow-hidden shadow-lg">
            <button
              onClick={() => {
                startTransition(() => {
                  if (sortBy === 'avg_rp') setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                  else {
                    setSortBy('avg_rp');
                    setDir('desc');
                  }
                });
              }}
              className={`px-4 sm:px-6 py-2.5 sm:py-3 font-medium transition-all text-sm sm:text-base ${
                sortBy === 'avg_rp'
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                  : 'bg-purple-900/30 text-gray-400 hover:text-white'
              }`}
              aria-pressed={sortBy === 'avg_rp'}
              title="平均RP順"
            >
              <FaTrophy className="inline mr-2" />
              平均RP {isPending && sortBy === 'avg_rp' ? '…' : ''}
            </button>
            <button
              onClick={() => {
                startTransition(() => {
                  if (sortBy === 'win_pct') setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                  else {
                    setSortBy('win_pct');
                    setDir('desc');
                  }
                });
              }}
              className={`px-4 sm:px-6 py-2.5 sm:py-3 font-medium transition-all text-sm sm:text-base ${
                sortBy === 'win_pct'
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                  : 'bg-purple-900/30 text-gray-400 hover:text-white'
              }`}
              aria-pressed={sortBy === 'win_pct'}
              title="勝率順"
            >
              <FaPercent className="inline mr-2" />
              勝率 {isPending && sortBy === 'win_pct' ? '…' : ''}
            </button>
            <button
              onClick={() => {
                startTransition(() => {
                  if (sortBy === 'name') setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                  else {
                    setSortBy('name');
                    setDir('asc');
                  }
                });
              }}
              className={`px-4 sm:px-6 py-2.5 sm:py-3 font-medium transition-all text-sm sm:text-base ${
                sortBy === 'name'
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                  : 'bg-purple-900/30 text-gray-400 hover:text-white'
              }`}
              aria-pressed={sortBy === 'name'}
              title="名前順"
            >
              名前 {isPending && sortBy === 'name' ? '…' : ''}
            </button>
          </div>
        </div>

        {/* 現在の並び方向 */}
        <div className="mt-2 text-center sm:text-right text-xs text-gray-400">
          並び: {sortBy} / {dir === 'asc' ? '昇順' : '降順'}
        </div>
      </div>

      {/* ローディング / エラー / 空 */}
      <MobileLoadingState
        loading={loading}
        error={error}
        retrying={retrying}
        onRetry={refetch}
        emptyMessage="登録チームがありません"
        dataLength={teams.length}
      />

      {/* リスト */}
      {!loading && !error && teams.length > 0 && (
        <>
          {/* 簡単な統計 */}
          <div className="mb-6 sm:mb-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="glass-card rounded-xl p-4 sm:p-6 text-center border border-pink-500/20">
              <FaUsers className="text-3xl sm:text-4xl text-pink-400 mx-auto mb-2 sm:mb-3" />
              <div className="text-2xl sm:text-3xl font-bold text-yellow-100 mb-1">
                {teams.length}
              </div>
              <div className="text-gray-400 text-xs sm:text-base">登録チーム</div>
            </div>
            <div className="glass-card rounded-xl p-4 sm:p-6 text-center border border-yellow-500/20">
              <FaTrophy className="text-3xl sm:text-4xl text-yellow-400 mx-auto mb-2 sm:mb-3" />
              <div className="text-2xl sm:text-3xl font-bold text-yellow-100 mb-1">
                {Math.round(
                  [...teams].sort((a, b) => (b.avg_rp ?? 0) - (a.avg_rp ?? 0))[0]?.avg_rp ?? 0
                )}
              </div>
              <div className="text-gray-400 text-xs sm:text-base">最高平均RP</div>
            </div>
            <div className="glass-card rounded-xl p-4 sm:p-6 text-center border border-purple-500/20">
              <FaPercent className="text-3xl sm:text-4xl text-purple-400 mx-auto mb-2 sm:mb-3" />
              <div className="text-2xl sm:text-3xl font-bold text-yellow-100 mb-1">
                {teams.length > 0
                  ? Math.round(teams.reduce((s, r) => s + (r.avg_rp ?? 0), 0) / teams.length)
                  : 0}
              </div>
              <div className="text-gray-400 text-xs sm:text-base">平均RPの平均</div>
            </div>
          </div>

          {sorted.length <= 24 ? (
            <div className="space-y-3 sm:space-y-4">
              {sorted.map((t, i) => (
                <TeamCard key={t.id} team={t} rank={i + 1} />
              ))}
            </div>
          ) : (
            <Suspense fallback={<div className="text-center py-6">リストを読み込み中…</div>}>
              <VirtualList
                items={sorted}
                height={600}
                itemHeight={160}
                renderItem={renderItem}
                className="space-y-3 sm:space-y-4"
              />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- Default export: wrap with Suspense ---------------- */
export default function TeamsPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <TeamsInner />
    </Suspense>
  );
}
