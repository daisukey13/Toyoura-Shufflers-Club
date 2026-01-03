'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FaArrowLeft, FaSave } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

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
  bracket_id: string;
  round_no: number;
  match_no: number | null;
  match_index: number | null;
  created_at: string | null;

  winner_id: string | null;
  loser_id: string | null;
  winner_score: number | null;
  loser_score: number | null;

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
};

const toInt = (v: any): number | null => {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
};

const normalizeReason = (m: { finish_reason?: any; end_reason?: any } | null | undefined) =>
  String(m?.finish_reason ?? m?.end_reason ?? 'normal').trim().toLowerCase();

const reasonLabel = (r: string) => {
  const v = String(r || 'normal').toLowerCase();
  if (v === 'normal') return '通常';
  if (v === 'time_limit') return '時間切れ';
  if (v === 'forfeit') return '棄権/不戦';
  return v;
};

// ✅ end_reason / finish_reason 列差異を吸収（最小）
const isMissingColumnError = (err: any) => {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '');
  return code === '42703' || msg.includes('does not exist') || msg.toLowerCase().includes('column');
};

function PlayerCardMini({ p }: { p?: Player }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {p?.avatar_url ? (
        <img
          src={p.avatar_url}
          alt={p.handle_name ?? ''}
          className="w-8 h-8 rounded-full object-cover border border-white/20"
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-white/10 border border-white/20" />
      )}
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate">{p?.handle_name ?? '未設定'}</div>
        <div className="text-[11px] text-gray-300 truncate">
          RP:{p?.ranking_points ?? 0} / HC:{p?.handicap ?? 0}
        </div>
      </div>
    </div>
  );
}

