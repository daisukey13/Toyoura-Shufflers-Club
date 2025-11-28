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

type RoundEntryRow = { bracket_id: string; round_no: number; slot_no: number; player_id: string | null };

type FinalMatchRow = {
  id: string;
  bracket_id: string;
  round_no: number;
  match_no: number;
  player_a_id: string | null;
  player_b_id: string | null;
  winner_id: string | null;
  loser_id: string | null;
  winner_score: number | null;
  loser_score: number | null;
  winner_sets: number | null;
  loser_sets: number | null;
  format: string | null;
  finish_reason: string | null;
};

type FinalMatchSetRow = { match_id: string; set_no: number; a_score: number; b_score: number };

type AdminRow = { user_id: string };
type PlayerFlagRow = { is_admin: boolean | null };

const MAX_R1 = 32; // 最大32名
const MAX_ROUND = 5;

const slotCountForRound = (size: number, roundNo: number) => Math.max(1, Math.floor(size / Math.pow(2, roundNo - 1)));
const roundLabel = (r: number) => `R${r}`;

const pow2ceil = (n: number) => {
  let x = 1;
  while (x < n) x *= 2;
  return x;
};

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

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
  const [finalMatches, setFinalMatches] = useState<FinalMatchRow[]>([]);
  const [finalSets, setFinalSets] = useState<FinalMatchSetRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingMatchKey, setSavingMatchKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // ===== auth =====
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
      const es = (eData ?? []) as RoundEntryRow[];
      setEntries(es);

      // matches (+ sets)
      const { data: mData, error: mErr } = await supabase
        .from('final_matches')
        .select('id,bracket_id,round_no,match_no,player_a_id,player_b_id,winner_id,loser_id,winner_score,loser_score,winner_sets,loser_sets,format,finish_reason')
        .eq('bracket_id', b.id);

      if (mErr) throw new Error('試合結果（final_matches）の取得に失敗しました');
      setFinalMatches((mData ?? []) as FinalMatchRow[]);

      // sets
      const { data: sData, error: sErr } = await supabase
        .from('final_match_sets')
        .select('match_id,set_no,a_score,b_score');

      if (sErr) {
        // セット無しでも致命ではない
        setFinalSets([]);
      } else {
        setFinalSets((sData ?? []) as FinalMatchSetRow[]);
      }

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

  const finalsSize = useMemo(() => {
    // R1の埋まり具合で「実運用のトーナメントサイズ」を決める（最小2、最大32）
    const filled = entries.filter((e) => e.round_no === 1 && e.player_id).length;
    if (filled <= 1) return 0;
    return Math.min(MAX_R1, pow2ceil(filled));
  }, [entries]);

  const finalsRounds = useMemo(() => {
    if (finalsSize <= 1) return 0;
    // size=4 -> 2 rounds, size=8 -> 3 rounds...
    return Math.min(MAX_ROUND, Math.round(Math.log2(finalsSize)));
  }, [finalsSize]);

  const finalRoundNo = useMemo(() => {
    if (finalsRounds <= 0) return 0;
    return finalsRounds; // 最終ラウンド
  }, [finalsRounds]);

  const matchMap = useMemo(() => {
    const m = new Map<string, FinalMatchRow>();
    for (const r of finalMatches) m.set(`${r.round_no}:${r.match_no}`, r);
    return m;
  }, [finalMatches]);

  const setMap = useMemo(() => {
    const m = new Map<string, FinalMatchSetRow[]>();
    for (const s of finalSets) {
      const key = s.match_id;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(s);
    }
    for (const [k, arr] of m.entries()) arr.sort((a, b) => a.set_no - b.set_no);
    return m;
  }, [finalSets]);

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
      } catch {}
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
      console.error('[admin/finals] slot save error:', e);
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

  const MatchResultLine = ({ m, aId, bId }: { m: FinalMatchRow | null; aId: string | null; bId: string | null }) => {
    if (!aId || !bId) return <div className="text-xs text-gray-400">対戦者が未設定</div>;
    if (!m?.winner_id || !m?.loser_id) return <div className="text-xs text-gray-400">未入力</div>;

    const a = eligibleById.get(aId);
    const b = eligibleById.get(bId);
    const wName = m.winner_id === aId ? a?.handle_name : b?.handle_name;
    const lName = m.loser_id === aId ? a?.handle_name : b?.handle_name;

    const fr = (m.finish_reason || 'normal').toLowerCase();
    const badge =
      fr === 'time_limit' ? (
        <span className="ml-2 inline-flex items-center rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-200">
          時間切れ
        </span>
      ) : fr === 'forfeit' ? (
        <span className="ml-2 inline-flex items-center rounded-full border border-rose-400/40 bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-200">
          不戦勝/棄権
        </span>
      ) : null;

    return (
      <div className="text-xs text-gray-200">
        {wName ?? '勝者'} {m.winner_score ?? '-'} - {m.loser_score ?? '-'} {lName ?? '敗者'}
        {badge}
      </div>
    );
  };

  const handleReportSingle = async (e: React.FormEvent<HTMLFormElement>, roundNo: number, matchNo: number, aId: string, bId: string) => {
    e.preventDefault();
    if (!bracket?.id) return;
    setError(null);
    setMessage(null);

    const form = e.currentTarget;
    const winnerId = (form.elements.namedItem('winner_id') as HTMLSelectElement)?.value;
    const winnerScoreRaw = (form.elements.namedItem('winner_score') as HTMLInputElement)?.value;
    const loserScoreRaw = (form.elements.namedItem('loser_score') as HTMLInputElement)?.value;
    const finishReason = (form.elements.namedItem('finish_reason') as HTMLSelectElement)?.value || 'normal';

    if (!winnerId) {
      setError('勝者を選択してください');
      return;
    }
    const loserId = winnerId === aId ? bId : aId;

    const winnerScore = clampInt(winnerScoreRaw, 0, 99, 15);
    const loserScore = clampInt(loserScoreRaw, 0, 99, 0);
    if (winnerScore <= loserScore) {
      setError('スコアが不正です（勝者スコア > 敗者スコア）');
      return;
    }

    const key = `${roundNo}:${matchNo}`;
    try {
      setSavingMatchKey(key);

      const res = await fetch('/api/finals/match/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournament_id: tournamentId,
          bracket_id: bracket.id,
          round_no: roundNo,
          match_no: matchNo,
          player_a_id: aId,
          player_b_id: bId,
          format: 'single_game',
          finish_reason: finishReason,
          winner_id: winnerId,
          loser_id: loserId,
          winner_score: winnerScore,
          loser_score: loserScore,
        }),
      });

      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { j = null; }
      if (!res.ok || (j && j.ok === false)) throw new Error(j?.message || text || `HTTP ${res.status}`);

      setMessage(`試合結果を保存しました（${roundLabel(roundNo)} M${matchNo}）`);
      await loadAll(tournamentId);
    } catch (e: any) {
      console.error(e);
      setError(`保存に失敗しました: ${e?.message || 'エラー'}`);
    } finally {
      setSavingMatchKey(null);
    }
  };

  const handleReportFinalBO3 = async (e: React.FormEvent<HTMLFormElement>, roundNo: number, matchNo: number, aId: string, bId: string) => {
    e.preventDefault();
    if (!bracket?.id) return;
    setError(null);
    setMessage(null);

    const form = e.currentTarget;
    const finishReason = (form.elements.namedItem('finish_reason') as HTMLSelectElement)?.value || 'normal';

    const a1 = clampInt((form.elements.namedItem('a1') as HTMLInputElement)?.value, 0, 99, 0);
    const b1 = clampInt((form.elements.namedItem('b1') as HTMLInputElement)?.value, 0, 99, 0);
    const a2 = clampInt((form.elements.namedItem('a2') as HTMLInputElement)?.value, 0, 99, 0);
    const b2 = clampInt((form.elements.namedItem('b2') as HTMLInputElement)?.value, 0, 99, 0);
    const a3 = clampInt((form.elements.namedItem('a3') as HTMLInputElement)?.value, 0, 99, 0);
    const b3 = clampInt((form.elements.namedItem('b3') as HTMLInputElement)?.value, 0, 99, 0);

    const key = `${roundNo}:${matchNo}`;
    try {
      setSavingMatchKey(key);

      const res = await fetch('/api/finals/match/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournament_id: tournamentId,
          bracket_id: bracket.id,
          round_no: roundNo,
          match_no: matchNo,
          player_a_id: aId,
          player_b_id: bId,
          format: 'best_of_3',
          finish_reason: finishReason,
          sets: [
            { set_no: 1, a_score: a1, b_score: b1 },
            { set_no: 2, a_score: a2, b_score: b2 },
            { set_no: 3, a_score: a3, b_score: b3 },
          ],
        }),
      });

      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { j = null; }
      if (!res.ok || (j && j.ok === false)) throw new Error(j?.message || text || `HTTP ${res.status}`);

      setMessage(`決勝結果を保存しました（best_of_3）`);
      await loadAll(tournamentId);
    } catch (e: any) {
      console.error(e);
      setError(`保存に失敗しました: ${e?.message || 'エラー'}`);
    } finally {
      setSavingMatchKey(null);
    }
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
            {/* Tree (手動設定) */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-4 md:p-6">
              <div className="text-lg font-semibold mb-1">トーナメントツリー（手動設定）</div>
              <div className="text-xs text-gray-300 mb-4">※ R1〜R5 の各枠を管理者が手動で埋めます</div>

              <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${MAX_ROUND}, minmax(220px, 1fr))` }}>
                {Array.from({ length: MAX_ROUND }, (_, i) => i + 1).map((roundNo) => {
                  const count = Math.max(1, Math.floor(MAX_R1 / Math.pow(2, roundNo - 1)));
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
            </div>

            {/* Match input */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-4 md:p-6">
              <div className="text-lg font-semibold mb-1">試合結果入力</div>
              <div className="text-xs text-gray-300 mb-4">
                ※ 最終ラウンド（決勝）だけ best_of_3、それ以外は通常1試合。<br />
                ※ 時間切れ / 不戦勝(棄権) は「ラベルとして記録」します（RP/HCはこの決勝テーブルでは変化させません）。
              </div>

              {finalsRounds === 0 ? (
                <div className="text-sm text-gray-300">まずR1に2名以上セットしてください。</div>
              ) : (
                <div className="space-y-6">
                  {Array.from({ length: finalsRounds }, (_, i) => i + 1).map((roundNo) => {
                    const slots = slotCountForRound(finalsSize, roundNo);
                    const matchCount = Math.floor(slots / 2);

                    return (
                      <section key={roundNo} className="space-y-3">
                        <div className="text-sm font-semibold text-purple-100">{roundLabel(roundNo)}</div>

                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm border-collapse">
                            <thead>
                              <tr className="bg-gray-800 text-gray-100 text-xs">
                                <th className="border px-2 py-1 text-left">試合</th>
                                <th className="border px-2 py-1 text-left">現状</th>
                                <th className="border px-2 py-1 text-left">結果入力</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Array.from({ length: matchCount }, (_, mi) => {
                                const matchNo = mi + 1;
                                const aSlot = matchNo * 2 - 1;
                                const bSlot = matchNo * 2;

                                const aId = entryMap.get(`${roundNo}:${aSlot}`)?.player_id ?? null;
                                const bId = entryMap.get(`${roundNo}:${bSlot}`)?.player_id ?? null;

                                const m = matchMap.get(`${roundNo}:${matchNo}`) ?? null;
                                const saving = savingMatchKey === `${roundNo}:${matchNo}`;

                                const aName = aId ? eligibleById.get(aId)?.handle_name ?? '(名前未設定)' : '---';
                                const bName = bId ? eligibleById.get(bId)?.handle_name ?? '(名前未設定)' : '---';

                                const isFinal = roundNo === finalRoundNo && matchNo === 1;

                                return (
                                  <tr key={`${roundNo}-${matchNo}`}>
                                    <td className="border px-2 py-2 align-top">
                                      <div className="flex flex-col">
                                        <span>{aName}</span>
                                        <span className="text-xs text-gray-400">vs</span>
                                        <span>{bName}</span>
                                        <div className="text-[11px] text-gray-500 mt-1">
                                          {roundLabel(roundNo)} M{matchNo}
                                          {isFinal ? '（決勝）' : ''}
                                        </div>
                                      </div>
                                    </td>

                                    <td className="border px-2 py-2 align-top">
                                      <MatchResultLine m={m} aId={aId} bId={bId} />
                                      {m?.id && (m.format || '').toLowerCase() === 'best_of_3' ? (
                                        <div className="mt-2 text-[11px] text-gray-300">
                                          {(setMap.get(m.id) ?? []).map((s) => (
                                            <div key={s.set_no}>
                                              Set{s.set_no}: {s.a_score}-{s.b_score}
                                            </div>
                                          ))}
                                        </div>
                                      ) : null}
                                    </td>

                                    <td className="border px-2 py-2 align-top">
                                      {!aId || !bId ? (
                                        <div className="text-xs text-gray-400">対戦者が未設定のため入力できません</div>
                                      ) : isFinal ? (
                                        <form
                                          onSubmit={(e) => handleReportFinalBO3(e, roundNo, matchNo, aId, bId)}
                                          className="flex flex-col gap-2"
                                        >
                                          <div className="flex items-center gap-2">
                                            <span className="text-xs text-gray-300">種別</span>
                                            <select
                                              name="finish_reason"
                                              defaultValue={m?.finish_reason ?? 'normal'}
                                              className="px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs"
                                            >
                                              <option value="normal">通常</option>
                                              <option value="time_limit">時間切れ</option>
                                              <option value="forfeit">不戦勝/棄権</option>
                                            </select>
                                          </div>

                                          <div className="text-xs text-gray-300">best of 3（Set1〜3）</div>
                                          <div className="grid grid-cols-3 gap-2">
                                            <div className="rounded border border-white/10 bg-black/30 p-2">
                                              <div className="text-[11px] text-gray-300 mb-1">Set1</div>
                                              <div className="flex items-center gap-1">
                                                <input name="a1" type="number" min={0} max={99} defaultValue={0} className="w-14 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center text-xs" />
                                                <span className="text-xs text-gray-400">-</span>
                                                <input name="b1" type="number" min={0} max={99} defaultValue={0} className="w-14 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center text-xs" />
                                              </div>
                                            </div>

                                            <div className="rounded border border-white/10 bg-black/30 p-2">
                                              <div className="text-[11px] text-gray-300 mb-1">Set2</div>
                                              <div className="flex items-center gap-1">
                                                <input name="a2" type="number" min={0} max={99} defaultValue={0} className="w-14 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center text-xs" />
                                                <span className="text-xs text-gray-400">-</span>
                                                <input name="b2" type="number" min={0} max={99} defaultValue={0} className="w-14 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center text-xs" />
                                              </div>
                                            </div>

                                            <div className="rounded border border-white/10 bg-black/30 p-2">
                                              <div className="text-[11px] text-gray-300 mb-1">Set3</div>
                                              <div className="flex items-center gap-1">
                                                <input name="a3" type="number" min={0} max={99} defaultValue={0} className="w-14 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center text-xs" />
                                                <span className="text-xs text-gray-400">-</span>
                                                <input name="b3" type="number" min={0} max={99} defaultValue={0} className="w-14 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center text-xs" />
                                              </div>
                                            </div>
                                          </div>

                                          <button
                                            type="submit"
                                            disabled={saving}
                                            className="mt-1 px-3 py-1 rounded bg-purple-600 text-white text-xs disabled:opacity-50"
                                          >
                                            {saving ? '保存中...' : '保存'}
                                          </button>
                                        </form>
                                      ) : (
                                        <form
                                          onSubmit={(e) => handleReportSingle(e, roundNo, matchNo, aId, bId)}
                                          className="flex flex-col md:flex-row md:items-center gap-2"
                                        >
                                          <select
                                            name="finish_reason"
                                            defaultValue={m?.finish_reason ?? 'normal'}
                                            className="px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs"
                                          >
                                            <option value="normal">通常</option>
                                            <option value="time_limit">時間切れ</option>
                                            <option value="forfeit">不戦勝/棄権</option>
                                          </select>

                                          <select
                                            name="winner_id"
                                            defaultValue={m?.winner_id ?? ''}
                                            className="min-w-[140px] px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs md:text-sm"
                                          >
                                            <option value="">勝者を選択</option>
                                            <option value={aId}>{aName}</option>
                                            <option value={bId}>{bName}</option>
                                          </select>

                                          <div className="flex items-center gap-1 text-xs md:text-sm">
                                            <span className="text-gray-300">勝者</span>
                                            <input
                                              name="winner_score"
                                              type="number"
                                              min={0}
                                              max={99}
                                              defaultValue={m?.winner_score ?? 15}
                                              className="w-16 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center"
                                            />
                                          </div>

                                          <div className="flex items-center gap-1 text-xs md:text-sm">
                                            <span className="text-gray-300">敗者</span>
                                            <input
                                              name="loser_score"
                                              type="number"
                                              min={0}
                                              max={99}
                                              defaultValue={m?.loser_score ?? 0}
                                              className="w-16 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center"
                                            />
                                          </div>

                                          <button
                                            type="submit"
                                            disabled={saving}
                                            className="mt-1 md:mt-0 px-3 py-1 rounded bg-purple-600 text-white text-xs md:text-sm disabled:opacity-50"
                                          >
                                            {saving ? '保存中...' : m?.winner_id ? '更新' : '登録'}
                                          </button>
                                        </form>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 text-right text-xs">
                <Link href={`/tournaments/${tournamentId}/finals`} className="text-blue-300 underline">
                  表画面で確認する →
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
