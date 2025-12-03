// app/tournaments/[tournamentId]/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image, { type ImageLoaderProps } from 'next/image';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { FaCalendarAlt, FaUsers, FaTrophy } from 'react-icons/fa';

const supabase = createClient();

// ✅ remotePatterns 不要にする（Supabase Storage 等でも落ちない）
const passthroughLoader = ({ src }: ImageLoaderProps) => src;

type TournamentRow = {
  id: string;
  name: string | null;
  description: string | null;
  tournament_date: string | null;
  start_date: string | null;
  end_date: string | null;
  mode: string | null;
  size: number | string | null;
  bracket_size: number | string | null;
  best_of: number | string | null;
  point_cap: number | string | null;
};

type FinalBracket = {
  id: string;
  tournament_id: string;
  title: string | null;
  max_round: number | null;
  champion_player_id: string | null;
  created_at: string | null;
};

type FinalMatchMini = {
  id: string;
  bracket_id: string;
  round_no: number | null;
  match_no: number | null;
  winner_id: string | null;
  loser_id: string | null;
  winner_score: number | null;
  loser_score: number | null;
  created_at: string | null;
};

type PlayerMini = {
  id: string;
  handle_name: string | null;
  avatar_url: string | null;
};

function safeDay(v: string | null) {
  if (!v) return '—';
  return String(v).slice(0, 10);
}

function toInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : null;
}

function inferChampionFromMatches(ms: FinalMatchMini[]): string | null {
  const winners = ms.filter((m) => !!m.winner_id && Number(m.round_no ?? 0) > 0);
  if (!winners.length) return null;

  const maxRound = winners.reduce((mx, m) => Math.max(mx, Number(m.round_no ?? 0)), 0);
  const lastRound = winners.filter((m) => Number(m.round_no ?? 0) === maxRound);

  lastRound.sort((a, b) => {
    const an = Number(a.match_no ?? 9999);
    const bn = Number(b.match_no ?? 9999);
    if (an !== bn) return an - bn;
    const ac = String(a.created_at ?? '');
    const bc = String(b.created_at ?? '');
    if (ac && bc && ac !== bc) return ac < bc ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });

  return lastRound[0]?.winner_id ?? null;
}