export default function AdminTournamentFinalsClient({ tournamentId }: { tournamentId: string }) {
  const router = useRouter();

  // ✅ Supabase（このファイル内だけ型推論崩れ対策）
  const supabase = useMemo(() => createClient(), []);
  const db: any = supabase;

  const [authz, setAuthz] = useState<'checking' | 'ok' | 'no'>('checking');

  const [bracket, setBracket] = useState<FinalBracket | null>(null);
  const [entries, setEntries] = useState<FinalRoundEntry[]>([]);
  const [matches, setMatches] = useState<FinalMatchRow[]>([]);
  const [players, setPlayers] = useState<Record<string, Player>>({});

  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 20秒で “詰まった” 判定（UIは維持したまま復帰導線だけ追加）
  const loadingTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!loading) {
      if (loadingTimer.current) window.clearTimeout(loadingTimer.current);
      loadingTimer.current = null;
      return;
    }
    if (loadingTimer.current) window.clearTimeout(loadingTimer.current);
    loadingTimer.current = window.setTimeout(() => {
      setError('読み込みがタイムアウトしました。ネットワーク/権限/RLS を確認して再読み込みしてください。');
      setLoading(false);
    }, 20000);

    return () => {
      if (loadingTimer.current) window.clearTimeout(loadingTimer.current);
      loadingTimer.current = null;
    };
  }, [loading]);

  // ===== Admin check（既存運用踏襲）=====
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const r = await fetch('/auth/whoami', { cache: 'no-store' });
        const j = r.ok ? await r.json() : { authenticated: false };
        if (!j?.authenticated) {
          router.replace(`/login?redirect=/admin/tournaments/${tournamentId}/finals`);
          return;
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace(`/login?redirect=/admin/tournaments/${tournamentId}/finals`);
          return;
        }

        const [adminResp, playerResp] = await Promise.all([
          db.from('app_admins').select('user_id').eq('user_id', user.id).maybeSingle(),
          db.from('players').select('is_admin').eq('id', user.id).maybeSingle(),
        ]);

        const isAdmin = Boolean(adminResp?.data?.user_id) || playerResp?.data?.is_admin === true;

        if (cancelled) return;
        setAuthz(isAdmin ? 'ok' : 'no');
      } catch (e) {
        console.error('[admin/finals] auth check error:', e);
        if (!cancelled) setAuthz('no');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, supabase, tournamentId, db]);

  // ✅ authz OK になった“後”に確実にロード（呼び損ね防止）
  useEffect(() => {
    if (authz !== 'ok') return;
    if (!tournamentId) return;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authz, tournamentId]);

  const entryMap = useMemo(() => {
    const map = new Map<string, FinalRoundEntry>();
    entries.forEach((e) => map.set(`${e.round_no}:${e.slot_no}`, e));
    return map;
  }, [entries]);

  const matchMap = useMemo(() => {
    const map = new Map<string, FinalMatchRow>();
    const byRound = new Map<number, FinalMatchRow[]>();

    matches.forEach((m) => {
      const r = Number(m.round_no ?? 0);
      if (!r) return;
      if (!byRound.has(r)) byRound.set(r, []);
      byRound.get(r)!.push(m);
    });

    // ✅ ES5 target 対策：MapIterator を for..of で回さない（downlevelIteration不要）
    byRound.forEach((list, r) => {
      const sorted = [...list].sort((a, b) => {
        const aNo = Number(a.match_no ?? a.match_index ?? 0);
        const bNo = Number(b.match_no ?? b.match_index ?? 0);
        if (aNo && bNo && aNo !== bNo) return aNo - bNo;
        return String(a.id).localeCompare(String(b.id));
      });
      sorted.forEach((m, i) => {
        const no = Number(m.match_no ?? m.match_index ?? 0) || i + 1;
        map.set(`${r}:${no}`, m);
      });
    });

    return map;
  }, [matches]);

  // 入力状態（R1=2試合、R2=1試合）
  const [r1Reason, setR1Reason] = useState<Record<number, string>>({ 1: 'normal', 2: 'normal' });
  const [r1Winner, setR1Winner] = useState<Record<number, string>>({ 1: '', 2: '' });
  const [r1WScore, setR1WScore] = useState<Record<number, string>>({ 1: '15', 2: '15' });
  const [r1LScore, setR1LScore] = useState<Record<number, string>>({ 1: '0', 2: '0' });

  const [r2Reason, setR2Reason] = useState<string>('normal');
  const [r2SetA, setR2SetA] = useState<{ s1: string; s2: string; s3: string }>({ s1: '', s2: '', s3: '' });
  const [r2SetB, setR2SetB] = useState<{ s1: string; s2: string; s3: string }>({ s1: '', s2: '', s3: '' });

  const loadAll = async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('[admin/finals] loadAll start', { tournamentId });

      const { data: bRows, error: bErr } = await db
        .from('final_brackets')
        .select('*')
        .eq('tournament_id', tournamentId)
        .order('created_at', { ascending: false });

      if (bErr) throw bErr;
      if (!bRows || bRows.length === 0) {
        setError('決勝トーナメントが見つかりませんでした');
        return;
      }

      const b = bRows[0] as FinalBracket;
      setBracket(b);
      console.log('[admin/finals] bracket ok', b.id);

      const { data: eRows, error: eErr } = await db
        .from('final_round_entries')
        .select('id,bracket_id,round_no,slot_no,player_id')
        .eq('bracket_id', b.id)
        .order('round_no', { ascending: true })
        .order('slot_no', { ascending: true });

      if (eErr) throw eErr;
      const es = (eRows ?? []) as FinalRoundEntry[];
      setEntries(es);
      console.log('[admin/finals] entries ok', es.length);

      // matches は order が通らない環境を考慮してフォールバック
      const base = db.from('final_matches').select('*').eq('bracket_id', b.id);
      const { data: m1, error: mErr1 } = await base.order('round_no', { ascending: true });

      let ms: FinalMatchRow[] = [];
      if (!mErr1) {
        ms = (m1 ?? []) as FinalMatchRow[];
      } else {
        console.warn('[admin/finals] matches order failed -> fallback', mErr1);
        const { data: m2, error: mErr2 } = await db.from('final_matches').select('*').eq('bracket_id', b.id);
        if (mErr2) throw mErr2;
        ms = (m2 ?? []) as FinalMatchRow[];
      }
      setMatches(ms);
      console.log('[admin/finals] matches ok', ms.length);

      const ids = Array.from(new Set(es.map((x) => x.player_id).filter((x): x is string => !!x)));
      if (ids.length) {
        const { data: pRows, error: pErr } = await db
          .from('players')
          .select('id,handle_name,avatar_url,ranking_points,handicap')
          .in('id', ids);
        if (pErr) throw pErr;

        const dict: Record<string, Player> = {};
        (pRows ?? []).forEach((p: any) => (dict[String(p.id)] = p as Player));
        setPlayers(dict);
      } else {
        setPlayers({});
      }
      console.log('[admin/finals] players ok');

      // 入力欄へ反映（既存分）
      [1, 2].forEach((no) => {
        const m =
          ms.find((x) => Number(x.round_no) === 1 && Number(x.match_no ?? x.match_index ?? 0) === no) || null;
        if (!m) return;

        setR1Reason((prev) => ({ ...prev, [no]: normalizeReason(m) }));
        if (m.winner_id) setR1Winner((prev) => ({ ...prev, [no]: String(m.winner_id) }));
        if (m.winner_score != null) setR1WScore((prev) => ({ ...prev, [no]: String(m.winner_score) }));
        if (m.loser_score != null) setR1LScore((prev) => ({ ...prev, [no]: String(m.loser_score) }));
      });

      const mFinal =
        ms.find((x) => Number(x.round_no) === 2 && Number(x.match_no ?? x.match_index ?? 0) === 1) || null;
      if (mFinal) setR2Reason(normalizeReason(mFinal));
    } catch (e: any) {
      console.error('[admin/finals] loadAll error:', e);
      setError(`決勝トーナメントの取得に失敗しました: ${e?.message || 'unknown error'}`);
    } finally {
      // ✅ ここが重要：詰まらず必ず解除
      setLoading(false);
    }
  };

  const getPair = (roundNo: number, matchNo: number) => {
    const slotA = matchNo * 2 - 1;
    const slotB = matchNo * 2;
    const pidA = entryMap.get(`${roundNo}:${slotA}`)?.player_id ?? null;
    const pidB = entryMap.get(`${roundNo}:${slotB}`)?.player_id ?? null;
    return { pidA, pidB };
  };

  // ✅ end_reason / finish_reason のどちらでも動く upsert（最小）
  const upsertMatchSafe = async (row: {
    bracket_id: string;
    round_no: number;
    match_no: number;
    winner_id: string | null;
    loser_id: string | null;
    winner_score: number | null;
    loser_score: number | null;
    end_reason?: string | null;
  }) => {
    const reason = String(row.end_reason ?? 'normal');

    const payloadEnd: any = {
      bracket_id: row.bracket_id,
      round_no: row.round_no,
      match_no: row.match_no,
      winner_id: row.winner_id,
      loser_id: row.loser_id,
      winner_score: row.winner_score,
      loser_score: row.loser_score,
      end_reason: reason,
    };

    const payloadFinish: any = {
      bracket_id: row.bracket_id,
      round_no: row.round_no,
      match_no: row.match_no,
      winner_id: row.winner_id,
      loser_id: row.loser_id,
      winner_score: row.winner_score,
      loser_score: row.loser_score,
      finish_reason: reason,
    };

    const { data: found, error: fErr } = await db
      .from('final_matches')
      .select('id')
      .eq('bracket_id', row.bracket_id)
      .eq('round_no', row.round_no)
      .eq('match_no', row.match_no)
      .maybeSingle();
    if (fErr) throw fErr;

    if (found?.id) {
      // update
      const tryUpdate = async (payload: any) => {
        const { error } = await db.from('final_matches').update(payload).eq('id', found.id);
        if (error) throw error;
      };

      try {
        await tryUpdate(payloadEnd);
      } catch (e: any) {
        if (isMissingColumnError(e)) {
          await tryUpdate(payloadFinish);
        } else {
          throw e;
        }
      }
      return String(found.id);
    } else {
      // insert
      const tryInsert = async (payload: any) => {
        const { data: ins, error } = await db.from('final_matches').insert(payload).select('id').single();
        if (error) throw error;
        return String(ins?.id);
      };

      try {
        return await tryInsert(payloadEnd);
      } catch (e: any) {
        if (isMissingColumnError(e)) return await tryInsert(payloadFinish);
        throw e;
      }
    }
  };

  const saveR1 = async (matchNo: number) => {
    if (!bracket) return;
    const { pidA, pidB } = getPair(1, matchNo);
    if (!pidA || !pidB) return alert('R1の参加者が未設定です。');

    const winnerId = String(r1Winner[matchNo] || '').trim();
    if (!winnerId) return alert('勝者を選択してください。');
    if (winnerId !== pidA && winnerId !== pidB) return alert('勝者が不正です。');

    const loserId = winnerId === pidA ? pidB : pidA;

    const w = toInt(r1WScore[matchNo]);
    const l = toInt(r1LScore[matchNo]);
    if (w == null || l == null) return alert('スコアが不正です。');

    setSavingKey(`r1:${matchNo}`);
    try {
      await upsertMatchSafe({
        bracket_id: bracket.id,
        round_no: 1,
        match_no: matchNo,
        winner_id: winnerId,
        loser_id: loserId,
        winner_score: w,
        loser_score: l,
        end_reason: r1Reason[matchNo] || 'normal',
      });
      await loadAll();
    } catch (e: any) {
      console.error('[admin/finals] saveR1 error:', e);
      alert(`保存に失敗しました: ${e?.message || 'unknown error'}`);
    } finally {
      setSavingKey(null);
    }
  };

  const computeBestOf3 = () => {
    const a = [toInt(r2SetA.s1), toInt(r2SetA.s2), toInt(r2SetA.s3)];
    const b = [toInt(r2SetB.s1), toInt(r2SetB.s2), toInt(r2SetB.s3)];
    let wonA = 0;
    let wonB = 0;
    for (let i = 0; i < 3; i++) {
      const av = a[i];
      const bv = b[i];
      if (av == null || bv == null) continue;
      if (av === bv) continue;
      if (av > bv) wonA++;
      else wonB++;
    }
    return { wonA, wonB };
  };

  const saveR2Final = async () => {
    if (!bracket) return;
    const { pidA, pidB } = getPair(2, 1);
    if (!pidA || !pidB) return alert('R2の参加者が未設定です。');

    const { wonA, wonB } = computeBestOf3();
    if (wonA === wonB) return alert('勝敗が確定していません（セット入力を確認してください）。');
    if (wonA < 2 && wonB < 2) return alert('best of 3 なので 2セット先取が必要です。');

    const winnerId = wonA > wonB ? pidA : pidB;
    const loserId = winnerId === pidA ? pidB : pidA;

    setSavingKey('r2:1');
    try {
      await upsertMatchSafe({
        bracket_id: bracket.id,
        round_no: 2,
        match_no: 1,
        winner_id: winnerId,
        loser_id: loserId,
        winner_score: Math.max(wonA, wonB),
        loser_score: Math.min(wonA, wonB),
        end_reason: r2Reason || 'normal',
      });
      await loadAll();
    } catch (e: any) {
      console.error('[admin/finals] saveR2 error:', e);
      alert(`保存に失敗しました: ${e?.message || 'unknown error'}`);
    } finally {
      setSavingKey(null);
    }
  };

  if (authz === 'checking') {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex items-center justify-center text-white">
        認証を確認しています...
      </div>
    );
  }
  if (authz === 'no') {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex items-center justify-center text-white">
        アクセス権限がありません
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-purple-200">ADMIN</div>
            <h1 className="text-2xl font-bold">決勝トーナメント管理</h1>
            <div className="text-xs text-gray-300 mt-1">R1は通常1試合 / 決勝(R2)は best_of_3（2セット先取）</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadAll}
              className="px-3 py-2 rounded-xl border border-purple-500/40 hover:bg-purple-900/20 text-sm"
            >
              再読み込み
            </button>
            <Link
              href={`/admin/tournaments`}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-purple-500/40 hover:bg-purple-900/20 text-sm"
            >
              <FaArrowLeft />
              大会管理へ
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-gray-300">読み込み中...</div>
        ) : error ? (
          <div className="text-sm text-red-300">{error}</div>
        ) : !bracket ? (
          <div className="text-sm text-gray-300">決勝トーナメントが見つかりません。</div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-2xl border border-purple-500/30 bg-gray-900/60 p-5">
              <div className="text-xs text-purple-200">BRACKET</div>
              <div className="text-xl font-bold mt-1">{bracket.title ?? '決勝トーナメント'}</div>
              <div className="text-xs text-gray-400 mt-2">
                表示ページ：{' '}
                <Link className="underline text-blue-300" href={`/tournaments/${tournamentId}/finals`} target="_blank">
                  /tournaments/{tournamentId}/finals
                </Link>
              </div>
            </div>

            {/* R1 */}
            <div className="rounded-2xl border border-white/15 bg-white/5 p-5 space-y-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-xs text-gray-300">ROUND</div>
                  <div className="text-lg font-bold">R1</div>
                </div>
                <div className="text-xs text-gray-400">2試合（R1-1 / R1-2）</div>
              </div>

              {[1, 2].map((matchNo) => {
                const { pidA, pidB } = getPair(1, matchNo);
                const pA = pidA ? players[pidA] : undefined;
                const pB = pidB ? players[pidB] : undefined;

                const cur = matchMap.get(`1:${matchNo}`) || null;

                return (
                  <div key={`r1-${matchNo}`} className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
                    <div className="text-sm font-semibold">R1-{matchNo}</div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
                        <div className="text-xs text-gray-300">現状</div>
                        <div className="space-y-2">
                          <PlayerCardMini p={pA} />
                          <PlayerCardMini p={pB} />
                        </div>
                        <div className="text-[11px] text-gray-400 mt-2">
                          登録済: {cur?.winner_id ? 'はい' : 'いいえ'} / 種別: {reasonLabel(normalizeReason(cur))}
                        </div>
                      </div>

                      <div className="md:col-span-2 rounded-xl border border-white/10 bg-black/20 p-3 space-y-3">
                        <div className="text-xs text-gray-300">結果入力</div>

                        <div className="flex flex-wrap gap-2 items-center">
                          <select
                            value={r1Reason[matchNo] || 'normal'}
                            onChange={(e) => setR1Reason((prev) => ({ ...prev, [matchNo]: e.target.value }))}
                            className="text-sm rounded-lg bg-black/40 border border-white/15 px-3 py-2"
                          >
                            <option value="normal">通常</option>
                            <option value="time_limit">時間切れ</option>
                            <option value="forfeit">棄権/不戦</option>
                          </select>

                          <select
                            value={r1Winner[matchNo] || ''}
                            onChange={(e) => setR1Winner((prev) => ({ ...prev, [matchNo]: e.target.value }))}
                            className="text-sm rounded-lg bg-black/40 border border-white/15 px-3 py-2 min-w-[220px]"
                          >
                            <option value="">勝者を選択</option>
                            {pidA ? <option value={pidA}>{players[pidA]?.handle_name ?? 'playerA'}</option> : null}
                            {pidB ? <option value={pidB}>{players[pidB]?.handle_name ?? 'playerB'}</option> : null}
                          </select>

                          <div className="flex items-center gap-2">
                            <div className="text-xs text-gray-300">勝者</div>
                            <input
                              value={r1WScore[matchNo] || ''}
                              onChange={(e) => setR1WScore((prev) => ({ ...prev, [matchNo]: e.target.value }))}
                              className="w-20 text-sm rounded-lg bg-black/40 border border-white/15 px-3 py-2"
                              inputMode="numeric"
                            />
                            <div className="text-xs text-gray-300">敗者</div>
                            <input
                              value={r1LScore[matchNo] || ''}
                              onChange={(e) => setR1LScore((prev) => ({ ...prev, [matchNo]: e.target.value }))}
                              className="w-20 text-sm rounded-lg bg-black/40 border border-white/15 px-3 py-2"
                              inputMode="numeric"
                            />
                          </div>

                          <button
                            onClick={() => saveR1(matchNo)}
                            disabled={savingKey === `r1:${matchNo}` || !pidA || !pidB}
                            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50"
                          >
                            <FaSave />
                            {savingKey === `r1:${matchNo}` ? '保存中...' : cur?.winner_id ? '更新' : '保存'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* R2 */}
            <div className="rounded-2xl border border-white/15 bg-white/5 p-5 space-y-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-xs text-gray-300">ROUND</div>
                  <div className="text-lg font-bold">R2（決勝）</div>
                </div>
                <div className="text-xs text-gray-400">best_of_3（2セット先取）</div>
              </div>

              {(() => {
                const { pidA, pidB } = getPair(2, 1);
                const pA = pidA ? players[pidA] : undefined;
                const pB = pidB ? players[pidB] : undefined;

                const cur = matchMap.get(`2:1`) || null;

                const { wonA, wonB } = computeBestOf3();

                return (
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-4">
                    <div className="text-sm font-semibold">R2-1（決勝）</div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
                        <div className="text-xs text-gray-300">現状</div>
                        <div className="space-y-2">
                          <PlayerCardMini p={pA} />
                          <PlayerCardMini p={pB} />
                        </div>
                        <div className="text-[11px] text-gray-400 mt-2">
                          登録済: {cur?.winner_id ? 'はい' : 'いいえ'} / 種別: {reasonLabel(normalizeReason(cur))}
                        </div>
                      </div>

                      <div className="md:col-span-2 rounded-xl border border-white/10 bg-black/20 p-3 space-y-3">
                        <div className="text-xs text-gray-300">結果入力</div>

                        <div className="flex flex-wrap gap-2 items-center">
                          <div className="text-xs text-gray-300">種別</div>
                          <select
                            value={r2Reason}
                            onChange={(e) => setR2Reason(e.target.value)}
                            className="text-sm rounded-lg bg-black/40 border border-white/15 px-3 py-2"
                          >
                            <option value="normal">通常</option>
                            <option value="time_limit">時間切れ</option>
                            <option value="forfeit">棄権/不戦</option>
                          </select>

                          <div className="ml-auto text-xs text-gray-300">
                            セット勝利：A {wonA} - {wonB} B
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {[
                            { key: 's1', label: 'Set1' },
                            { key: 's2', label: 'Set2' },
                            { key: 's3', label: 'Set3' },
                          ].map((s) => (
                            <div key={s.key} className="rounded-xl border border-white/10 bg-black/20 p-3">
                              <div className="text-xs text-gray-300 mb-2">{s.label}</div>
                              <div className="flex items-center gap-2">
                                <input
                                  value={(r2SetA as any)[s.key]}
                                  onChange={(e) => setR2SetA((prev) => ({ ...prev, [s.key]: e.target.value }))}
                                  className="w-full text-sm rounded-lg bg-black/40 border border-white/15 px-3 py-2"
                                  inputMode="numeric"
                                  placeholder="A"
                                />
                                <div className="text-gray-400">-</div>
                                <input
                                  value={(r2SetB as any)[s.key]}
                                  onChange={(e) => setR2SetB((prev) => ({ ...prev, [s.key]: e.target.value }))}
                                  className="w-full text-sm rounded-lg bg-black/40 border border-white/15 px-3 py-2"
                                  inputMode="numeric"
                                  placeholder="B"
                                />
                              </div>
                            </div>
                          ))}
                        </div>

                        <button
                          onClick={saveR2Final}
                          disabled={savingKey === 'r2:1' || !pidA || !pidB}
                          className="w-full md:w-auto md:ml-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50"
                        >
                          <FaSave />
                          {savingKey === 'r2:1' ? '保存中...' : cur?.winner_id ? '更新' : '保存'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
