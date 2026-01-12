// components/HomeRecentMatches.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image, { type ImageLoaderProps } from 'next/image';

const passthroughLoader = ({ src }: ImageLoaderProps) => src;

type PlayerMini = {
  id: string;
  handle_name: string | null;
  avatar_url: string | null;
};

type RecentMatch = {
  id: string;
  match_date: string | null;
  match_type: string | null;
  is_team: boolean | null;
  is_tournament: boolean | null;
  player_a_id: string | null;
  player_b_id: string | null;
  winner_id: string | null;
  loser_id: string | null;
  winner_score: number | null;
  loser_score: number | null;
  end_reason: string | null;
  time_limit_seconds: number | null;
  player_a: PlayerMini | null;
  player_b: PlayerMini | null;
};

function fmtJP(dt: string | null) {
  if (!dt) return '';
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return '';
  const md = d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
  const tm = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  return `${md} ${tm}`;
}

function endReasonLabel(end: string | null) {
  if (!end || end === 'normal') return null;
  if (end === 'time_limit') return '時間制限';
  if (end === 'walkover') return '不戦勝';
  if (end === 'forfeit') return '途中棄権';
  return end;
}

export default function HomeRecentMatches({ limit = 5 }: { limit?: number }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<RecentMatch[]>([]);
  const [imgError, setImgError] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/public/recent-matches?limit=${limit}`, { cache: 'no-store' });
        const j = await res.json().catch(() => null);

        if (!res.ok || !j?.ok) {
          throw new Error(j?.message ?? '最近の試合の取得に失敗しました');
        }
        if (!alive) return;
        setMatches((j.matches ?? []) as RecentMatch[]);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? '最近の試合の取得に失敗しました');
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [limit]);

  const viewRows = useMemo(() => {
    // 表示は「勝者が左」に寄せる（スクショの見た目に合わせる）
    return matches.map((m) => {
      const aId = m.player_a_id;
      const bId = m.player_b_id;

      const a = m.player_a;
      const b = m.player_b;

      // スコアが winner/loser で入っている前提で、左＝winner に寄せる
      const winnerId = m.winner_id;
      const isWinnerA = winnerId && aId ? winnerId === aId : false;
      const isWinnerB = winnerId && bId ? winnerId === bId : false;

      let left = { id: aId, p: a, score: null as number | null, win: false };
      let right = { id: bId, p: b, score: null as number | null, win: false };

      if (winnerId && (isWinnerA || isWinnerB)) {
        if (isWinnerA) {
          left = { id: aId, p: a, score: m.winner_score, win: true };
          right = { id: bId, p: b, score: m.loser_score, win: false };
        } else {
          left = { id: bId, p: b, score: m.winner_score, win: true };
          right = { id: aId, p: a, score: m.loser_score, win: false };
        }
      } else {
        // 勝者不明（途中など）
        left = { id: aId, p: a, score: null, win: false };
        right = { id: bId, p: b, score: null, win: false };
      }

      const badges: string[] = [];
      badges.push(m.is_team ? '団体戦' : '個人戦');

      const er = endReasonLabel(m.end_reason);
      // スクショに近い「快勝」っぽいバッジ（任意）
      const quickWin = (m.winner_score ?? 0) >= 15 && (m.loser_score ?? 0) === 0 ? '快勝' : null;

      if (quickWin) badges.push(quickWin);
      else if (er) badges.push(er);

      return { m, left, right, badges };
    });
  }, [matches]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <span className="text-blue-300">↩︎</span> 最近の試合
        </h2>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-200">読み込み中...</div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          {error}
        </div>
      ) : viewRows.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-200">
          まだ試合がありません。
        </div>
      ) : (
        <div className="space-y-4">
          {viewRows.map(({ m, left, right, badges }) => (
            <div
              key={m.id}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
            >
              <div className="flex items-center gap-3 text-xs text-gray-200 mb-3">
                <span className="opacity-80">🗓 {fmtJP(m.match_date)}</span>
                <div className="flex items-center gap-2">
                  {badges.map((b, i) => (
                    <span
                      key={`${m.id}-b-${i}`}
                      className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[11px]"
                    >
                      {b}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-4">
                {/* 左（勝者） */}
                <div
                  className={`flex-1 rounded-xl border px-4 py-3 ${
                    left.win
                      ? 'border-emerald-400/30 bg-emerald-500/10'
                      : 'border-white/10 bg-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative w-10 h-10 rounded-full overflow-hidden border border-purple-400/60 bg-white/10">
                        {left.p?.avatar_url && !imgError[`L:${m.id}`] ? (
                          <Image
                            loader={passthroughLoader}
                            unoptimized
                            src={left.p.avatar_url}
                            alt={left.p.handle_name ?? ''}
                            fill
                            sizes="40px"
                            className="object-cover"
                            onError={() => setImgError((prev) => ({ ...prev, [`L:${m.id}`]: true }))}
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {left.p?.handle_name ?? '—'}
                        </div>
                        <div className={`text-xs ${left.win ? 'text-emerald-300' : 'text-gray-300'}`}>
                          {left.win ? '勝利' : '—'}
                        </div>
                      </div>
                    </div>

                    <div className="text-2xl font-bold tabular-nums">
                      {left.score ?? '—'}
                    </div>
                  </div>
                </div>

                {/* VS */}
                <div className="w-14 h-14 rounded-full bg-rose-600/70 flex items-center justify-center text-white font-bold">
                  VS
                </div>

                {/* 右（敗者） */}
                <div
                  className={`flex-1 rounded-xl border px-4 py-3 ${
                    left.win
                      ? 'border-rose-400/30 bg-rose-500/10'
                      : 'border-white/10 bg-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative w-10 h-10 rounded-full overflow-hidden border border-purple-400/60 bg-white/10">
                        {right.p?.avatar_url && !imgError[`R:${m.id}`] ? (
                          <Image
                            loader={passthroughLoader}
                            unoptimized
                            src={right.p.avatar_url}
                            alt={right.p.handle_name ?? ''}
                            fill
                            sizes="40px"
                            className="object-cover"
                            onError={() => setImgError((prev) => ({ ...prev, [`R:${m.id}`]: true }))}
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {right.p?.handle_name ?? '—'}
                        </div>
                        <div className={`text-xs ${left.win ? 'text-rose-300' : 'text-gray-300'}`}>
                          {left.win ? '敗北' : '—'}
                        </div>
                      </div>
                    </div>

                    <div className="text-2xl font-bold tabular-nums">
                      {right.score ?? '—'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}

          <div className="text-center pt-2">
            <Link href="/matches" className="text-purple-300 hover:text-purple-200 underline text-sm">
              すべての試合を見る →
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
