// app/(main)/page.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  FaTrophy,
  FaUsers,
  FaChartLine,
  FaHistory,
  FaUserPlus,
  FaCalendar,
  FaSignInAlt,
  FaMedal,
  FaGamepad,
  FaStar,
  FaFlagCheckered,
  FaCrown,
} from 'react-icons/fa';

const supabase = createClient();

interface Stats {
  totalMatches: number;
  activeMembers: number;
  avgRankingPoint: number;
}

interface TopPlayer {
  id: string;
  handle_name: string;
  avatar_url: string | null;
  ranking_points: number;
  handicap: number;
  wins?: number | null;
  losses?: number | null;
}

type RecentMatch = {
  id: string;
  match_date: string;
  mode?: string | null; // 'singles' | 'teams'
  is_tournament?: boolean | null;
  tournament_name?: string | null;
  venue?: string | null;
  notes?: string | null;

  // 個人戦
  winner_id?: string | null;
  winner_name?: string | null;
  winner_avatar?: string | null;
  winner_current_points?: number | null;
  winner_current_handicap?: number | null;
  winner_points_change?: number | null;

  loser_id?: string | null;
  loser_name?: string | null;
  loser_avatar?: string | null;
  loser_score?: number | null;
  loser_current_points?: number | null;
  loser_current_handicap?: number | null;
  loser_points_change?: number | null;

  // 団体戦（unified_match_feed から）
  winner_team_id?: string | null;
  winner_team_name?: string | null;
  winner_team_avatars?: string[] | null;
  loser_team_id?: string | null;
  loser_team_name?: string | null;
  loser_team_avatars?: string[] | null;
};

type MemberLite = { id: string; handle_name: string; avatar_url: string | null };

