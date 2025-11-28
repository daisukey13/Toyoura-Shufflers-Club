'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { FaTrophy } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

type TournamentRow = { id: string; name: string | null; start_date: string | null; notes: string | null; description?: string | null };

type FinalBracketRow = { id: string; tournament_id: string; title: string | null; created_at: string | null };

type RoundEntryRow = {
  bracket_id: string;
  round_no: number;
  slot_no: number;
  player_id: string | null;
};

type PlayerRow = {
  id: string;
  handle_name: string | null;
  avatar_url: string | null;
  ranking_points: number | null;
  handicap: number | null;
};

export default function TournamentFinalsPage() {
  const params = useParams();
  const tournamentId = typeof (params as any)?.tournamentId === 'string' ? ((params as any).tournamentId as string) : '';

  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [bracket, setBracket] = useState<FinalBracketRow | null>(null);
  const [entries, setEntries] = useState<RoundEntryRow[]>([]);
  const [players, setPlayers] = useState<Record<string, PlayerRow>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tournamentId) return;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  const loadAll = async () => {
    setLoading(true);
    setError(null);

    try {
      // 1) tournament
      const { data: tRow, error: tErr } = await supabase
        .from('tournaments')
        .select('id,name,start_date,notes,description')
        .eq('id', tournamentId)
        .maybeSingle();

      if (tErr || !tRow) {
        console.error('[tournaments/finals] tournament fetch error:', tErr);
        setError('大会情報の取得に失敗しました');
        setLoading(false);
        return;
      }
      setTournament(tRow as TournamentRow);

      // 2) final bracket（最新1件）
      const { data: bRows, error: bErr } = await supabase
        .from('final_brackets')
        .select('id,tournament_id,title,created_at')
        .eq('tournament_id', tournamentId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (bErr) {
        console.error('[tournaments/finals] final_brackets fetch error:', bErr);
        setError('決勝トーナメント情報の取得に失敗しました');
        setLoading(false);
        return;
      }

      const b = (bRows?.[0] ?? null) as FinalBracketRow | null;
      if (!b?.id) {
        setError('決勝トーナメントが作成されていません');
        setLoading(false);
        return;
      }
      setBracket(b);

      // 3) ✅ final_round_entries を読む（ここが重要）
      const { data: eRows, error: eErr } = await supabase
        .from('final_round_entries')
        .select('bracket_id,round_no,slot_no,player_id')
        .eq('bracket_id', b.id);

      if (eErr) {
        console.error('[tournaments/finals] final_round_entries fetch error:', eErr);
        setError('決勝トーナメント枠の取得に失敗しました');
        setLoading(false);
        return;
      }

      const es = (eRows ?? []) as RoundEntryRow[];
      setEntries(es);

      // 4) プレーヤー情報を一括取得
      const ids = Array.from(new Set(es.map((r) => r.player_id).filter((x): x is string => !!x)));
      if (ids.length > 0) {
        const { data: pRows, error: pErr } = await supabase
          .from('players')
          .select('id,handle_name,avatar_url,ranking_points,handicap')
          .in('id', ids);

        if (pErr) {
          console.warn('[tournaments/finals] players fetch error:', pErr);
          setPlayers({});
        } else {
          const dict: Record<string, PlayerRow> = {};
          (pRows ?? []).forEach((p: any) => {
            dict[p.id] = {
              id: p.id,
              handle_name: p.handle_name,
              avatar_url: p.avatar_url,
              ranking_points: p.ranking_points,
              handicap: p.handicap,
            };
          });
          setPlayers(dict);
        }
      } else {
        setPlayers({});
      }

      setLoading(false);
    } catch (e) {
      console.error('[tournaments/finals] fatal:', e);
      setError('データの取得中にエラーが発生しました');
      setLoading(false);
    }
  };

  const entryMap = useMemo(() => {
    const m = new Map<string, RoundEntryRow>();
    for (const r of entries) m.set(`${r.round_no}:${r.slot_no}`, r);
    return m;
  }, [entries]);

  const r1Slots = useMemo(() => {
    // 「R1枠1〜4」に入れてるなら、まずそこだけ確実に表示
    return [1, 2, 3, 4].map((slotNo) => {
      const e = entryMap.get(`1:${slotNo}`);
      const pid = e?.player_id ?? null;
      const p = pid ? players[pid] : null;
      return { slotNo, player: p };
    });
  }, [entryMap, players]);

  if (!tournamentId) return <div className="p-4">大会IDが指定されていません。</div>;
  if (loading) return <div className="p-4">読み込み中...</div>;
  if (error) return <div className="p-4 text-red-400">{error}</div>;

  return (
    <div className="min-h-screen px-4 py-6 text-white">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="rounded-2xl border border-purple-500/40 bg-purple-900/30 p-5">
          <div className="text-xs text-purple-200 mb-1">TOURNAMENT</div>
          <h1 className="text-2xl font-bold">{tournament?.name ?? '大会名未設定'}</h1>

          <div className="mt-1 text-sm text-purple-100 space-y-1">
            {tournament?.start_date && <div>開催日: {new Date(tournament.start_date).toLocaleDateString('ja-JP')}</div>}
            {(tournament?.notes || (tournament as any)?.description) && (
              <div className="text-sm text-purple-50 whitespace-pre-wrap">
                {tournament?.notes ?? (tournament as any)?.description}
              </div>
            )}
          </div>
        </div>

        {/* Finals */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <FaTrophy className="text-yellow-300" />
            {bracket?.title ?? '決勝トーナメント'}
          </h2>

          {/* まずR1枠1〜4を確実に見せる */}
          <div className="rounded-2xl border border-white/15 bg-black/30 p-4">
            <div className="text-sm text-gray-200 mb-3">R1 参加者（枠1〜4）</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {r1Slots.map(({ slotNo, player }) => (
                <div key={slotNo} className="rounded-xl border border-white/10 bg-black/40 p-3 flex items-center gap-3">
                  <div className="text-xs text-gray-300 w-14">枠 {slotNo}</div>
                  <div className="h-12 w-12 rounded-full overflow-hidden border border-white/10 bg-black/30 flex items-center justify-center">
                    {player?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={player.avatar_url} alt={player.handle_name ?? ''} className="h-full w-full object-cover" />
                    ) : (
                      <div className="text-[10px] text-gray-400">no</div>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="text-base font-semibold">{player?.handle_name ?? '未設定'}</div>
                    <div className="text-xs text-gray-300">
                      RP: {player?.ranking_points ?? 0} / HC: {player?.handicap ?? 0}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 text-[11px] text-gray-400">
              ※ 管理画面で設定した player_id が final_round_entries に入っていればここに出ます。
            </div>
          </div>

          {/* ナビ */}
          <div className="text-right text-xs">
            <Link href={`/tournaments/${tournamentId}/league/results`} className="text-blue-300 underline">
              予選（リーグ結果）へ戻る
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
