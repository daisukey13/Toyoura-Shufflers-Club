'use client';

import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FaShieldAlt, FaTrophy } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

type FinalBracket = {
  id: string;
  tournament_id: string;
  title: string | null;
  created_at: string | null;
};

type FinalRoundEntry = {
  id: string;
  bracket_id: string;
  round_no: number;
  slot_no: number;
  player_id: string | null;
};

type FinalMatchRow = {
  id: string;
  bracket_id?: string | null;
  round_no?: number | null;

  match_no?: number | null;
  match_index?: number | null;
  created_at?: string | null;

  winner_id?: string | null;
  loser_id?: string | null;
  winner_score?: number | null;
  loser_score?: number | null;

  finish_reason?: string | null;
  end_reason?: string | null;

  [key: string]: any;
};

type Player = {
  id: string;
  handle_name: string | null;
  avatar_url: string | null;
  ranking_points: number | null;
  handicap: number | null;
  is_admin?: boolean | null;
};

type AdminRow = { user_id: string };
type PlayerFlagRow = { is_admin: boolean | null };

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const normalizeReason = (m: FinalMatchRow) =>
  String(m.finish_reason ?? m.end_reason ?? 'normal').trim().toLowerCase();

const inferWinnerFromSets = (a: number[], b: number[]) => {
  let aWins = 0;
  let bWins = 0;

  for (let i = 0; i < 3; i++) {
    const as = a[i];
    const bs = b[i];
    if (as == null || bs == null) continue;
    if (as < 0 || bs < 0) continue;
    if (as === bs) continue;
    if (as > bs) aWins++;
    else bWins++;
  }

  if (aWins >= 2) return 'A' as const;
  if (bWins >= 2) return 'B' as const;
  return null;
};

const isMissingColumnError = (err: any) => {
  const code = err?.code;
  const msg = String(err?.message ?? '');
  return code === '42703' || msg.includes('does not exist') || msg.includes('column');
};

async function fetchFinalMatchesOnce(bracketId: string): Promise<FinalMatchRow[]> {
  const { data, error } = await supabase
    .from('final_matches')
    .select('*')
    .eq('bracket_id', bracketId)
    .order('round_no', { ascending: true });

  if (!error) return (data ?? []) as FinalMatchRow[];

  const { data: data2, error: error2 } = await supabase.from('final_matches').select('*').eq('bracket_id', bracketId);
  if (error2) throw new Error(String(error2.message || 'final_matches fetch failed'));
  return (data2 ?? []) as FinalMatchRow[];
}

async function postFinalReport(payload: {
  bracket_id: string;
  round_no: number;
  match_no: number;
  winner_id: string | null;
  loser_id: string | null;
  winner_score: number | null;
  loser_score: number | null;
  end_reason?: string | null;
  finish_reason?: string | null;
  reason?: string | null;
  sets?: any;
}) {
  const res = await fetch('/api/finals/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  try {
    const j = JSON.parse(text);
    if (!res.ok || j?.ok === false) throw new Error(j?.error || j?.message || `HTTP ${res.status}`);
    return j;
  } catch {
    throw new Error(text.slice(0, 200));
  }
}

async function clearFinalMatchesFromRound(bracketId: string, fromRoundNo: number) {
  const candidates: Record<string, any>[] = [
    {
      winner_id: null,
      loser_id: null,
      winner_score: null,
      loser_score: null,
      finish_reason: 'normal',
      end_reason: 'normal',
      sets: null,
    },
    {
      winner_id: null,
      loser_id: null,
      winner_score: null,
      loser_score: null,
      finish_reason: null,
      end_reason: null,
      sets: null,
    },
    {
      winner_id: null,
      loser_id: null,
      winner_score: null,
      loser_score: null,
      finish_reason: null,
      end_reason: null,
    },
    { winner_id: null, loser_id: null, winner_score: null, loser_score: null },
    { winner_id: null, loser_id: null },
  ];

  let lastErr: any = null;

  for (const payload of candidates) {
    const { error } = await supabase
      .from('final_matches')
      .update(payload)
      .eq('bracket_id', bracketId)
      .gte('round_no', fromRoundNo);

    if (!error) return;
    lastErr = error;

    if (isMissingColumnError(error)) continue;
    break;
  }

  throw new Error(String(lastErr?.message || 'final_matches clear failed'));
}