export default function HomePage() {
  const [stats, setStats] = useState<Stats>({
    totalMatches: 0,
    activeMembers: 0,
    avgRankingPoint: 1000,
  });
  const [topPlayers, setTopPlayers] = useState<TopPlayer[]>([]);
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([]);
  const [notices, setNotices] = useState<any[]>([]);
  const [teamMembersMap, setTeamMembersMap] = useState<Record<string, MemberLite[]>>({}); // team_id -> members[]

  const router = useRouter();
  const { user, player, loading } = useAuth();

  useEffect(() => {
    fetchStats();
    fetchTopPlayers();
    fetchRecentMatches();
    fetchNotices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // （任意）ログイン済みなら自動遷移
  useEffect(() => {
    if (user && player && !loading) {
      if (player.is_admin) router.push('/admin/dashboard');
      else router.push(`/players/${player.id}`);
    }
  }, [user, player, loading, router]);

  const fetchStats = async () => {
    try {
      const [matchesResult, playersResult] = await Promise.all([
        supabase.from('matches').select('id', { count: 'exact', head: true }),
        supabase.from('players').select('id, ranking_points, is_active').eq('is_admin', false),
      ]);

      const players = playersResult.data ?? [];
      const activePlayers = players.filter((p) => (p as any).is_active);
      const avgPoints =
        players.length > 0
          ? Math.round(players.reduce((sum: number, p: any) => sum + (p.ranking_points ?? 0), 0) / players.length)
          : 1000;

      setStats({
        totalMatches: matchesResult.count || 0,
        activeMembers: activePlayers.length,
        avgRankingPoint: avgPoints,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchTopPlayers = async () => {
    try {
      const { data } = await supabase
        .from('players')
        .select('id, handle_name, avatar_url, ranking_points, handicap, wins, losses')
        .eq('is_active', true)
        .eq('is_admin', false)
        .order('ranking_points', { ascending: false })
        .limit(5);

      setTopPlayers(data ?? []);
    } catch (error) {
      console.error('Error fetching top players:', error);
    }
  };

  // unified_match_feed（個人/チーム混在）→ フォールバックで match_details
  const fetchRecentMatches = async () => {
    try {
      let data: RecentMatch[] | null = null;

      // トライ1: unified_match_feed
      {
        const res = await supabase
          .from('unified_match_feed')
          .select('*')
          .order('match_date', { ascending: false })
          .limit(6);

        if (!res.error && res.data) data = res.data as RecentMatch[];
      }

      // フォールバック: match_details（個人戦ビュー）
      if (!data) {
        const res = await supabase
          .from('match_details')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(6);
        if (!res.error) data = (res.data ?? []).map((m: any) => ({ ...m, mode: 'singles' })) as RecentMatch[];
      }

      setRecentMatches(data ?? []);
    } catch (error) {
      console.error('Error fetching recent matches:', error);
    }
  };

  const fetchNotices = async () => {
    try {
      const { data, error } = await supabase
        .from('notices')
        .select('*')
        .eq('is_published', true)
        .order('date', { ascending: false })
        .limit(3);

    if (error) {
        console.error('Error fetching notices:', error);
        return;
      }
      setNotices(data ?? []);
    } catch (error) {
      console.error('Error fetching notices:', error);
    }
  };

  const menuItems = [
    { icon: FaChartLine, title: 'ランキング', description: '最新のランキング', href: '/rankings' },
    { icon: FaUsers, title: 'メンバー', description: 'クラブメンバーを見る', href: '/players' },
    { icon: FaHistory, title: '試合結果', description: '過去の試合をチェック', href: '/matches' },
    { icon: FaUserPlus, title: '試合登録', description: '新しい試合を登録', href: '/matches/register' },
  ];

  const winRate = (w?: number | null, l?: number | null) => {
    const W = w ?? 0;
    const L = l ?? 0;
    const g = W + L;
    return g > 0 ? Math.round((W / g) * 100) : 0;
  };

  // チーム戦の堅牢判定
  const isTeamMatch = (m: RecentMatch) =>
    (m.mode && m.mode.toLowerCase() === 'teams') ||
    !!m.winner_team_id ||
    !!m.loser_team_id ||
    !!m.winner_team_name ||
    !!m.loser_team_name;

  // 最近の試合に出てくるチームのメンバー（アバター＋ハンドルネーム）を一括取得
  useEffect(() => {
    const loadTeamMembers = async () => {
      try {
        const ids = Array.from(
          new Set(
            recentMatches
              .filter(isTeamMatch)
              .flatMap((m) => [m.winner_team_id, m.loser_team_id])
              .filter((x): x is string => !!x)
          )
        );

        // 既に取得済みの team_id を除外（再フェッチ抑制）
        const missing = ids.filter((id) => !(id in teamMembersMap));
        if (missing.length === 0) return;

        // team_members から player_id を収集
        const { data: tm, error: tmErr } = await supabase
          .from('team_members')
          .select('team_id, player_id')
          .in('team_id', missing);

        if (tmErr) {
          console.error('fetch team_members error:', tmErr);
          return;
        }

        const playerIds = Array.from(new Set((tm ?? []).map((r) => (r as any).player_id)));
        if (playerIds.length === 0) return;

        // players 情報取得
        const { data: ps, error: pErr } = await supabase
          .from('players')
          .select('id, handle_name, avatar_url')
          .in('id', playerIds);

        if (pErr) {
          console.error('fetch players error:', pErr);
          return;
        }

        const pMap = new Map<string, MemberLite>();
        (ps ?? []).forEach((p) => {
          pMap.set((p as any).id, {
            id: (p as any).id,
            handle_name: (p as any).handle_name,
            avatar_url: (p as any).avatar_url ?? null,
          });
        });

        // team_id -> members[] の形に整形（ハンドルネーム昇順）
        const grouped: Record<string, MemberLite[]> = {};
        (tm ?? []).forEach((row) => {
          const tid = (row as any).team_id as string;
          const pid = (row as any).player_id as string;
          const member = pMap.get(pid);
          if (!member) return;
          if (!grouped[tid]) grouped[tid] = [];
          grouped[tid].push(member);
        });
        Object.keys(grouped).forEach((tid) => {
          grouped[tid] = grouped[tid]
            .sort((a, b) => a.handle_name.localeCompare(b.handle_name, 'ja'))
            .slice(0, 4); // 表示は最大4名
        });

        setTeamMembersMap((prev) => ({ ...prev, ...grouped }));
      } catch (e) {
        console.error('loadTeamMembers unexpected error:', e);
      }
    };

    if (recentMatches.length) {
      void loadTeamMembers();
    }
  }, [recentMatches, teamMembersMap]);

  // null/undefined 安全な Link ラッパ
  const MaybeLink = ({ href, children }: { href?: string; children: React.ReactNode }) =>
    href ? <Link href={href}>{children}</Link> : <div>{children}</div>;

  // メンバー列（アバター＋名前を横並び）
  const TeamMembersInline = ({
    teamId,
  }: {
    teamId?: string | null;
  }) => {
    const members = useMemo(() => {
      if (!teamId) return [] as MemberLite[];
      return teamMembersMap[teamId] ?? [];
    }, [teamId, teamMembersMap]);

    if (!teamId) return null;
    if (members.length === 0) return null;

    return (
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {members.map((mem) => (
          <div key={mem.id} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-gray-900/40">
            <Image
              src={mem.avatar_url || '/default-avatar.png'}
              alt={mem.handle_name}
              width={20}
              height={20}
              className="w-5 h-5 rounded-full border border-purple-500 object-cover"
              unoptimized
            />
            <span className="text-[11px] text-gray-200 max-w-[6.5rem] truncate">{mem.handle_name}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen">
      {/* ヒーローセクション */}
      <div className="relative py-10 sm:py-20 text-center">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -inset-24 bg-[radial-gradient(ellipse_at_top_right,rgba(168,85,247,0.20),transparent_60%)]" />
          <div className="absolute -inset-24 bg-[radial-gradient(ellipse_at_bottom_left,rgba(236,72,153,0.18),transparent_60%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-purple-900/20 to-transparent" />
        </div>

        <div className="relative z-10 px-4">
          <div className="mb-6 sm:mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 sm:w-20 sm:h-20 mb-3 sm:mb-4 rounded-full bg-gradient-to-br from-yellow-400/20 to-orange-600/20 backdrop-blur-sm border border-yellow-400/30 shadow-lg">
              <span className="text-2xl sm:text-4xl">🏆</span>
            </div>

            <h1 className="font-bold tracking-tight mb-2">
              <span className="sm:hidden">
                <span className="block text-2xl bg-gradient-to-r from-yellow-300 to-orange-400 bg-clip-text text-transparent">
                  豊浦シャッフラーズ
                </span>
                <span className="block text-lg text-yellow-200">CLUB</span>
              </span>
              <span className="hidden sm:inline-block text-5xl lg:text-6xl bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text text-transparent">
                豊浦シャッフラーズクラブ
              </span>
            </h1>

            <div className="flex items-center justify-center gap-1 mb-3">
              <div className="w-8 h-px bg-gradient-to-r from-transparent to-yellow-400/50" />
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
              <div className="w-8 h-px bg-gradient-to-l from-transparent to-yellow-400/50" />
            </div>

            <p className="text-sm sm:text-lg text-gray-300 max-w-xs sm:max-w-md mx-auto">
              みんなで楽しくシャッフルボード！
            </p>
          </div>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-xs mx-auto sm:max-w-none">
            <Link
              href="/register"
              className="gradient-button px-6 py-2.5 sm:px-8 sm:py-3 rounded-full text-white font-medium text-sm sm:text-base flex items-center justify-center gap-2"
            >
              <FaUserPlus className="text-sm" /> 新規登録
            </Link>
            <Link
              href="/login"
              className="px-6 py-2.5 sm:px-8 sm:py-3 rounded-full border border-purple-500 text-purple-400 hover:bg-purple-500/10 transition-colors font-medium text-sm sm:text-base flex items-center justify-center gap-2"
            >
              <FaSignInAlt className="text-sm" /> ログイン
            </Link>
          </div>

          {/* お知らせ */}
          {notices.length > 0 && (
            <div className="mt-8 sm:mt-12 max-w-2xl mx-auto">
              <h3 className="text-base sm:text-lg font-semibold text-yellow-300 mb-3 sm:mb-4 flex items-center justify-center gap-2">
                <span className="text-lg sm:text-base">📢</span>
                <span>お知らせ</span>
              </h3>
              <div className="space-y-2">
                {notices.map((notice) => (
                  <Link
                    key={notice.id}
                    href={`/notices/${notice.id}`}
                    className="block glass-card rounded-lg px-3 sm:px-4 py-2.5 sm:py-3 hover:bg-purple-900/20 transition-all group"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 min-w-0">
                        <span className="text-xs sm:text-sm text-gray-400 flex-shrink-0">
                          {new Date(notice.date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                        </span>
                        <span className="text-sm sm:text-base text-yellow-100 group-hover:text-yellow-300 transition-colors truncate">
                          {notice.title}
                        </span>
                      </div>
                      <span className="text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-sm">
                        →
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* メニューグリッド */}
      <div className="container mx-auto px-4 py-8 sm:py-12">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-8 sm:mb-12">
          {menuItems.map((item, index) => {
            const cardClass =
              index === 0 ? 'ranking-card' : index === 1 ? 'members-card' : index === 2 ? 'matches-card' : 'register-card';
            return (
              <Link key={index} href={item.href}>
                <div className={`${cardClass} glass-card rounded-xl p-4 sm:p-6 hover:scale-105 transition-transform cursor-pointer group h-full`}>
                  <div className="flex flex-col items-center text-center">
                    <div className="p-3 sm:p-4 rounded-full bg-gradient-to-br from-purple-600/20 to-pink-600/20 mb-2 sm:mb-4 group-hover:scale-110 transition-transform">
                      <item.icon className="text-xl sm:text-3xl text-purple-400" />
                    </div>
                    <h3 className="text-base sm:text-lg font-semibold mb-1 sm:mb-2 text-yellow-100">{item.title}</h3>
                    <p className="text-xs sm:text-sm text-gray-400 hidden sm:block">{item.description}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* 統計 */}
        <div className="grid grid-cols-3 gap-3 sm:gap-6 mb-8 sm:mb-12">
          <div className="glass-card rounded-xl p-3 sm:p-6 text-center border border-pink-500/20">
            <FaUsers className="text-2xl sm:text-4xl text-pink-400 mx-auto mb-2 sm:mb-3" />
            <div className="text-xl sm:text-3xl font-bold mb-1 text-yellow-100">{stats.activeMembers}</div>
            <div className="text-xs sm:text-base text-gray-400">メンバー</div>
          </div>
          <div className="glass-card rounded-xl p-3 sm:p-6 text-center border border-yellow-500/20">
            <FaCalendar className="text-2xl sm:text-4xl text-yellow-400 mx-auto mb-2 sm:mb-3" />
            <div className="text-xl sm:text-3xl font-bold mb-1 text-yellow-100">{stats.totalMatches}</div>
            <div className="text-xs sm:text-base text-gray-400">試合数</div>
          </div>
          <div className="glass-card rounded-xl p-3 sm:p-6 text-center border border-blue-500/20">
            <FaChartLine className="text-2xl sm:text-4xl text-blue-400 mx-auto mb-2 sm:mb-3" />
            <div className="text-xl sm:text-3xl font-bold mb-1 text-yellow-100">{stats.avgRankingPoint}</div>
            <div className="text-xs sm:text-base text-gray-400">平均pts</div>
          </div>
        </div>

        {/* トッププレーヤー */}
        <div className="mb-8 sm:mb-12">
          <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center gap-2 text-yellow-100">
            <FaTrophy className="text-yellow-400 text-lg sm:text-2xl" />
            トッププレーヤー
          </h2>

          {/* モバイル: 1〜5位を縦に（行サイズ 10/7/5/3/3） */}
          <div className="sm:hidden space-y-2">
            {topPlayers.slice(0, 5).map((p, idx) => {
              const rank = idx + 1;
              const sizeMap = {
                1: { h: 'min-h-[10rem]', av: 72, badge: 'w-12 h-12 text-2xl', name: 'text-base', rp: 'text-base' },
                2: { h: 'min-h-[7rem]', av: 60, badge: 'w-11 h-11 text-xl', name: 'text-base', rp: 'text-sm' },
                3: { h: 'min-h-[5rem]', av: 52, badge: 'w-10 h-10 text-lg', name: 'text-sm', rp: 'text-sm' },
                4: { h: 'min-h-[3rem]', av: 44, badge: 'w-9 h-9 text-base', name: 'text-sm', rp: 'text-xs' },
                5: { h: 'min-h-[3rem]', av: 44, badge: 'w-9 h-9 text-base', name: 'text-sm', rp: 'text-xs' },
              } as const;
              const s = (sizeMap as any)[rank] ?? sizeMap[5];

              const badgeColor =
                rank === 1 ? 'bg-yellow-400 text-gray-900' : rank === 2 ? 'bg-gray-300 text-gray-900' : rank === 3 ? 'bg-orange-500 text-white' : 'bg-purple-600 text-white';

              return (
                <Link key={p?.id ?? `rank-${rank}`} href={p ? `/players/${p.id}` : '#'}>
                  <div className={`glass-card rounded-xl px-3 py-3 border ${rank === 1 ? 'border-2 border-yellow-400/70 shadow-yellow-400/20' : 'border-purple-500/30' } ${s.h}`}>
                    <div className="flex items-center gap-3">
                      {/* 順位バッジ（大きく） */}
                      <div className={`rounded-full ${badgeColor} ${s.badge} font-extrabold flex items-center justify-center shrink-0`}>
                        {rank}
                      </div>

                      {/* アバター */}
                      <div className="relative shrink-0">
                        <Image
                          src={p?.avatar_url || '/default-avatar.png'}
                          alt={p?.handle_name || `Rank ${rank}`}
                          width={s.av}
                          height={s.av}
                          className={`rounded-full object-cover border-2 ${rank === 1 ? 'border-yellow-400' : 'border-purple-500'}`}
                          unoptimized
                        />
                        {rank === 1 && (
                          <div className="absolute -top-2 -right-2 bg-yellow-400 text-gray-900 rounded-full px-2 py-1 text-[10px] font-bold flex items-center gap-1 shadow">
                            <FaCrown /> 1位
                          </div>
                        )}
                      </div>

                      {/* 情報 */}
                      <div className="flex-1 min-w-0">
                        <div className={`font-semibold text-yellow-100 truncate ${s.name}`}>{p?.handle_name ?? '—'}</div>
                        <div className="text-xs text-gray-400">HC {p?.handicap ?? '—'}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full bg-purple-900/40 text-purple-200 border border-purple-500/30 ${s.rp}`}>
                            RP <b className="text-yellow-100 ml-1">{p?.ranking_points ?? '—'}</b>
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-200 border border-blue-500/30 text-xs">
                            勝率 <b className="text-yellow-100 ml-1">{winRate(p?.wins, p?.losses)}%</b>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* PC/タブレット: 1〜5位を横一列で反比例スケール（中央=1位、左右に2・3位、端に4・5位） */}
          <div className="hidden sm:grid grid-cols-5 gap-4 items-end">
            {/* 表示順のインデックス: [4位, 2位, 1位, 3位, 5位] */}
            {[3, 1, 0, 2, 4].map((idx) => {
              const p = topPlayers[idx];
              const rank = idx + 1;

              // 反比例スケール（サイズ）
              const sizeByRank = (r: number) => {
                switch (r) {
                  case 1: return { cardH: 'min-h-[18rem]', avatar: 110, badge: 'w-10 h-10 text-base', ring: 'ring-4', border: 'border-4 border-yellow-400/70', glow: 'shadow-xl shadow-yellow-400/20', pill: 'text-base' };
                  case 2: return { cardH: 'min-h-[15rem]', avatar: 92,  badge: 'w-9 h-9 text-sm',  ring: 'ring-2', border: 'border-2 border-gray-300/80',  glow: 'shadow-lg shadow-gray-300/10',  pill: 'text-sm'  };
                  case 3: return { cardH: 'min-h-[13rem]', avatar: 84,  badge: 'w-9 h-9 text-sm',  ring: 'ring-2', border: 'border-2 border-orange-500/80',glow: 'shadow-lg shadow-orange-400/10', pill: 'text-sm'  };
                  case 4: return { cardH: 'min-h-[11rem]', avatar: 72,  badge: 'w-8 h-8 text-xs',  ring: 'ring-0', border: 'border border-purple-400/40', glow: 'shadow',                    pill: 'text-xs'  };
                  default:return { cardH: 'min-h-[10rem]', avatar: 64,  badge: 'w-8 h-8 text-xs',  ring: 'ring-0', border: 'border border-purple-400/40', glow: 'shadow',                    pill: 'text-xs'  };
                }
              };
              const S = sizeByRank(rank);

              // 枠カラー（トップ3はメダル色）
              const frame =
                rank === 1
                  ? 'from-yellow-400/25 to-yellow-600/25'
                  : rank === 2
                  ? 'from-gray-300/20 to-gray-500/20'
                  : rank === 3
                  ? 'from-orange-400/20 to-orange-600/20'
                  : 'from-purple-600/10 to-pink-600/10';

              const badgeColor =
                rank === 1 ? 'bg-yellow-400 text-gray-900' : rank === 2 ? 'bg-gray-300 text-gray-900' : rank === 3 ? 'bg-orange-500 text-white' : 'bg-purple-600 text-white';

              return (
                <Link key={`rank-card-${rank}`} href={p ? `/players/${p.id}` : '#'}>
                  <div
                    className={[
                      'relative glass-card rounded-xl p-4 text-center bg-gradient-to-b transition-transform hover:scale-[1.02]',
                      frame,
                      S.border,
                      S.glow,
                      S.cardH,
                      'flex flex-col items-center justify-between',
                    ].join(' ')}
                    aria-label={`第${rank}位 ${p?.handle_name ?? ''}`}
                  >
                    {/* 順位バッジ */}
                    <div className={`absolute -top-3 -right-3 ${badgeColor} ${S.badge} rounded-full font-extrabold flex items-center justify-center shadow`}>
                      {rank}
                    </div>

                    {/* 1位の王冠 */}
                    {rank === 1 && (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1 rounded-full bg-yellow-400 text-gray-900 text-xs font-bold shadow">
                        <FaCrown />
                        CHAMPION
                      </div>
                    )}

                    {/* アバター */}
                    <div className="relative mt-4">
                      <Image
                        src={p?.avatar_url || '/default-avatar.png'}
                        alt={p?.handle_name || `Rank ${rank}`}
                        width={S.avatar}
                        height={S.avatar}
                        className="rounded-full object-cover border-2 border-purple-500"
                        unoptimized
                      />
                      {/* 外周リングで強弱 */}
                      <div className={`absolute inset-0 rounded-full ring-yellow-400/40 ${S.ring} pointer-events-none`} />
                    </div>

                    {/* 名前・補足 */}
                    <div className="mt-3">
                      <div className="font-semibold text-yellow-100 text-base truncate max-w-[10rem]">{p?.handle_name ?? '—'}</div>
                      <div className="text-xs text-gray-400 mt-0.5">HC {p?.handicap ?? '—'}</div>
                    </div>

                    {/* RP / 勝率 */}
                    <div className="mt-3 flex items-center justify-center gap-2">
                      <span className={`px-2 py-1 rounded-full bg-purple-900/40 text-purple-200 border border-purple-500/30 ${S.pill}`}>
                        RP <b className="text-yellow-100 ml-1">{p?.ranking_points ?? '—'}</b>
                      </span>
                      <span className={`px-2 py-1 rounded-full bg-blue-900/40 text-blue-200 border border-blue-500/30 ${S.pill}`}>
                        勝率 <b className="text-yellow-100 ml-1">{winRate(p?.wins, p?.losses)}%</b>
                      </span>
                    </div>

                    {/* 台座 */}
                    <div
                      className={[
                        'w-full mt-4 rounded-lg bg-gradient-to-b from-white/5 to-transparent',
                        rank === 1 ? 'h-16' : rank === 2 ? 'h-12' : rank === 3 ? 'h-11' : rank === 4 ? 'h-9' : 'h-8',
                      ].join(' ')}
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* 最近の試合（チーム戦の表示・リンク判定を堅牢化＋メンバー名/アバター列） */}
        <div>
          <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center gap-2 text-yellow-100">
            <FaHistory className="text-blue-400 text-lg sm:text-2xl" />
            最近の試合
          </h2>

          <div className="space-y-3">
            {recentMatches.slice(0, 5).map((m) => {
              const scoreDiff = 15 - (m.loser_score ?? 0);
              const upset =
                (m.winner_current_points ?? 0) < (m.loser_current_points ?? 0) - 100 ||
                (m.winner_current_handicap ?? 0) > (m.loser_current_handicap ?? 0) + 5;

              const dateLabel = new Date(m.match_date).toLocaleString('ja-JP', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              const team = isTeamMatch(m);

              const ModeBadge = (
                <span className="px-2 py-0.5 rounded-full text-xs border bg-purple-900/30 border-purple-500/30 text-purple-200">
                  <FaGamepad className="inline mr-1" />
                  {team ? '団体戦' : '個人戦'}
                </span>
              );

              const TourBadge =
                m.is_tournament && m.tournament_name ? (
                  <span className="px-2 py-0.5 rounded-full text-xs border bg-amber-900/20 border-amber-500/40 text-amber-300">
                    <FaMedal className="inline mr-1" />
                    {m.tournament_name}
                  </span>
                ) : null;

              const ResultPill = (
                <div
                  className={`inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full shadow-lg ${
                    scoreDiff >= 10
                      ? 'bg-gradient-to-r from-red-500/80 to-red-600/80'
                      : scoreDiff >= 5
                      ? 'bg-gradient-to-r from-orange-500/80 to-orange-600/80'
                      : 'bg-gradient-to-r from-blue-500/80 to-blue-600/80'
                  }`}
                  title={`点差 ${scoreDiff}`}
                >
                  <span className="text-white font-bold text-sm sm:text-base">VS</span>
                </div>
              );

              // リンク先（存在するIDがある場合のみリンク）
              const winnerHref = team
                ? (m.winner_team_id ? `/teams/${m.winner_team_id}` : undefined)
                : (m.winner_id ? `/players/${m.winner_id}` : undefined);

              const loserHref = team
                ? (m.loser_team_id ? `/teams/${m.loser_team_id}` : undefined)
                : (m.loser_id ? `/players/${m.loser_id}` : undefined);

              // 名前
              const winnerName = team ? (m.winner_team_name ?? m.winner_name ?? '—') : (m.winner_name ?? '—');
              const loserName = team ? (m.loser_team_name ?? m.loser_name ?? '—') : (m.loser_name ?? '—');

              // アバター（個人戦は従来通り、団体戦は TeamMembersInline で別途表示）
              const WinnerAvatar = !team ? (
                <Image
                  src={m.winner_avatar || '/default-avatar.png'}
                  alt={winnerName}
                  width={40}
                  height={40}
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 border-purple-500 object-cover"
                  unoptimized
                />
              ) : null;

              const LoserAvatar = !team ? (
                <Image
                  src={m.loser_avatar || '/default-avatar.png'}
                  alt={loserName}
                  width={40}
                  height={40}
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 border-purple-500 object-cover"
                  unoptimized
                />
              ) : null;

              return (
                <div
                  key={m.id}
                  className={`glass-card rounded-lg p-3 sm:p-4 relative border ${
                    upset ? 'border-yellow-500/50 shadow-lg shadow-yellow-500/10' : 'border-purple-500/30'
                  }`}
                >
                  {/* ヘッダー行 */}
                  <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm mb-3">
                    <span className="text-gray-400">
                      <FaCalendar className="inline mr-1" />
                      {dateLabel}
                    </span>
                    {ModeBadge}
                    {TourBadge}
                    {scoreDiff >= 10 && (
                      <span className="px-2 py-0.5 rounded-full text-xs border bg-rose-900/30 border-rose-500/50 text-rose-200">
                        <FaFlagCheckered className="inline mr-1" />
                        快勝
                      </span>
                    )}
                    {upset && (
                      <span className="px-2 py-0.5 rounded-full text-xs border bg-yellow-500/20 border-yellow-500/40 text-yellow-300">
                        <FaStar className="inline mr-1" />
                        番狂わせ
                      </span>
                    )}
                  </div>

                  {/* 本文（勝者 / VS / 敗者） */}
                  <div className="grid sm:grid-cols-3 items-center gap-3 sm:gap-4">
                    {/* 勝者 */}
                    <MaybeLink href={winnerHref}>
                      <div className="flex items-start gap-3 p-2.5 rounded-lg bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 hover:border-green-400/50 transition">
                        {!team && WinnerAvatar}
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-yellow-100 truncate">
                            {winnerName}
                          </div>
                          <div className="text-xs text-green-400">勝利</div>

                          {/* 団体戦: メンバー列（アバター＋名前） */}
                          {team && <TeamMembersInline teamId={m.winner_team_id} />}
                        </div>
                        <div className="text-right">
                          <div className="text-xl sm:text-2xl font-bold text-yellow-100">15</div>
                        </div>
                      </div>
                    </MaybeLink>

                    {/* VS */}
                    <div className="text-center">
                      {ResultPill}
                    </div>

                    {/* 敗者 */}
                    <MaybeLink href={loserHref}>
                      <div className="flex items-start gap-3 p-2.5 rounded-lg bg-gradient-to-r from-red-500/10 to-pink-500/10 border border-red-500/30 hover:border-red-400/50 transition">
                        <div className="flex-1 min-w-0 order-2 sm:order-1 text-right">
                          <div className="font-semibold text-yellow-100 truncate">
                            {loserName}
                          </div>
                          <div className="text-xs text-red-400">敗北</div>

                          {/* 団体戦: メンバー列（アバター＋名前） */}
                          {team && <TeamMembersInline teamId={m.loser_team_id} />}
                        </div>
                        {!team && LoserAvatar}
                        <div className="order-3 text-right">
                          <div className="text-xl sm:text-2xl font-bold text-yellow-100">{m.loser_score ?? 0}</div>
                        </div>
                      </div>
                    </MaybeLink>
                  </div>

                  {/* 備考 */}
                  {m.notes && (
                    <div className="mt-3 p-2 bg-gray-800/40 rounded-lg border-l-4 border-purple-500/50 text-xs text-gray-300">
                      {m.notes}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="text-center mt-4 sm:mt-6">
            <Link href="/matches" className="text-purple-400 hover:text-purple-300 transition-colors text-sm sm:text-base">
              すべての試合を見る →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
