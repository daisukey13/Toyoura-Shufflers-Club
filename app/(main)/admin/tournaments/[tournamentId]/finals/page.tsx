'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FaShieldAlt, FaTrophy } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

type TournamentRow = { id: string; name: string | null };
type FinalBracketRow = { id: string; tournament_id: string; title: string | null; created_at: string | null };

type LeagueBlockRow = { id: string; label: string | null; winner_player_id: string | null };

type PlayerRow = {
  id: string;
  handle_name: string | null;
  avatar_url: string | null;
  ranking_points: number | null;
  handicap: number | null;
};

type RoundEntryRow = {
  bracket_id: string;
  round_no: number;
  slot_no: number;
  player_id: string | null;
};

type AdminRow = { user_id: string };
type PlayerFlagRow = { is_admin: boolean | null };

const MAX_ROUND = 5;
const MAX_R1 = 32; // 最大32名
const slotCountForRound = (roundNo: number) => Math.max(1, Math.floor(MAX_R1 / Math.pow(2, roundNo - 1)));
const roundLabel = (r: number) => `R${r}`;

export default function AdminTournamentFinalsPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = typeof (params as any)?.tournamentId === 'string' ? ((params as any).tournamentId as string) : '';

  const [authz, setAuthz] = useState<'checking' | 'ok' | 'no'>('checking');

  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [bracket, setBracket] = useState<FinalBracketRow | null>(null);

  const [eligiblePlayers, setEligiblePlayers] = useState<PlayerRow[]>([]);
  const [blockLabelByWinnerId, setBlockLabelByWinnerId] = useState<Record<string, string>>({});

  const [entries, setEntries] = useState<RoundEntryRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // ===== 認証 + 管理者チェック =====
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/auth/whoami', { cache: 'no-store' });
        const j = r.ok ? await r.json() : { authenticated: false };
        if (!j?.authenticated) {
          router.replace('/login?redirect=/admin/dashboard');
          return;
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace('/login?redirect=/admin/dashboard');
          return;
        }

        const [adminResp, playerResp] = await Promise.all([
          (supabase.from('app_admins') as any).select('user_id').eq('user_id', user.id).maybeSingle(),
          (supabase.from('players') as any).select('is_admin').eq('id', user.id).maybeSingle(),
        ]);

        const adminRow = (adminResp?.data ?? null) as AdminRow | null;
        const playerRow = (playerResp?.data ?? null) as PlayerFlagRow | null;

        let isAdmin = false;
        if (adminRow?.user_id) isAdmin = true;
        if (playerRow?.is_admin === true) isAdmin = true;

        if (!isAdmin) {
          if (!cancelled) setAuthz('no');
          return;
        }

        if (!cancelled) {
          setAuthz('ok');
          if (tournamentId) void loadAll(tournamentId);
        }
      } catch (e) {
        console.error('[admin/finals] auth error:', e);
        if (!cancelled) setAuthz('no');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, tournamentId]);

  const loadAll = async (tid: string) => {
    if (!tid) return;
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      // tournament
      const { data: tData, error: tErr } = await supabase.from('tournaments').select('id,name').eq('id', tid).maybeSingle();
      if (tErr || !tData) throw new Error('大会情報の取得に失敗しました');
      setTournament(tData as TournamentRow);

      // final bracket (latest)
      const { data: bData, error: bErr } = await supabase
        .from('final_brackets')
        .select('id,tournament_id,title,created_at')
        .eq('tournament_id', tid)
        .order('created_at', { ascending: false })
        .limit(1);

      if (bErr) throw new Error('決勝トーナメント情報の取得に失敗しました');
      const b = (bData?.[0] ?? null) as FinalBracketRow | null;
      if (!b?.id) throw new Error('決勝トーナメントが作成されていません（seed が必要です）');
      setBracket(b);

      // eligible players (league block winners)
      const { data: lbData, error: lbErr } = await supabase
        .from('league_blocks')
        .select('id,label,winner_player_id')
        .eq('tournament_id', tid)
        .order('label', { ascending: true });

      if (lbErr) throw new Error('リーグブロックの取得に失敗しました');
      const blocks = (lbData ?? []) as LeagueBlockRow[];

      const labelMap: Record<string, string> = {};
      const winnerIds = Array.from(
        new Set(
          blocks
            .map((b2) => {
              if (b2.winner_player_id) labelMap[b2.winner_player_id] = b2.label ?? '';
              return b2.winner_player_id;
            })
            .filter((x): x is string => !!x)
        )
      );
      setBlockLabelByWinnerId(labelMap);

      if (winnerIds.length > 0) {
        const { data: pData, error: pErr } = await supabase
          .from('players')
          .select('id,handle_name,avatar_url,ranking_points,handicap')
          .in('id', winnerIds);

        if (pErr) throw new Error('プレーヤー情報の取得に失敗しました');

        const ps = (pData ?? []) as PlayerRow[];
        ps.sort((a, b3) => String(a.handle_name ?? '').localeCompare(String(b3.handle_name ?? ''), 'ja-JP'));
        setEligiblePlayers(ps);
      } else {
        setEligiblePlayers([]);
      }

      // entries
      const { data: eData, error: eErr } = await supabase
        .from('final_round_entries')
        .select('bracket_id,round_no,slot_no,player_id')
        .eq('bracket_id', b.id);

      if (eErr) throw new Error('決勝トーナメント枠の取得に失敗しました');
      setEntries((eData ?? []) as RoundEntryRow[]);

      setLoading(false);
    } catch (e: any) {
      console.error('[admin/finals] load error:', e);
      setError(e?.message || '読み込みに失敗しました');
      setLoading(false);
    }
  };

  const entryMap = useMemo(() => {
    const m = new Map<string, RoundEntryRow>();
    for (const r of entries) m.set(`${r.round_no}:${r.slot_no}`, r);
    return m;
  }, [entries]);

  const eligibleById = useMemo(() => {
    const m = new Map<string, PlayerRow>();
    for (const p of eligiblePlayers) m.set(p.id, p);
    return m;
  }, [eligiblePlayers]);

  const handleSetSlot = async (roundNo: number, slotNo: number, playerId: string | null) => {
    if (!bracket?.id) return;
    setError(null);
    setMessage(null);

    const key = `${roundNo}:${slotNo}`;
    try {
      setSavingKey(key);

      const res = await fetch('/api/finals/slot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournament_id: tournamentId,
          bracket_id: bracket.id,
          round_no: roundNo,
          slot_no: slotNo,
          player_id: playerId,
        }),
      });

      const text = await res.text();
      let j: any = null;
      try {
        j = JSON.parse(text);
      } catch {
        // ignore
      }
      if (!res.ok || (j && j.ok === false)) throw new Error(j?.message || text || `HTTP ${res.status}`);

      setEntries((prev) => {
        const next = [...prev];
        const idx = next.findIndex((s) => s.round_no === roundNo && s.slot_no === slotNo);
        if (idx >= 0) next[idx] = { ...next[idx], player_id: playerId };
        else next.push({ bracket_id: bracket.id, round_no: roundNo, slot_no: slotNo, player_id: playerId });
        return next;
      });

      setMessage(`枠を更新しました（${roundLabel(roundNo)}-${slotNo}）`);
    } catch (e: any) {
      console.error('[admin/finals] save error:', e);
      setError(`保存に失敗しました: ${e?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
    }
  };

  const PlayerChip = ({ playerId }: { playerId: string | null }) => {
    if (!playerId) {
      return (
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-full overflow-hidden border border-white/10 bg-black/30 flex items-center justify-center">
            <div className="text-[10px] text-gray-400">no</div>
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-gray-200">未設定</div>
            <div className="text-[11px] text-gray-400">RP: 0 / HC: 0</div>
          </div>
        </div>
      );
    }

    const p = eligibleById.get(playerId);
    return (
      <div className="flex items-center gap-2">
        <div className="h-9 w-9 rounded-full overflow-hidden border border-white/10 bg-black/30 flex items-center justify-center">
          {p?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.avatar_url} alt={p.handle_name ?? ''} className="h-full w-full object-cover" />
          ) : (
            <div className="text-[10px] text-gray-400">no</div>
          )}
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">{p?.handle_name ?? '(名前未設定)'}</div>
          <div className="text-[11px] text-gray-300">
            RP: {p?.ranking_points ?? 0} / HC: {p?.handicap ?? 0}
            {p?.id && blockLabelByWinnerId[p.id] ? (
              <span className="ml-2 text-[11px] text-gray-400">ブロック {blockLabelByWinnerId[p.id]}</span>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  if (authz === 'checking') {
    return <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">認証を確認しています...</div>;
  }
  if (authz === 'no') {
    return <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">アクセス権限がありません</div>;
  }
  if (!tournamentId) {
    return <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">大会IDが指定されていません</div>;
  }

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full">
              <FaShieldAlt className="text-2xl" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">決勝トーナメント（管理）</h1>
              <div className="text-sm text-gray-300 mt-1">
                {tournament?.name ?? '大会名未設定'}
                {bracket?.title ? <span className="ml-2 text-xs text-gray-400">（{bracket.title}）</span> : null}
              </div>
            </div>
          </div>

          <Link href={`/admin/tournaments/${tournamentId}/league`} className="text-xs md:text-sm text-blue-300 underline">
            ← 予選（リーグ）に戻る
          </Link>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</div>
        )}
        {message && (
          <div className="mb-4 rounded-md border border-green-500/50 bg-green-500/10 px-4 py-2 text-sm text-green-200">
            {message}
          </div>
        )}

        {loading ? (
          <div className="text-gray-300">読み込み中...</div>
        ) : !bracket ? (
          <div className="text-gray-300">決勝トーナメントが見つかりません。</div>
        ) : (
          <div className="space-y-6">
            {/* Candidates */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-4 md:p-6">
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <FaTrophy className="text-yellow-300" />
                予選ブロック優勝者（選択候補）
              </h2>

              {eligiblePlayers.length === 0 ? (
                <div className="text-sm text-gray-300">まだブロック優勝者が確定していません（league_blocks.winner_player_id が必要）。</div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {eligiblePlayers.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                      <div className="h-9 w-9 rounded-full overflow-hidden border border-white/10 bg-black/30 flex items-center justify-center">
                        {p.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.avatar_url} alt={p.handle_name ?? ''} className="h-full w-full object-cover" />
                        ) : (
                          <div className="text-[10px] text-gray-400">no</div>
                        )}
                      </div>
                      <div className="leading-tight">
                        <div className="text-sm font-semibold">
                          {p.handle_name ?? '(名前未設定)'}
                          {blockLabelByWinnerId[p.id] ? (
                            <span className="ml-2 text-[11px] text-gray-300">ブロック {blockLabelByWinnerId[p.id]}</span>
                          ) : null}
                        </div>
                        <div className="text-[11px] text-gray-300">RP: {p.ranking_points ?? 0} / HC: {p.handicap ?? 0}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tree */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-4 md:p-6">
              <div className="text-lg font-semibold mb-1">トーナメントツリー（手動設定）</div>
              <div className="text-xs text-gray-300 mb-4">※ R1〜R5 の各枠を管理者が手動で埋めます（R1→R2…も同様）</div>

              {/* columns = rounds */}
              <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${MAX_ROUND}, minmax(220px, 1fr))` }}>
                {Array.from({ length: MAX_ROUND }, (_, i) => i + 1).map((roundNo) => {
                  const count = slotCountForRound(roundNo);
                  const slotNos = Array.from({ length: count }, (_, k) => k + 1);

                  return (
                    <div key={roundNo} className="space-y-3">
                      <div className="text-sm font-semibold text-purple-100">{roundLabel(roundNo)}</div>

                      {slotNos.map((slotNo) => {
                        const key = `${roundNo}:${slotNo}`;
                        const row = entryMap.get(key);
                        const current = row?.player_id ?? null;
                        const saving = savingKey === key;

                        return (
                          <div key={key} className="rounded-xl border border-white/10 bg-black/30 p-3">
                            <div className="text-[11px] text-gray-300 mb-2">
                              {roundLabel(roundNo)} 枠 {slotNo}
                            </div>

                            <PlayerChip playerId={current} />

                            <div className="mt-3">
                              <select
                                value={current ?? ''}
                                onChange={(e) => handleSetSlot(roundNo, slotNo, e.target.value ? e.target.value : null)}
                                disabled={saving}
                                className="w-full px-2 py-2 rounded border border-purple-500/40 bg-gray-900/80 text-xs md:text-sm disabled:opacity-60"
                              >
                                <option value="">（未設定）</option>
                                {eligiblePlayers.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.handle_name ?? '(名前未設定)'} / RP:{p.ranking_points ?? 0} HC:{p.handicap ?? 0}
                                  </option>
                                ))}
                              </select>
                              <div className="mt-2 text-[11px] text-gray-400">{saving ? '保存中…' : '変更すると即保存されます'}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 text-[11px] text-gray-400">
                ※ いまは「参加者の割当（final_round_entries）」のみ。次に「試合結果入力（final_matches）」を追加します。
              </div>
            </div>

            {/* Link to public */}
            <div className="text-right text-xs">
              <Link href={`/tournaments/${tournamentId}/finals`} className="text-blue-300 underline">
                表画面で確認する →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