export default function AdminTournamentFinalsPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = typeof params?.tournamentId === 'string' ? String(params.tournamentId) : '';

  const [authz, setAuthz] = useState<'checking' | 'ok' | 'no'>('checking');

  const [bracket, setBracket] = useState<FinalBracket | null>(null);
  const [entries, setEntries] = useState<FinalRoundEntry[]>([]);
  const [matches, setMatches] = useState<FinalMatchRow[]>([]);
  const [players, setPlayers] = useState<Record<string, Player>>({});

  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  /** ✅ “余計なラウンド非表示”のための表示上限（localStorageで維持） */
  const storageKey = useMemo(
    () => (tournamentId ? `admin_finals_visible_round_max:${tournamentId}` : 'admin_finals_visible_round_max'),
    [tournamentId]
  );
  const [manualMaxRound, setManualMaxRound] = useState<number | null>(null);

  useEffect(() => {
    if (manualMaxRound != null) return;
    try {
      const raw = localStorage.getItem(storageKey);
      const n = parseInt(String(raw ?? ''), 10);
      setManualMaxRound(Number.isFinite(n) ? n : 0);
    } catch {
      setManualMaxRound(0);
    }
  }, [manualMaxRound, storageKey]);

  const setManualMaxRoundAndPersist = (n: number) => {
    setManualMaxRound(n);
    try {
      localStorage.setItem(storageKey, String(n));
    } catch {}
  };

  // authz
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

        const isAdmin = Boolean(adminRow?.user_id) || playerRow?.is_admin === true;

        if (!isAdmin) {
          setAuthz('no');
          return;
        }

        if (!cancelled) {
          setAuthz('ok');
          void loadAll();
        }
      } catch (e) {
        console.error('[admin/finals] auth error:', e);
        setAuthz('no');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, tournamentId]);

  const loadAll = async () => {
    if (!tournamentId) return;

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { data: bRows, error: bErr } = await supabase
        .from('final_brackets')
        .select('id,tournament_id,title,created_at')
        .eq('tournament_id', tournamentId)
        .order('created_at', { ascending: false });

      if (bErr || !bRows || bRows.length === 0) {
        setError('決勝トーナメントが見つかりませんでした');
        setLoading(false);
        return;
      }

      const b = bRows[0] as FinalBracket;
      setBracket(b);

      const { data: eRows, error: eErr } = await supabase
        .from('final_round_entries')
        .select('id,bracket_id,round_no,slot_no,player_id')
        .eq('bracket_id', b.id)
        .order('round_no', { ascending: true })
        .order('slot_no', { ascending: true });

      if (eErr) {
        setError('決勝トーナメント枠の取得に失敗しました');
        setLoading(false);
        return;
      }
      const es = (eRows ?? []) as FinalRoundEntry[];
      setEntries(es);

      let ms: FinalMatchRow[] = [];
      try {
        ms = await fetchFinalMatchesOnce(b.id);
      } catch (e) {
        console.error('[admin/finals] final_matches fetch error:', e);
        setError('決勝トーナメント試合結果の取得に失敗しました');
        setLoading(false);
        return;
      }
      setMatches(ms);

      const { data: allPlayers, error: apErr } = await supabase
        .from('players')
        .select('id,handle_name,avatar_url,ranking_points,handicap')
        .order('handle_name', { ascending: true });

      if (apErr) console.warn('[admin/finals] players(all) fetch error:', apErr);

      const dict: Record<string, Player> = {};
      (allPlayers ?? []).forEach((p: any) => {
        dict[p.id] = {
          id: p.id,
          handle_name: p.handle_name,
          avatar_url: p.avatar_url,
          ranking_points: p.ranking_points,
          handicap: p.handicap,
        };
      });

      setPlayers(dict);
      setLoading(false);
    } catch (e: any) {
      console.error('[admin/finals] fatal:', e);
      setError(e?.message || 'データ取得に失敗しました');
      setLoading(false);
    }
  };

  const entryMap = useMemo(() => {
    const map = new Map<string, FinalRoundEntry>();
    for (const e of entries) map.set(`${e.round_no}:${e.slot_no}`, e);
    return map;
  }, [entries]);

  const matchByRoundMatch = useMemo(() => {
    const map = new Map<string, FinalMatchRow>();

    const groups = new Map<number, FinalMatchRow[]>();
    for (const m of matches) {
      const r = Number(m.round_no ?? 0);
      if (!r) continue;
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r)!.push(m);
    }

    for (const [r, list] of groups.entries()) {
      const sorted = [...list].sort((a, b) => {
        const aNo = Number(a.match_no ?? a.match_index ?? 0);
        const bNo = Number(b.match_no ?? b.match_index ?? 0);
        if (aNo && bNo && aNo !== bNo) return aNo - bNo;

        const ac = String(a.created_at ?? '');
        const bc = String(b.created_at ?? '');
        if (ac && bc && ac !== bc) return ac < bc ? -1 : 1;

        return String(a.id).localeCompare(String(b.id));
      });

      sorted.forEach((m, i) => {
        const no = Number(m.match_no ?? m.match_index ?? 0) || i + 1;
        map.set(`${r}:${no}`, m);
      });
    }

    return map;
  }, [matches]);

  /** ✅ ラウンド表示：デフォルトは“必要な分だけ” */
  const baseMaxRound = useMemo(() => {
    let max = 1;

    const hasAnyAssigned = (r: number) => entries.some((e) => e.round_no === r && !!e.player_id);
    const hasAnyResult = (r: number) =>
      matches.some((m) => {
        if (Number(m.round_no ?? 0) !== r) return false;
        if (m.winner_id || m.loser_id) return true;
        if (m.winner_score != null || m.loser_score != null) return true;
        return false;
      });

    const candidates = new Set<number>();
    entries.forEach((e) => candidates.add(Number(e.round_no)));
    matches.forEach((m) => {
      const r = Number(m.round_no ?? 0);
      if (r > 0) candidates.add(r);
    });

    for (const r of Array.from(candidates).filter((x) => x > 0)) {
      if (hasAnyAssigned(r) || hasAnyResult(r)) max = Math.max(max, r);
    }
    return max;
  }, [entries, matches]);

  const visibleMaxRound = Math.max(baseMaxRound, manualMaxRound ?? 0, 1);
  const visibleRounds = useMemo(() => Array.from({ length: visibleMaxRound }, (_, i) => i + 1), [visibleMaxRound]);

  const lastRound = visibleRounds[visibleRounds.length - 1];

  const getMatchCountForRound = (roundNo: number) => {
    const maxSlot = entries.filter((e) => e.round_no === roundNo).reduce((mx, e) => Math.max(mx, e.slot_no), 0);
    const fromEntries = Math.max(1, Math.floor(maxSlot / 2));
    const fromMatches = matches.filter((m) => Number(m.round_no ?? 0) === roundNo).length;
    return Math.max(fromEntries, fromMatches, 1);
  };

  const formatPlayerOption = (p: Player) => {
    const name = p.handle_name ?? '(名前未設定)';
    return `${name}  (RP:${p.ranking_points ?? 0} / HC:${p.handicap ?? 0})`;
  };

  const handleChangeEntry = async (entry: FinalRoundEntry, nextPlayerId: string) => {
    setError(null);
    setMessage(null);
    setSavingKey(`entry:${entry.id}`);

    try {
      const next = nextPlayerId ? nextPlayerId : null;

      const { error } = await supabase.from('final_round_entries').update({ player_id: next }).eq('id', entry.id);
      if (error) throw new Error(error.message);

      if (bracket?.id) {
        await clearFinalMatchesFromRound(bracket.id, entry.round_no);
      }

      setMessage('枠を更新しました（このラウンド以降の試合結果をクリアしました）');
      await loadAll();
    } catch (e: any) {
      console.error('[admin/finals] entry update error:', e);
      setError(`枠の更新に失敗しました: ${e?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
    }
  };

  const handleClearFromRound = async (fromRound: number) => {
    if (!bracket?.id) return;
    setError(null);
    setMessage(null);
    const key = `clear:${fromRound}`;
    setSavingKey(key);
    try {
      await clearFinalMatchesFromRound(bracket.id, fromRound);
      setMessage(`R${fromRound}以降の試合結果をクリアしました`);
      await loadAll();
    } catch (e: any) {
      console.error('[admin/finals] clear error:', e);
      setError(`クリアに失敗しました: ${e?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
    }
  };

  /** ✅ ＋枠追加（2つずつ） */
  const handleAddSlots = async (roundNo: number, addCount = 2) => {
    if (!bracket?.id) return;
    setError(null);
    setMessage(null);
    const key = `addslots:${roundNo}`;
    setSavingKey(key);

    try {
      const currentMax = entries.filter((e) => e.round_no === roundNo).reduce((mx, e) => Math.max(mx, e.slot_no), 0);
      const rows = Array.from({ length: addCount }).map((_, i) => ({
        bracket_id: bracket.id,
        round_no: roundNo,
        slot_no: currentMax + i + 1,
        player_id: null,
      }));

      const { error: insErr } = await supabase.from('final_round_entries').insert(rows as any);
      if (insErr) throw new Error(insErr.message);

      // 構成が変わるので、取り残し防止でそのラウンド以降クリア
      await clearFinalMatchesFromRound(bracket.id, roundNo);

      setMessage(`R${roundNo}に枠を追加しました（以降の試合結果をクリア）`);
      await loadAll();
    } catch (e: any) {
      console.error('[admin/finals] add slots error:', e);
      setError(`枠追加に失敗しました: ${e?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
    }
  };

  /** ✅ ＋ラウンド追加（次ラウンドを表示 + 枠2つ作成） */
  const handleAddRound = async () => {
    const next = visibleMaxRound + 1;
    setManualMaxRoundAndPersist(next);
    // round自体が空なら枠を作る（既にある場合でも slot_no が増えるので “round追加”は初回想定）
    await handleAddSlots(next, 2);
  };

  const handleReportSingle = async (e: FormEvent<HTMLFormElement>, roundNo: number, matchNo: number) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!bracket?.id) {
      setError('bracket_id が取得できません');
      return;
    }

    const slotA = matchNo * 2 - 1;
    const slotB = matchNo * 2;
    const pidA = entryMap.get(`${roundNo}:${slotA}`)?.player_id ?? null;
    const pidB = entryMap.get(`${roundNo}:${slotB}`)?.player_id ?? null;
    if (!pidA || !pidB) {
      setError('参加者が未設定です（枠を先に設定してください）');
      return;
    }

    const form = e.currentTarget;
    const end_reason = String((form.elements.namedItem('end_reason') as HTMLSelectElement)?.value || 'normal')
      .trim()
      .toLowerCase();

    const winner_id = String((form.elements.namedItem('winner_id') as HTMLSelectElement)?.value || '').trim();
    if (!winner_id) {
      setError('勝者を選択してください');
      return;
    }
    if (winner_id !== pidA && winner_id !== pidB) {
      setError('勝者が不正です');
      return;
    }

    const loser_id = winner_id === pidA ? pidB : pidA;

    const winner_score = clampInt((form.elements.namedItem('winner_score') as HTMLInputElement)?.value, 0, 99, 15);
    const loser_score = clampInt((form.elements.namedItem('loser_score') as HTMLInputElement)?.value, 0, 99, 0);
    if (winner_score <= loser_score) {
      setError('スコアが不正です（勝者スコア > 敗者スコア）');
      return;
    }

    const key = `match:${roundNo}:${matchNo}`;
    setSavingKey(key);

    try {
      await postFinalReport({
        bracket_id: bracket.id,
        round_no: roundNo,
        match_no: matchNo,
        winner_id,
        loser_id,
        winner_score,
        loser_score,
        end_reason,
      });

      setMessage('保存しました');
      await loadAll();
    } catch (e2: any) {
      console.error('[admin/finals] report error:', e2);
      setError(`保存に失敗しました: ${e2?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
    }
  };

  const handleReportBestOf3 = async (e: FormEvent<HTMLFormElement>, roundNo: number, matchNo: number) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!bracket?.id) {
      setError('bracket_id が取得できません');
      return;
    }

    const slotA = matchNo * 2 - 1;
    const slotB = matchNo * 2;
    const pidA = entryMap.get(`${roundNo}:${slotA}`)?.player_id ?? null;
    const pidB = entryMap.get(`${roundNo}:${slotB}`)?.player_id ?? null;
    if (!pidA || !pidB) {
      setError('参加者が未設定です（R2枠を先に設定してください）');
      return;
    }

    const form = e.currentTarget;
    const end_reason = String((form.elements.namedItem('end_reason') as HTMLSelectElement)?.value || 'normal')
      .trim()
      .toLowerCase();

    const s1a = clampInt((form.elements.namedItem('set1_a') as HTMLInputElement)?.value, 0, 99, -1);
    const s1b = clampInt((form.elements.namedItem('set1_b') as HTMLInputElement)?.value, 0, 99, -1);
    const s2a = clampInt((form.elements.namedItem('set2_a') as HTMLInputElement)?.value, 0, 99, -1);
    const s2b = clampInt((form.elements.namedItem('set2_b') as HTMLInputElement)?.value, 0, 99, -1);
    const s3a = clampInt((form.elements.namedItem('set3_a') as HTMLInputElement)?.value, 0, 99, -1);
    const s3b = clampInt((form.elements.namedItem('set3_b') as HTMLInputElement)?.value, 0, 99, -1);

    const manualWinner = String((form.elements.namedItem('winner_id') as HTMLSelectElement)?.value || '').trim();

    let winner_id = manualWinner;
    if (!winner_id) {
      const inferred = inferWinnerFromSets([s1a, s2a, s3a], [s1b, s2b, s3b]);
      if (inferred === 'A') winner_id = pidA;
      if (inferred === 'B') winner_id = pidB;
    }

    if (!winner_id) {
      setError('勝者を確定できません（Set結果が不足）。勝者を選択してください。');
      return;
    }
    if (winner_id !== pidA && winner_id !== pidB) {
      setError('勝者が不正です');
      return;
    }

    const loser_id = winner_id === pidA ? pidB : pidA;

    let aWins = 0;
    let bWins = 0;
    const As = [s1a, s2a, s3a];
    const Bs = [s1b, s2b, s3b];
    for (let i = 0; i < 3; i++) {
      if (As[i] < 0 || Bs[i] < 0) continue;
      if (As[i] === Bs[i]) continue;
      if (As[i] > Bs[i]) aWins++;
      else bWins++;
    }
    const winner_score = winner_id === pidA ? aWins : bWins;
    const loser_score = winner_id === pidA ? bWins : aWins;

    const key = `match:${roundNo}:${matchNo}`;
    setSavingKey(key);

    try {
      await postFinalReport({
        bracket_id: bracket.id,
        round_no: roundNo,
        match_no: matchNo,
        winner_id,
        loser_id,
        winner_score,
        loser_score,
        end_reason,
        sets: [
          { a: s1a, b: s1b },
          { a: s2a, b: s2b },
          { a: s3a, b: s3b },
        ],
      });

      setMessage('保存しました');
      await loadAll();
    } catch (e2: any) {
      console.error('[admin/finals] report(best_of_3) error:', e2);
      setError(`保存に失敗しました: ${e2?.message || 'エラー'}`);
    } finally {
      setSavingKey(null);
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
        {/* header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full">
              <FaShieldAlt className="text-2xl" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">決勝トーナメント管理</h1>
              <div className="text-sm text-gray-300 mt-1">
                {bracket?.title ?? '決勝トーナメント'}
                <span className="ml-2 text-xs text-gray-400">（大会ID: {tournamentId}）</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <Link href={`/admin/tournaments/${tournamentId}/league`} className="text-blue-300 underline">
              ← 予選（リーグ）へ
            </Link>
            <Link href={`/tournaments/${tournamentId}/finals`} className="text-blue-300 underline">
              表画面で確認 →
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {error}
          </div>
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
          <div className="space-y-8">
            {/* entries */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-4 md:p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <FaTrophy className="text-yellow-300" />
                  参加者枠（ラウンドごと）
                </h2>

                <div className="flex items-center gap-3 text-xs">
                  <button
                    onClick={() => handleAddRound()}
                    disabled={savingKey?.startsWith('addslots:') || !bracket?.id}
                    className="text-blue-300 underline disabled:opacity-50"
                  >
                    ＋ラウンド追加
                  </button>

                  <button
                    onClick={() => setManualMaxRoundAndPersist(0)}
                    className="text-gray-300 underline"
                    type="button"
                  >
                    表示ラウンドをリセット
                  </button>
                </div>
              </div>

              <div className="text-xs text-gray-300 mb-3">
                ※ デフォルトでは「必要なラウンドだけ」表示します（ミス入力防止）。必要になったら「＋ラウンド追加」「＋枠追加」で増やします。
              </div>

              <div className="space-y-6">
                {visibleRounds.map((r) => {
                  const list = entries
                    .filter((e) => e.round_no === r)
                    .sort((a, b) => a.slot_no - b.slot_no);

                  return (
                    <div key={`round-entries-${r}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-bold">R{r}</div>
                        <button
                          type="button"
                          onClick={() => handleAddSlots(r, 2)}
                          disabled={!bracket?.id || savingKey === `addslots:${r}`}
                          className="text-xs text-blue-300 underline disabled:opacity-50"
                        >
                          {savingKey === `addslots:${r}` ? '追加中…' : '＋枠追加'}
                        </button>
                      </div>

                      {list.length === 0 ? (
                        <div className="text-gray-400 text-sm">
                          枠がありません（＋枠追加 で作成できます）
                        </div>
                      ) : (
                        <div className="grid gap-3 md:grid-cols-2">
                          {list.map((e) => {
                            const current = e.player_id ? players[e.player_id] : null;

                            return (
                              <div key={e.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                                <div className="text-xs text-gray-300 mb-2">
                                  R{e.round_no} / 枠{e.slot_no}
                                </div>

                                <div className="flex items-center gap-2 mb-2">
                                  {current?.avatar_url ? (
                                    <img
                                      src={current.avatar_url}
                                      alt={current.handle_name ?? ''}
                                      className="w-8 h-8 rounded-full object-cover border border-white/20"
                                    />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full bg-white/10 border border-white/20" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold truncate">{current?.handle_name ?? '未設定'}</div>
                                    <div className="text-[11px] text-gray-300">
                                      RP:{current?.ranking_points ?? 0} / HC:{current?.handicap ?? 0}
                                    </div>
                                  </div>
                                </div>

                                <select
                                  value={e.player_id ?? ''}
                                  onChange={(ev) => handleChangeEntry(e, ev.target.value)}
                                  disabled={savingKey === `entry:${e.id}`}
                                  className="w-full px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs md:text-sm disabled:opacity-60"
                                >
                                  <option value="">（未設定）</option>
                                  {Object.values(players).map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {formatPlayerOption(p)}
                                    </option>
                                  ))}
                                </select>

                                <div className="mt-2 text-[11px] text-gray-400">
                                  ※ 枠を変更すると R{e.round_no} 以降の試合結果は自動クリアされます（取り残し防止）
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* results input */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-4 md:p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <FaTrophy className="text-yellow-300" />
                試合結果入力
              </h2>

              <div className="text-xs text-gray-300 mb-3 space-y-1">
                <div>※ 最終ラウンド（決勝）だけ best_of_3、それ以外は通常1試合。</div>
                <div>※ 時間切れ/不戦勝/棄権 は「ラベルとして記録」します（決勝テーブルではRP/HCは変化させません）。</div>
                <div>※ 枠・ラウンドを増減したら「このラウンド以降をクリア」を使って取り残しを消してください。</div>
              </div>

              {visibleRounds.map((r) => {
                const isFinal = r === lastRound;
                const matchCount = getMatchCountForRound(r);

                return (
                  <div key={`round-input-${r}`} className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-bold">R{r}</div>
                      <button
                        type="button"
                        onClick={() => handleClearFromRound(r)}
                        disabled={!bracket?.id || savingKey === `clear:${r}`}
                        className="text-xs text-blue-300 underline disabled:opacity-50"
                      >
                        {savingKey === `clear:${r}` ? 'クリア中…' : 'このラウンド以降をクリア'}
                      </button>
                    </div>

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
                          {Array.from({ length: matchCount }).map((_, idx) => {
                            const matchNo = idx + 1;
                            const slotA = matchNo * 2 - 1;
                            const slotB = matchNo * 2;

                            const pidA = entryMap.get(`${r}:${slotA}`)?.player_id ?? null;
                            const pidB = entryMap.get(`${r}:${slotB}`)?.player_id ?? null;

                            const pA = pidA ? players[pidA] : null;
                            const pB = pidB ? players[pidB] : null;

                            const m = matchByRoundMatch.get(`${r}:${matchNo}`) ?? null;

                            const hasResult = !!m?.winner_id && !!m?.loser_id;
                            const reason = m ? normalizeReason(m) : 'normal';

                            const aName = pA?.handle_name ?? '未設定';
                            const bName = pB?.handle_name ?? '未設定';

                            const currentResult = hasResult
                              ? `${players[m!.winner_id!]?.handle_name ?? '勝者'} ${m!.winner_score ?? '-'} - ${m!.loser_score ?? '-'} ${players[m!.loser_id!]?.handle_name ?? '敗者'}`
                              : '未入力';

                            const saveKey = `match:${r}:${matchNo}`;

                            return (
                              <tr key={`r${r}-m${matchNo}`}>
                                <td className="border px-2 py-2 align-top">
                                  <div className="flex flex-col">
                                    <span>{aName}</span>
                                    <span className="text-xs text-gray-400">vs</span>
                                    <span>{bName}</span>
                                  </div>
                                  <div className="text-[11px] text-gray-400 mt-1">
                                    R{r} M{matchNo}
                                    {isFinal ? '（決勝）' : ''}
                                  </div>
                                </td>

                                <td className="border px-2 py-2 align-top">
                                  <span className={hasResult ? 'text-green-300' : 'text-gray-300'}>{currentResult}</span>
                                  {reason !== 'normal' && (
                                    <div className="mt-1 text-[11px] text-amber-200">
                                      種別: {reason === 'time_limit' ? '時間切れ' : reason === 'forfeit' ? '棄権/不戦' : reason}
                                    </div>
                                  )}
                                  {!pidA || !pidB ? (
                                    <div className="mt-1 text-[11px] text-red-200">※ 参加者が未設定です（枠を先に設定）</div>
                                  ) : null}
                                </td>

                                <td className="border px-2 py-2 align-top">
                                  {isFinal ? (
                                    <form onSubmit={(e) => handleReportBestOf3(e, r, matchNo)} className="space-y-2">
                                      <div className="flex flex-wrap gap-2 items-center">
                                        <div className="text-xs text-gray-300">種別</div>
                                        <select
                                          name="end_reason"
                                          defaultValue={reason}
                                          className="px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs"
                                        >
                                          <option value="normal">通常</option>
                                          <option value="time_limit">時間切れ</option>
                                          <option value="forfeit">棄権/不戦</option>
                                        </select>

                                        <div className="text-xs text-gray-300 ml-2">勝者</div>
                                        <select
                                          name="winner_id"
                                          defaultValue={m?.winner_id ?? ''}
                                          className="min-w-[160px] px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs"
                                        >
                                          <option value="">（自動判定）</option>
                                          {pidA && <option value={pidA}>{aName}</option>}
                                          {pidB && <option value={pidB}>{bName}</option>}
                                        </select>

                                        <div className="text-[11px] text-gray-400">※未選択ならSet結果から自動判定</div>
                                      </div>

                                      <div className="grid gap-2 md:grid-cols-3">
                                        {[
                                          { label: 'Set1', a: 'set1_a', b: 'set1_b' },
                                          { label: 'Set2', a: 'set2_a', b: 'set2_b' },
                                          { label: 'Set3', a: 'set3_a', b: 'set3_b' },
                                        ].map((s) => (
                                          <div key={s.label} className="rounded-xl border border-white/10 bg-black/30 p-2">
                                            <div className="text-[11px] text-gray-300 mb-1">{s.label}</div>
                                            <div className="flex items-center gap-2">
                                              <input
                                                name={s.a}
                                                type="number"
                                                min={0}
                                                max={99}
                                                defaultValue={0}
                                                className="w-14 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center text-xs"
                                              />
                                              <span className="text-gray-400 text-xs">-</span>
                                              <input
                                                name={s.b}
                                                type="number"
                                                min={0}
                                                max={99}
                                                defaultValue={0}
                                                className="w-14 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center text-xs"
                                              />
                                            </div>
                                          </div>
                                        ))}
                                      </div>

                                      <button
                                        type="submit"
                                        disabled={savingKey === saveKey}
                                        className="w-full px-3 py-2 rounded bg-purple-600 text-white text-xs md:text-sm disabled:opacity-50"
                                      >
                                        {savingKey === saveKey ? '保存中...' : '保存'}
                                      </button>
                                    </form>
                                  ) : (
                                    <form
                                      onSubmit={(e) => handleReportSingle(e, r, matchNo)}
                                      className="flex flex-col md:flex-row md:items-center gap-2"
                                    >
                                      <select
                                        name="end_reason"
                                        defaultValue={reason}
                                        className="px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs md:text-sm"
                                      >
                                        <option value="normal">通常</option>
                                        <option value="time_limit">時間切れ</option>
                                        <option value="forfeit">棄権/不戦</option>
                                      </select>

                                      <select
                                        name="winner_id"
                                        defaultValue={m?.winner_id ?? ''}
                                        className="min-w-[140px] px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs md:text-sm"
                                      >
                                        <option value="">勝者を選択</option>
                                        {pidA && <option value={pidA}>{aName}</option>}
                                        {pidB && <option value={pidB}>{bName}</option>}
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
                                        disabled={savingKey === saveKey}
                                        className="mt-1 md:mt-0 px-3 py-1 rounded bg-purple-600 text-white text-xs md:text-sm disabled:opacity-50"
                                      >
                                        {savingKey === saveKey ? '保存中...' : hasResult ? '更新' : '登録'}
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
                  </div>
                );
              })}

              <div className="text-right text-xs">
                <button onClick={() => loadAll()} className="text-blue-300 underline">
                  再読み込み
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