export default function TournamentTopPage() {
  const params = useParams();
  const tournamentId = typeof params?.tournamentId === 'string' ? params.tournamentId : '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [bracket, setBracket] = useState<FinalBracket | null>(null);

  const [champion, setChampion] = useState<PlayerMini | null>(null);
  const [finalsStatus, setFinalsStatus] = useState<'none' | 'in_progress' | 'done'>('none');

  const [championImgError, setChampionImgError] = useState(false);

  const participantPlanned = useMemo(() => {
    if (!tournament) return 0;
    return toInt(tournament.size) ?? toInt(tournament.bracket_size) ?? 0;
  }, [tournament]);

  useEffect(() => {
    if (!tournamentId) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      setTournament(null);
      setBracket(null);
      setChampion(null);
      setFinalsStatus('none');
      setChampionImgError(false);

      try {
        const { data: tRow, error: tErr } = await supabase
          .from('tournaments')
          .select('id,name,description,tournament_date,start_date,end_date,mode,size,bracket_size,best_of,point_cap')
          .eq('id', tournamentId)
          .maybeSingle();

        if (tErr) throw new Error(tErr.message);
        if (!tRow) throw new Error('大会が見つかりませんでした');

        if (cancelled) return;
        setTournament(tRow as TournamentRow);

        const { data: bRows, error: bErr } = await supabase
          .from('final_brackets')
          .select('id,tournament_id,title,max_round,champion_player_id,created_at')
          .eq('tournament_id', tournamentId)
          .order('created_at', { ascending: false })
          .limit(1);

        if (!bErr && bRows && bRows.length) {
          const b = bRows[0] as FinalBracket;
          if (cancelled) return;
          setBracket(b);

          let championId: string | null = b.champion_player_id ?? null;

          if (!championId) {
            setFinalsStatus('in_progress');
            const { data: mRows, error: mErr } = await supabase
              .from('final_matches')
              .select('id,bracket_id,round_no,match_no,winner_id,loser_id,winner_score,loser_score,created_at')
              .eq('bracket_id', b.id)
              .limit(2000);

            if (!mErr && mRows && mRows.length) {
              championId = inferChampionFromMatches(mRows as FinalMatchMini[]);
            }
          }

          if (championId) {
            setFinalsStatus('done');
            const { data: pRow, error: pErr } = await supabase
              .from('players')
              .select('id,handle_name,avatar_url')
              .eq('id', championId)
              .maybeSingle();

            if (!cancelled && !pErr && pRow) setChampion(pRow as PlayerMini);
          } else {
            setFinalsStatus((prev) => (prev === 'none' ? 'in_progress' : prev));
          }
        } else {
          setFinalsStatus('none');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || '読み込みに失敗しました');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  if (!tournamentId) {
    return (
      <div className="min-h-screen bg-[#2a2a3e] text-white flex items-center justify-center">
        大会IDが指定されていません
      </div>
    );
  }

  const title = tournament?.name ?? '（大会名未設定）';
  const date = safeDay(tournament?.tournament_date ?? tournament?.start_date ?? null);

  const championName = champion?.handle_name ?? null;
  const championAvatar = champion?.avatar_url ?? null;

  const winnerLabel = championName ? `優勝者：${championName}` : '優勝者：未確定（決勝結果の入力待ち）';

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8">
        <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-6 md:p-8 relative overflow-hidden">
          <div className="absolute inset-0 opacity-20 pointer-events-none">
            <div className="absolute -right-24 -top-24 w-72 h-72 rounded-full bg-purple-600 blur-3xl" />
            <div className="absolute -left-24 -bottom-24 w-72 h-72 rounded-full bg-pink-600 blur-3xl" />
          </div>

          <div className="relative flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs text-gray-300">TOURNAMENT</div>
              <h1 className="text-2xl md:text-3xl font-bold truncate">{title}</h1>
              {tournament?.description && <p className="text-sm text-gray-300 mt-2">{tournament.description}</p>}

              <div className="mt-3 flex items-center gap-2 text-sm text-gray-200">
                <FaCalendarAlt className="opacity-80" />
                <span className="opacity-80">開催日</span>
                <span className="font-semibold">{date}</span>
              </div>
            </div>

            <div className="shrink-0 text-right flex flex-col items-end gap-2">
              <div className="flex items-center gap-3 text-xs">
                <Link href="/matches" className="text-blue-300 hover:text-blue-200 underline">
                  試合結果へ
                </Link>
                <Link href={`/tournaments/${tournamentId}/finals`} className="text-blue-300 hover:text-blue-200 underline">
                  決勝へ
                </Link>
                <Link href={`/tournaments/${tournamentId}/league`} className="text-blue-300 hover:text-blue-200 underline">
                  予選（リーグ）へ
                </Link>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 min-w-[260px]">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-base md:text-lg font-bold flex items-center gap-2">
                      <FaTrophy className="text-yellow-300" />
                      <span className="truncate">{winnerLabel}</span>
                    </div>
                  </div>

                  {championAvatar && !championImgError ? (
                    <div className="relative w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden border border-white/20">
                      <Image
                        loader={passthroughLoader}
                        unoptimized
                        src={championAvatar}
                        alt={championName ?? 'champion'}
                        fill
                        sizes="(min-width: 768px) 96px, 80px"
                        className="object-cover"
                        onError={() => setChampionImgError(true)}
                      />
                    </div>
                  ) : (
                    <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-white/10 border border-white/20" />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="mt-6 text-gray-300">読み込み中...</div>
        ) : !tournament ? (
          <div className="mt-6 text-gray-300">大会が見つかりません。</div>
        ) : (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-5">
                <div className="text-xs text-gray-300 flex items-center gap-2">
                  <FaCalendarAlt className="opacity-80" /> 開催日
                </div>
                <div className="mt-2 text-xl font-bold">{date}</div>
              </div>

              <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-5">
                <div className="text-xs text-gray-300 flex items-center gap-2">
                  <FaUsers className="opacity-80" /> 参加者人数
                </div>
                <div className="mt-2 text-xl font-bold">{participantPlanned}</div>
                <div className="mt-1 text-[11px] text-gray-400">※ 大会作成時の予定人数（tournaments.size）を表示</div>
              </div>

              <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-5">
                <div className="text-xs text-gray-300">決勝トーナメント</div>
                <div className="mt-2 text-xl font-bold">{bracket?.title ?? '決勝トーナメント'}</div>
                <div className="mt-2 text-sm text-gray-300">
                  結果：
                  <span className="ml-2 font-semibold">
                    {finalsStatus === 'done' ? '確定' : finalsStatus === 'in_progress' ? '進行中' : '未開始'}
                  </span>
                </div>
                <div className="mt-2">
                  <Link
                    href={`/tournaments/${tournamentId}/finals`}
                    className="text-blue-300 hover:text-blue-200 underline text-sm"
                  >
                    決勝トーナメント結果を見る →
                  </Link>
                </div>
              </div>
            </div>

            <div className="mt-6 bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-5">
              <div className="text-xs text-gray-300">INDEX</div>

              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <Link
                  href={`/tournaments/${tournamentId}/league`}
                  className="rounded-2xl border border-white/10 bg-black/20 p-5 hover:border-purple-400/60 transition-colors"
                >
                  <div className="text-lg font-bold">予選（リーグ）結果</div>
                  <div className="mt-1 text-sm text-gray-300">順位表・得失点差・各試合の結果を確認</div>
                </Link>

                <Link
                  href={`/tournaments/${tournamentId}/finals`}
                  className="rounded-2xl border border-white/10 bg-black/20 p-5 hover:border-purple-400/60 transition-colors"
                >
                  <div className="text-lg font-bold">決勝トーナメント結果</div>
                  <div className="mt-1 text-sm text-gray-300">ラウンド別結果と優勝者</div>
                </Link>
              </div>

              <div className="mt-4 text-right text-xs">
                <Link href="/tournaments" className="text-blue-300 hover:text-blue-200 underline">
                  ← 大会一覧へ戻る
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
