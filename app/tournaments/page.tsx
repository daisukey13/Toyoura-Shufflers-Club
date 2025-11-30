// app/tournaments/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { FaUsers, FaCalendarAlt, FaFlagCheckered, FaTrophy } from 'react-icons/fa';

const supabase = createClient();

type TournamentRow = {
  id: string;
  name?: string | null;
  title?: string | null;
  start_date?: string | null;
  date?: string | null;
  tournament_date?: string | null;
  mode?: string | null;
  format?: string | null;
  created_at?: string | null;

  // 予定参加人数（あなたの方針：これを参加人数として扱う）
  size?: number | string | null;

  // 旧/別UIで入っている可能性があるので念のため
  bracket_size?: number | string | null;
};

type PlayerMini = {
  id: string;
  handle_name: string | null;
  avatar_url: string | null;
};

type TournamentSummary = {
  tournamentId: string;
  participantCount: number;
  championId: string | null;
  champion: PlayerMini | null;
  finalsStatus: 'none' | 'in_progress' | 'done';
};

function pickTournamentName(t: TournamentRow) {
  return (t.name ?? t.title ?? '（大会名未設定）') as string;
}

function pickTournamentDate(t: TournamentRow) {
  return (t.start_date ?? t.tournament_date ?? t.date ?? null) as string | null;
}

function pickTournamentMode(t: TournamentRow) {
  return (t.mode ?? t.format ?? null) as string | null;
}

function safeDateLabel(iso: string | null) {
  if (!iso) return '—';
  return String(iso).slice(0, 10);
}

