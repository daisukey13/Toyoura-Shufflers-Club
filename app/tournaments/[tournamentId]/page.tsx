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

function isDefHandle(handle: string | null | undefined) {
  return String(handle ?? '').trim().toLowerCase() === 'def';
}

function uniqById<T extends { id: string }>(rows: T[]) {
  const map = new Map<string, T>();
  for (const r of rows) map.set(r.id, r);
  return Array.from(map.values());
}

/**
 * ✅ 参加者取得（最小修正）
 * 1) tournament_entries → players リレーションがあればそれを優先
 * 2) 0件 or 失敗なら match_details(winner_id/loser_id) から抽出して players を引く
 */
async function fetchParticipants(tournamentId: string): Promise<PlayerMini[]> {
  // 1) tournament_entries 優先
  const { data: entryRows, error: entryErr } = await supabase
    .from('tournament_entries')
    .select('player_id, players(id,handle_name,avatar_url)')
    .eq('tournament_id', tournamentId);

  if (!entryErr && entryRows && entryRows.length > 0) {
    const direct = entryRows
      .map((r: any) => r.players)
      .filter(Boolean)
      .map((p: any) => ({
        id: String(p.id),
        handle_name: (p.handle_name ?? null) as string | null,
        avatar_url: (p.avatar_url ?? null) as string | null,
      }))
      .filter((p) => !isDefHandle(p.handle_name));

    return uniqById(direct);
  }

  // 2) match_details フォールバック（winner/loser から抽出）
  const { data: mdRows, error: mdErr } = await supabase
    .from('match_details')
    .select('winner_id,loser_id')
    .eq('tournament_id', tournamentId)
    .limit(2000);

  if (mdErr || !mdRows || mdRows.length === 0) return [];

  const ids = Array.from(
    new Set(
      mdRows
        .flatMap((r: any) => [r?.winner_id, r?.loser_id])
        .filter((v: any) => typeof v === 'string' && v.length > 0)
    )
  );

  if (!ids.length) return [];

  const { data: pRows, error: pErr } = await supabase
    .from('players')
    .select('id,handle_name,avatar_url,is_active,is_deleted')
    .in('id', ids);

  if (pErr || !pRows) return [];

  return pRows
    .filter((p: any) => p?.is_deleted !== true)
    .filter((p: any) => p?.is_active !== false) // null は OK
    .map((p: any) => ({
      id: String(p.id),
      handle_name: (p.handle_name ?? null) as string | null,
      avatar_url: (p.avatar_url ?? null) as string | null,
    }))
    .filter((p) => !isDefHandle(p.handle_name));
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

  // ✅ 参加者帯
  const [participants, setParticipants] = useState<PlayerMini[]>([]);
  const [participantImgErrorIds, setParticipantImgErrorIds] = useState<Record<string, true>>({});

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

      setParticipants([]);
      setParticipantImgErrorIds({});

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

        // ✅ 参加者取得（失敗しても落とさない）
        try {
          const rows = await fetchParticipants(tournamentId);
          if (!cancelled) setParticipants(rows);
        } catch {
          // noop
        }

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

          <div className="relative">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs text-gray-300">TOURNAMENT</div>
                <h1 className="text-2xl md:text-3xl font-bold break-words leading-tight">{title}</h1>

                {tournament?.description && (
                  <p className="text-sm text-gray-300 mt-2 break-words leading-relaxed">
                    {tournament.description}
                  </p>
                )}

                <div className="mt-3 flex items-center gap-2 text-sm text-gray-200">
                  <FaCalendarAlt className="opacity-80" />
                  <span className="opacity-80">開催日</span>
                  <span className="font-semibold">{date}</span>
                </div>
              </div>

              <div className="flex items-center md:justify-end gap-3 text-xs flex-wrap">
                <Link href="/tournaments" className="text-blue-300 hover:text-blue-200 underline">
                  大会一覧へ
                </Link>
                <Link href={`/tournaments/${tournamentId}/finals`} className="text-blue-300 hover:text-blue-200 underline">
                  決勝へ
                </Link>
                <Link href={`/tournaments/${tournamentId}/league`} className="text-blue-300 hover:text-blue-200 underline">
                  予選（リーグ）へ
                </Link>
              </div>
            </div>

            <div className="mt-4 flex md:justify-end">
              <div className="w-full md:w-[420px] rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-base md:text-lg font-bold flex items-center gap-2">
                      <FaTrophy className="text-yellow-300" />
                      <span className="break-words leading-snug">{winnerLabel}</span>
                    </div>
                  </div>

                  {championAvatar && !championImgError ? (
                    <div className="relative w-16 h-16 md:w-24 md:h-24 rounded-full overflow-hidden border border-white/20 shrink-0">
                      <Image
                        loader={passthroughLoader}
                        unoptimized
                        src={championAvatar}
                        alt={championName ?? 'champion'}
                        fill
                        sizes="(min-width: 768px) 96px, 64px"
                        className="object-cover"
                        onError={() => setChampionImgError(true)}
                      />
                    </div>
                  ) : (
                    <div className="w-16 h-16 md:w-24 md:h-24 rounded-full bg-white/10 border border-white/20 shrink-0" />
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

            {/* ✅ INDEX の直前に「参加者帯」 */}
            {participants.length > 0 && (
              <div className="mt-6 bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-gray-300">PLAYERS</div>
                  <div className="text-[11px] text-gray-400">{participants.length} 人</div>
                </div>

                {/* ✅ ここだけ最小修正：優勝者を先頭＆👑表示 */}
                <div className="mt-3 -mx-1 overflow-x-auto">
                  <div className="px-1 flex items-center gap-3 min-w-max">
                    {(() => {
                      const championId = champion?.id ?? null;

                      const ordered = (() => {
                        if (!championId) return participants;
                        const idx = participants.findIndex((p) => p.id === championId);
                        if (idx < 0) return participants;
                        const copy = participants.slice();
                        const [ch] = copy.splice(idx, 1);
                        return [ch, ...copy];
                      })();

                      return ordered.map((p) => {
                        const name = p.handle_name ?? 'NoName';
                        const avatar = p.avatar_url ?? null;
                        const imgErr = !!participantImgErrorIds[p.id];
                        const isChampion = championId === p.id;

                        return (
                          <div
                            key={p.id}
                            className="shrink-0 flex flex-col items-center gap-2 w-[86px]"
                            title={isChampion ? `👑 ${name}` : name}
                          >
                            {avatar && !imgErr ? (
                              <div className="relative w-14 h-14 rounded-full overflow-hidden border border-white/15 bg-black/20">
                                {isChampion && (
                                  <div className="absolute -top-2 -right-2 text-[14px] leading-none select-none">
                                    👑
                                  </div>
                                )}

                                <Image
                                  loader={passthroughLoader}
                                  unoptimized
                                  src={avatar}
                                  alt={name}
                                  fill
                                  sizes="56px"
                                  className="object-cover"
                                  onError={() =>
                                    setParticipantImgErrorIds((prev) => ({ ...prev, [p.id]: true }))
                                  }
                                />
                              </div>
                            ) : (
                              <div className="relative w-14 h-14 rounded-full border border-white/15 bg-white/10">
                                {isChampion && (
                                  <div className="absolute -top-2 -right-2 text-[14px] leading-none select-none">
                                    👑
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="text-[11px] text-gray-200 text-center break-words leading-snug line-clamp-2">
                              {name}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>

                <div className="mt-2 text-[11px] text-gray-400">
                  ※ 参加者が明示登録されていない大会は、試合結果（winner/loser）から自動抽出して表示します
                </div>
              </div>
            )}

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