function toInt(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function pickPlannedParticipants(t: TournamentRow): number {
  // 最優先：tournaments.size
  const s = toInt(t.size);
  if (s > 0) return s;

  // 念のため別カラムも fallback
  const b = toInt((t as any).bracket_size);
  if (b > 0) return b;

  return 0;
}

/**
 * 一覧ページは anon で動くので final_matches を読みに行かない。
 * 優勝者は final_brackets.champion_player_id を正とする。
 */
async function calcSummaryFromBracket(t: TournamentRow): Promise<{
  participantCount: number;
  championId: string | null;
  finalsStatus: 'none' | 'in_progress' | 'done';
}> {
  const planned = pickPlannedParticipants(t);

  // 決勝 bracket（最新）
  const { data: bRows, error: bErr } = await supabase
    .from('final_brackets')
    .select('id,created_at,champion_player_id')
    .eq('tournament_id', t.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (bErr || !bRows?.length) {
    // 決勝自体が無い
    return {
      participantCount: planned,
      championId: null,
      finalsStatus: 'none',
    };
  }

  const bracket = bRows[0] as any;
  const championId = bracket?.champion_player_id ? String(bracket.champion_player_id) : null;

  // planned があればそれを優先。無ければ決勝枠から数える（読める環境のみ）
  let participantCount = planned;

  if (participantCount <= 0) {
    const bracketId = String(bracket.id);
    const { data: eRows, error: eErr } = await supabase
      .from('final_round_entries')
      .select('player_id')
      .eq('bracket_id', bracketId);

    if (!eErr) {
      participantCount = new Set((eRows ?? []).map((r: any) => r.player_id).filter(Boolean)).size;
    }
  }

  return {
    participantCount,
    championId,
    finalsStatus: championId ? 'done' : 'in_progress',
  };
}

export default function TournamentsIndexPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [tournaments, setTournaments] = useState<TournamentRow[]>([]);
  const [summaries, setSummaries] = useState<Record<string, TournamentSummary>>({});

  const championIds = useMemo(() => {
    return Array.from(new Set(Object.values(summaries).map((s) => s.championId).filter(Boolean))) as string[];
  }, [summaries]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');

      try {
        const { data, error: tErr } = await supabase
          .from('tournaments')
          .select('*')
          .order('start_date', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false, nullsFirst: false });

        if (tErr) throw new Error(tErr.message);

        const list = (data ?? []) as TournamentRow[];
        if (cancelled) return;

        setTournaments(list);

        const next: Record<string, TournamentSummary> = {};
        await Promise.all(
          list.map(async (t) => {
            const tid = String(t.id);
            try {
              const r = await calcSummaryFromBracket(t);
              next[tid] = {
                tournamentId: tid,
                participantCount: r.participantCount,
                championId: r.championId,
                champion: null,
                finalsStatus: r.finalsStatus,
              };
            } catch (e) {
              // 失敗しても予定人数だけは出す
              next[tid] = {
                tournamentId: tid,
                participantCount: pickPlannedParticipants(t),
                championId: null,
                champion: null,
                finalsStatus: 'none',
              };
            }
          })
        );

        if (cancelled) return;
        setSummaries(next);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || '大会一覧の取得に失敗しました');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // champion players をまとめて取得して埋める
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!championIds.length) return;

      const { data, error } = await supabase
        .from('players')
        .select('id,handle_name,avatar_url')
        .in('id', championIds);

      if (cancelled) return;
      if (error) return;

      const dict: Record<string, PlayerMini> = {};
      (data ?? []).forEach((p: any) => {
        dict[String(p.id)] = {
          id: String(p.id),
          handle_name: p.handle_name ?? null,
          avatar_url: p.avatar_url ?? null,
        };
      });

      setSummaries((prev) => {
        const next = { ...prev };
        Object.values(next).forEach((s) => {
          if (s.championId && dict[s.championId]) s.champion = dict[s.championId];
        });
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [championIds]);

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full">
              <FaFlagCheckered className="text-2xl" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">大会一覧</h1>
              <div className="text-sm text-gray-300 mt-1">大会名 / 開催日 / 形式 / 参加人数 / 結果 / 優勝者</div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-gray-300">読み込み中...</div>
        ) : tournaments.length === 0 ? (
          <div className="text-gray-300">大会がありません。</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {tournaments.map((t) => {
              const tid = String(t.id);
              const s = summaries[tid];

              const name = pickTournamentName(t);
              const date = safeDateLabel(pickTournamentDate(t));
              const mode = pickTournamentMode(t) ?? '—';

              const participant = s?.participantCount ?? pickPlannedParticipants(t) ?? 0;

              const champName = s?.champion?.handle_name ?? null;
              const champAvatar = s?.champion?.avatar_url ?? null;

              const resultLabel =
                s?.finalsStatus === 'done' ? '決勝確定' : s?.finalsStatus === 'in_progress' ? '決勝進行中' : '未開始';

              return (
                <Link
                  key={tid}
                  href={`/tournaments/${tid}`}
                  className="block bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-5 hover:border-purple-400/60 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-xs text-gray-300">TOURNAMENT</div>
                      <div className="text-lg font-bold truncate">{name}</div>

                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                        <div className="flex items-center gap-2 text-gray-200">
                          <FaCalendarAlt className="opacity-80" />
                          <span className="text-gray-300">開催日</span>
                          <span className="font-semibold">{date}</span>
                        </div>

                        <div className="flex items-center gap-2 text-gray-200">
                          <span className="text-gray-300">形式</span>
                          <span className="font-semibold">{mode}</span>
                        </div>

                        <div className="flex items-center gap-2 text-gray-200">
                          <FaUsers className="opacity-80" />
                          <span className="text-gray-300">参加</span>
                          <span className="font-semibold">{participant}</span>
                        </div>

                        <div className="flex items-center gap-2 text-gray-200">
                          <span className="text-gray-300">結果</span>
                          <span className="font-semibold">{resultLabel}</span>
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-gray-200">
                        <FaTrophy className="text-yellow-300" />
                        {champName ? '優勝確定' : '優勝未確定'}
                      </div>

                      <div className="mt-3 flex items-center justify-end gap-2">
                        {champAvatar ? (
                          <div className="relative w-10 h-10 rounded-full overflow-hidden border border-white/20">
                            <Image
                              src={champAvatar}
                              alt={champName ?? ''}
                              fill
                              sizes="40px"
                              className="object-cover"
                            />
                          </div>
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-white/10 border border-white/20" />
                        )}
                        <div className="text-sm font-semibold">{champName ?? '—'}</div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
