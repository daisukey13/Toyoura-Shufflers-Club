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

type SeriesMode = '2-0' | '2-1';
type BaseReason = 'normal' | 'time_limit' | 'forfeit';

const toInt = (v: any): number | null => {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
};

// ===== reason encode/decode（DBスキーマ変更なしで adv 情報を保持）=====
// 例: adv_def:<DEF勝ち上がりplayerId>|normal
const ADV_PREFIX = 'adv_def:';

const normalizeReason = (m: { finish_reason?: any; end_reason?: any } | null | undefined) =>
  String(m?.finish_reason ?? m?.end_reason ?? 'normal').trim().toLowerCase();

const decodeReason = (rawReason: string): { base: BaseReason; advDefPlayerId: string | null } => {
  const r = String(rawReason || 'normal').trim().toLowerCase();
  if (r.startsWith(ADV_PREFIX)) {
    const rest = r.slice(ADV_PREFIX.length);
    const [idPart, basePart] = rest.split('|');
    const advId = String(idPart || '').trim() || null;
    const base = (String(basePart || 'normal').trim().toLowerCase() as BaseReason) || 'normal';
    const safeBase: BaseReason =
      base === 'normal' || base === 'time_limit' || base === 'forfeit' ? base : 'normal';
    return { base: safeBase, advDefPlayerId: advId };
  }
  const base = (r as BaseReason) || 'normal';
  const safeBase: BaseReason =
    base === 'normal' || base === 'time_limit' || base === 'forfeit' ? base : 'normal';
  return { base: safeBase, advDefPlayerId: null };
};

const encodeReason = (base: BaseReason, advDefPlayerId: string | null) => {
  const b: BaseReason =
    base === 'normal' || base === 'time_limit' || base === 'forfeit' ? base : 'normal';
  const id = String(advDefPlayerId || '').trim();
  if (!id) return b;
  return `${ADV_PREFIX}${id}|${b}`;
};

const baseReasonLabel = (r: BaseReason) => {
  const v = String(r || 'normal').toLowerCase();
  if (v === 'normal') return '通常';
  if (v === 'time_limit') return '時間切れ';
  if (v === 'forfeit') return '棄権/不戦';
  return v;
};

const reasonLabel = (raw: string) => {
  const { base, advDefPlayerId } = decodeReason(String(raw || 'normal'));
  if (advDefPlayerId) return `アド(予選DEF)/${baseReasonLabel(base)}`;
  return baseReasonLabel(base);
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

// key helpers
const advKey = (roundNo: number, matchNo: number) => `${roundNo}:${matchNo}`;

// ✅ 安全化：advDefPlayerId が対戦ペア以外なら無効扱い
const sanitizeAdvDefId = (pidA: string | null, pidB: string | null, advDefPlayerId: string | null) => {
  const id = String(advDefPlayerId || '').trim();
  if (!id || !pidA || !pidB) return null;
  if (id !== pidA && id !== pidB) return null;
  return id;
};

// adv計算：advDefPlayerId（予選DEF勝ち上がり）に対して、相手（通常側）が1勝アド（第1試合DEF勝ち固定）
const computeAdvNormalId = (pidA: string, pidB: string, advDefPlayerId: string | null) => {
  if (!advDefPlayerId) return null;
  if (pidA === advDefPlayerId) return pidB;
  if (pidB === advDefPlayerId) return pidA;
  return null;
};

// 3試合表示用（勝者手動選択に合わせて「どう並ぶか」を表示するだけ）
function computeSeriesWithAdv(opts: {
  pidA: string;
  pidB: string;
  winnerId: string;
  advNormalId: string | null; // 通常側（第1試合 DEF 勝ち固定）
  mode: SeriesMode;
}) {
  const otherId = opts.winnerId === opts.pidA ? opts.pidB : opts.pidA;

  if (!opts.advNormalId) {
    // 通常 best-of-3 の並び（表示用）
    const w = 2;
    const l = opts.mode === '2-1' ? 1 : 0;
    return {
      winner_score: w,
      loser_score: l,
      games: [
        { label: '第1試合', winner: opts.winnerId, note: '' },
        { label: '第2試合', winner: opts.winnerId, note: '' },
        {
          label: '第3試合',
          winner: opts.mode === '2-1' ? otherId : null,
          note: opts.mode === '2-0' ? '未実施' : '',
        },
      ],
    };
  }

  // アドあり：第1試合は advNormalId の DEF勝ち固定
  if (opts.winnerId === opts.advNormalId) {
    // 通常側が勝つ：2-0 or 2-1
    const w = 2;
    const l = opts.mode === '2-1' ? 1 : 0;

    const defSide = otherId; // 通常側の相手（予選DEF勝ち上がり側）
    const game2Winner = opts.mode === '2-0' ? opts.advNormalId : defSide;
    const game3Winner = opts.mode === '2-0' ? null : opts.advNormalId;

    return {
      winner_score: w,
      loser_score: l,
      games: [
        { label: '第1試合', winner: opts.advNormalId, note: 'DEF（アドバンテージ）' },
        { label: '第2試合', winner: game2Winner, note: '' },
        { label: '第3試合', winner: game3Winner, note: game3Winner ? '' : '未実施' },
      ],
    };
  } else {
    // 予選DEF勝ち上がり側が勝つ：残り2試合を両方勝つ必要 → 常に 2-1
    return {
      winner_score: 2,
      loser_score: 1,
      games: [
        { label: '第1試合', winner: opts.advNormalId, note: 'DEF（アドバンテージ）' },
        { label: '第2試合', winner: opts.winnerId, note: '' },
        { label: '第3試合', winner: opts.winnerId, note: '' },
      ],
    };
  }
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

  // ✅ 予選DEF勝ち上がりプレイヤーID（round:match → playerId）
  const [advDefMap, setAdvDefMap] = useState<Record<string, string>>({});
  // ✅ best-of-3 の 2-0 / 2-1（round:match → mode）
  const [seriesModeMap, setSeriesModeMap] = useState<Record<string, SeriesMode>>({});

  // 入力状態（R1=2試合、R2=1試合）
  const [r1Reason, setR1Reason] = useState<Record<number, BaseReason>>({ 1: 'normal', 2: 'normal' });
  const [r1Winner, setR1Winner] = useState<Record<number, string>>({ 1: '', 2: '' });
  const [r1WScore, setR1WScore] = useState<Record<number, string>>({ 1: '15', 2: '15' });
  const [r1LScore, setR1LScore] = useState<Record<number, string>>({ 1: '0', 2: '0' });

  const [r2Reason, setR2Reason] = useState<BaseReason>('normal');
  const [r2Winner, setR2Winner] = useState<string>(''); // ✅ 勝者は手動選択
  const [r2SetA, setR2SetA] = useState<{ s1: string; s2: string; s3: string }>({ s1: '', s2: '', s3: '' });
  const [r2SetB, setR2SetB] = useState<{ s1: string; s2: string; s3: string }>({ s1: '', s2: '', s3: '' });

  const playerName = (id: string | null | undefined) => {
    if (!id) return '—';
    return players[id]?.handle_name ?? id.slice(0, 8);
  };

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

  const getPair = (roundNo: number, matchNo: number) => {
    const slotA = matchNo * 2 - 1;
    const slotB = matchNo * 2;
    const pidA = entryMap.get(`${roundNo}:${slotA}`)?.player_id ?? null;
    const pidB = entryMap.get(`${roundNo}:${slotB}`)?.player_id ?? null;
    return { pidA, pidB };
  };

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
        setBracket(null);
        setEntries([]);
        setMatches([]);
        setPlayers({});
        setAdvDefMap({});
        setSeriesModeMap({});
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

      // ===== 入力欄へ反映（既存分）=====
      const nextAdv: Record<string, string> = {};
      const nextSeries: Record<string, SeriesMode> = {};

      const nextR1Reason: Record<number, BaseReason> = { 1: 'normal', 2: 'normal' };
      const nextR1Winner: Record<number, string> = { 1: '', 2: '' };
      const nextR1WScore: Record<number, string> = { 1: '15', 2: '15' };
      const nextR1LScore: Record<number, string> = { 1: '0', 2: '0' };

      let nextR2Reason: BaseReason = 'normal';
      let nextR2Winner = '';

      // R1-1 / R1-2
      [1, 2].forEach((no) => {
        const m = ms.find((x) => Number(x.round_no) === 1 && Number(x.match_no ?? x.match_index ?? 0) === no) || null;
        if (!m) return;

        const dec = decodeReason(normalizeReason(m));
        nextR1Reason[no] = dec.base;

        if (dec.advDefPlayerId) nextAdv[advKey(1, no)] = dec.advDefPlayerId;

        if (m.winner_id) nextR1Winner[no] = String(m.winner_id);
        if (m.winner_score != null) nextR1WScore[no] = String(m.winner_score);
        if (m.loser_score != null) nextR1LScore[no] = String(m.loser_score);

        // ✅ mode復元（R1でシリーズ化してるケース用）
        const ws = Number(m.winner_score ?? 0);
        const ls = Number(m.loser_score ?? 0);
        if ((ws === 2 && ls === 1) || (ws === 1 && ls === 2)) nextSeries[advKey(1, no)] = '2-1';
        if ((ws === 2 && ls === 0) || (ws === 0 && ls === 2)) nextSeries[advKey(1, no)] = '2-0';
      });

      // R2-1（決勝）
      const mFinal = ms.find((x) => Number(x.round_no) === 2 && Number(x.match_no ?? x.match_index ?? 0) === 1) || null;
      if (mFinal) {
        const dec = decodeReason(normalizeReason(mFinal));
        nextR2Reason = dec.base;
        if (dec.advDefPlayerId) nextAdv[advKey(2, 1)] = dec.advDefPlayerId;
        if (mFinal.winner_id) nextR2Winner = String(mFinal.winner_id);

        // ✅ mode復元（adv有無に関わらず、2-0/2-1が入ってるなら復元）
        const ws = Number(mFinal.winner_score ?? 0);
        const ls = Number(mFinal.loser_score ?? 0);
        if ((ws === 2 && ls === 1) || (ws === 1 && ls === 2)) nextSeries[advKey(2, 1)] = '2-1';
        if ((ws === 2 && ls === 0) || (ws === 0 && ls === 2)) nextSeries[advKey(2, 1)] = '2-0';
      }

      setAdvDefMap(nextAdv);
      setSeriesModeMap(nextSeries);

      setR1Reason(nextR1Reason);
      setR1Winner(nextR1Winner);
      setR1WScore(nextR1WScore);
      setR1LScore(nextR1LScore);

      setR2Reason(nextR2Reason);
      setR2Winner(nextR2Winner);
    } catch (e: any) {
      console.error('[admin/finals] loadAll error:', e);
      setError(`決勝トーナメントの取得に失敗しました: ${e?.message || 'unknown error'}`);
    } finally {
      setLoading(false);
    }
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

    const key = advKey(1, matchNo);
    const rawAdv = String(advDefMap[key] || '').trim() || null;
    const advDefPlayerId = sanitizeAdvDefId(pidA, pidB, rawAdv);
    const advNormalId = computeAdvNormalId(pidA, pidB, advDefPlayerId);

    const baseR: BaseReason = r1Reason[matchNo] || 'normal';
    const encoded = encodeReason(baseR, advDefPlayerId);

    let winner_score: number | null = null;
    let loser_score: number | null = null;

    if (advNormalId) {
      const rawMode = seriesModeMap[key] ?? '2-0';
      const mode: SeriesMode = winnerId === advNormalId ? rawMode : '2-1';
      const s = computeSeriesWithAdv({ pidA, pidB, winnerId, advNormalId, mode });
      winner_score = s.winner_score;
      loser_score = s.loser_score;
    } else {
      // 従来通り（1試合スコア）
      const w = toInt(r1WScore[matchNo]);
      const l = toInt(r1LScore[matchNo]);
      if (w == null || l == null) return alert('スコアが不正です。');
      winner_score = w;
      loser_score = l;
    }

    setSavingKey(`r1:${matchNo}`);
    try {
      await upsertMatchSafe({
        bracket_id: bracket.id,
        round_no: 1,
        match_no: matchNo,
        winner_id: winnerId,
        loser_id: loserId,
        winner_score,
        loser_score,
        end_reason: encoded,
      });
      await loadAll();
    } catch (e: any) {
      console.error('[admin/finals] saveR1 error:', e);
      alert(`保存に失敗しました: ${e?.message || 'unknown error'}`);
    } finally {
      setSavingKey(null);
    }
  };

  // R2（表示用：セット勝利数）
  const computeBestOf3Wins = (pidA: string, pidB: string) => {
    const rawAdv = String(advDefMap[advKey(2, 1)] || '').trim() || null;
    const advDefPlayerId = sanitizeAdvDefId(pidA, pidB, rawAdv);
    const advNormalId = computeAdvNormalId(pidA, pidB, advDefPlayerId);

    const a = [toInt(r2SetA.s1), toInt(r2SetA.s2), toInt(r2SetA.s3)];
    const b = [toInt(r2SetB.s1), toInt(r2SetB.s2), toInt(r2SetB.s3)];

    let wonA = 0;
    let wonB = 0;

    // アドがある場合：第1試合は通常側のDEF勝ち固定（セット入力が空でもカウント）
    if (advNormalId) {
      if (advNormalId === pidA) wonA += 1;
      else if (advNormalId === pidB) wonB += 1;
    } else {
      // 通常の場合のみ Set1 を入力で判定
      const av = a[0];
      const bv = b[0];
      if (av != null && bv != null && av !== bv) {
        if (av > bv) wonA++;
        else wonB++;
      }
    }

    // Set2/3 は入力で判定
    for (let i = 1; i < 3; i++) {
      const av = a[i];
      const bv = b[i];
      if (av == null || bv == null) continue;
      if (av === bv) continue;
      if (av > bv) wonA++;
      else wonB++;
    }

    return { wonA, wonB, advDefPlayerId, advNormalId };
  };

  const saveR2Final = async () => {
    if (!bracket) return;
    const { pidA, pidB } = getPair(2, 1);
    if (!pidA || !pidB) return alert('R2の参加者が未設定です。');

    const winnerId = String(r2Winner || '').trim();
    if (!winnerId) return alert('勝者を選択してください。');
    if (winnerId !== pidA && winnerId !== pidB) return alert('勝者が不正です。');

    const loserId = winnerId === pidA ? pidB : pidA;

    const key = advKey(2, 1);
    const rawAdv = String(advDefMap[key] || '').trim() || null;
    const advDefPlayerId = sanitizeAdvDefId(pidA, pidB, rawAdv);
    const advNormalId = computeAdvNormalId(pidA, pidB, advDefPlayerId);

    const baseR: BaseReason = r2Reason || 'normal';
    const encoded = encodeReason(baseR, advDefPlayerId);

    // 最終スコア（2-0 / 2-1）は「勝者手動 + ルール」で整形
    let mode: SeriesMode = seriesModeMap[key] ?? '2-0';
    if (advNormalId) {
      mode = winnerId === advNormalId ? mode : '2-1'; // 予選DEF側が勝つなら必ず2-1
    }

    const s = computeSeriesWithAdv({
      pidA,
      pidB,
      winnerId,
      advNormalId,
      mode,
    });

    setSavingKey('r2:1');
    try {
      await upsertMatchSafe({
        bracket_id: bracket.id,
        round_no: 2,
        match_no: 1,
        winner_id: winnerId,
        loser_id: loserId,
        winner_score: s.winner_score,
        loser_score: s.loser_score,
        end_reason: encoded,
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
            <div className="text-xs text-gray-300 mt-1">R1は通常1試合 / 決勝(R2)は best_of_3（2勝先取）</div>
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

                const key = advKey(1, matchNo);
                const rawAdv = String(advDefMap[key] || '').trim() || null;
                const advDefPlayerId = sanitizeAdvDefId(pidA, pidB, rawAdv);
                const advNormalId = pidA && pidB ? computeAdvNormalId(pidA, pidB, advDefPlayerId) : null;

                const selectedWinnerId = String(r1Winner[matchNo] || '').trim();
                const rawMode = seriesModeMap[key] ?? '2-0';
                const mode: SeriesMode =
                  advNormalId && selectedWinnerId && selectedWinnerId !== advNormalId ? '2-1' : rawMode;

                const series =
                  pidA && pidB && selectedWinnerId
                    ? computeSeriesWithAdv({ pidA, pidB, winnerId: selectedWinnerId, advNormalId, mode })
                    : null;

                // ✅ 自動スコアは「adv + 勝者選択済」のときだけ
                const autoScore = Boolean(advNormalId && selectedWinnerId);
                const wScoreDisplay = autoScore ? String(series?.winner_score ?? '') : r1WScore[matchNo] || '';
                const lScoreDisplay = autoScore ? String(series?.loser_score ?? '') : r1LScore[matchNo] || '';

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
                          {/* 種別（通常/時間切れ/棄権） */}
                          <select
                            value={r1Reason[matchNo] || 'normal'}
                            onChange={(e) =>
                              setR1Reason((prev) => ({ ...prev, [matchNo]: e.target.value as BaseReason }))
                            }
                            className="text-sm rounded-lg bg-black/40 border border-white/15 px-3 py-2"
                          >
                            <option value="normal">通常</option>
                            <option value="time_limit">時間切れ</option>
                            <option value="forfeit">棄権/不戦</option>
                          </select>

                          {/* 予選DEF勝ち上がり指定（最小UI追加） */}
                          <select
                            value={advDefPlayerId ?? ''}
                            onChange={(e) => {
                              const v = String(e.target.value || '');
                              setAdvDefMap((p) => {
                                const next = { ...p };
                                if (!v) delete next[key];
                                else next[key] = v;
                                return next;
                              });
                            }}
                            className="text-sm rounded-lg bg-black/40 border border-white/15 px-3 py-2"
                            disabled={!pidA || !pidB}
                            title="予選でDEF勝ち上がりの選手を指定（該当しない場合は空）"
                          >
                            <option value="">予選DEF：なし</option>
                            {pidA ? (
                              <option value={pidA}>予選DEF：{players[pidA]?.handle_name ?? 'playerA'}</option>
                            ) : null}
                            {pidB ? (
                              <option value={pidB}>予選DEF：{players[pidB]?.handle_name ?? 'playerB'}</option>
                            ) : null}
                          </select>

                          {/* 勝者（手動） */}
                          <select
                            value={r1Winner[matchNo] || ''}
                            onChange={(e) => setR1Winner((prev) => ({ ...prev, [matchNo]: e.target.value }))}
                            className="text-sm rounded-lg bg-black/40 border border-white/15 px-3 py-2 min-w-[220px]"
                          >
                            <option value="">勝者を選択</option>
                            {pidA ? <option value={pidA}>{players[pidA]?.handle_name ?? 'playerA'}</option> : null}
                            {pidB ? <option value={pidB}>{players[pidB]?.handle_name ?? 'playerB'}</option> : null}
                          </select>

                          {/* スコア */}
                          <div className="flex items-center gap-2">
                            <div className="text-xs text-gray-300">勝者</div>
                            <input
                              value={wScoreDisplay}
                              onChange={(e) => {
                                if (autoScore) return;
                                setR1WScore((prev) => ({ ...prev, [matchNo]: e.target.value }));
                              }}
                              disabled={autoScore}
                              className="w-20 text-sm rounded-lg bg-black/40 border border-white/15 px-3 py-2 disabled:opacity-60"
                              inputMode="numeric"
                            />
                            <div className="text-xs text-gray-300">敗者</div>
                            <input
                              value={lScoreDisplay}
                              onChange={(e) => {
                                if (autoScore) return;
                                setR1LScore((prev) => ({ ...prev, [matchNo]: e.target.value }));
                              }}
                              disabled={autoScore}
                              className="w-20 text-sm rounded-lg bg-black/40 border border-white/15 px-3 py-2 disabled:opacity-60"
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

                        {/* アドあり：3試合表示 + 2-0/2-1選択（通常側が勝つ時のみ） */}
                        {advNormalId && pidA && pidB ? (
                          <div className="mt-1 rounded-xl border border-white/10 bg-black/10 p-3 text-xs">
                            <div className="text-yellow-200/90">
                              ※ 第1試合は <span className="font-semibold">{playerName(advNormalId)}</span> の DEF勝ち（1勝アド）
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <div className="text-gray-300">最終結果:</div>
                              <select
                                className="px-2 py-1 rounded bg-black/30 border border-white/10"
                                value={mode}
                                onChange={(e) => setSeriesModeMap((p) => ({ ...p, [key]: e.target.value as SeriesMode }))}
                                disabled={!!selectedWinnerId && selectedWinnerId !== advNormalId} // DEF側が勝者なら2-1固定
                              >
                                <option value="2-0">2-0</option>
                                <option value="2-1">2-1</option>
                              </select>
                              {selectedWinnerId && selectedWinnerId !== advNormalId ? (
                                <span className="text-gray-400">（予選DEF側が勝つ場合は 2-1 固定）</span>
                              ) : null}
                            </div>

                            {series ? (
                              <div className="mt-2 space-y-1 text-gray-200">
                                {series.games.map((g) => (
                                  <div key={g.label} className="flex items-center justify-between gap-2">
                                    <span className="text-gray-400">{g.label}</span>
                                    <span>
                                      {g.winner ? playerName(g.winner) : '—'}{' '}
                                      {g.note ? <span className="text-gray-400">({g.note})</span> : null}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="mt-2 text-gray-400">※ 勝者を選択すると、3試合の表示が出ます</div>
                            )}
                          </div>
                        ) : null}
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
                <div className="text-xs text-gray-400">best_of_3（2勝先取）</div>
              </div>

              {(() => {
                const { pidA, pidB } = getPair(2, 1);
                const pA = pidA ? players[pidA] : undefined;
                const pB = pidB ? players[pidB] : undefined;

                const cur = matchMap.get(`2:1`) || null;

                if (!pidA || !pidB) {
                  return (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-sm text-gray-300">R2の参加者が未設定です。</div>
                    </div>
                  );
                }

                const key = advKey(2, 1);
                const rawAdv = String(advDefMap[key] || '').trim() || null;
                const advDefPlayerId = sanitizeAdvDefId(pidA, pidB, rawAdv);
                const advNormalId = computeAdvNormalId(pidA, pidB, advDefPlayerId);

                const rawMode = seriesModeMap[key] ?? '2-0';
                const mode: SeriesMode = advNormalId && r2Winner && r2Winner !== advNormalId ? '2-1' : rawMode;

                const series = r2Winner
                  ? computeSeriesWithAdv({ pidA, pidB, winnerId: r2Winner, advNormalId, mode })
                  : null;

                const { wonA, wonB } = computeBestOf3Wins(pidA, pidB);

                // Set1 表示（アドありなら固定表示）
                const set1A = advNormalId ? (advNormalId === pidA ? '15' : '0') : r2SetA.s1;
                const set1B = advNormalId ? (advNormalId === pidB ? '15' : '0') : r2SetB.s1;

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
                            onChange={(e) => setR2Reason(e.target.value as BaseReason)}
                            className="text-sm rounded-lg bg-black/40 border border-white/15 px-3 py-2"
                          >
                            <option value="normal">通常</option>
                            <option value="time_limit">時間切れ</option>
                            <option value="forfeit">棄権/不戦</option>
                          </select>

                          {/* 予選DEF勝ち上がり指定 */}
                          <select
                            value={advDefPlayerId ?? ''}
                            onChange={(e) => {
                              const v = String(e.target.value || '');
                              setAdvDefMap((p) => {
                                const next = { ...p };
                                if (!v) delete next[key];
                                else next[key] = v;
                                return next;
                              });
                            }}
                            className="text-sm rounded-lg bg-black/40 border border-white/15 px-3 py-2"
                            title="予選でDEF勝ち上がりの選手を指定（該当しない場合は空）"
                          >
                            <option value="">予選DEF：なし</option>
                            <option value={pidA}>予選DEF：{playerName(pidA)}</option>
                            <option value={pidB}>予選DEF：{playerName(pidB)}</option>
                          </select>

                          {/* 勝者（手動） */}
                          <select
                            value={r2Winner}
                            onChange={(e) => setR2Winner(e.target.value)}
                            className="text-sm rounded-lg bg-black/40 border border-white/15 px-3 py-2 min-w-[220px]"
                          >
                            <option value="">勝者を選択</option>
                            <option value={pidA}>{playerName(pidA)}</option>
                            <option value={pidB}>{playerName(pidB)}</option>
                          </select>

                          <div className="ml-auto text-xs text-gray-300">
                            セット勝利（参考）：A {wonA} - {wonB} B
                          </div>
                        </div>

                        {/* アドあり：第1試合DEF固定 + 2-0/2-1選択 */}
                        {advNormalId ? (
                          <div className="rounded-xl border border-white/10 bg-black/10 p-3 text-xs">
                            <div className="text-yellow-200/90">
                              ※ 第1試合は <span className="font-semibold">{playerName(advNormalId)}</span> の DEF勝ち（1勝アド）
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <div className="text-gray-300">最終結果:</div>
                              <select
                                className="px-2 py-1 rounded bg-black/30 border border-white/10"
                                value={mode}
                                onChange={(e) => setSeriesModeMap((p) => ({ ...p, [key]: e.target.value as SeriesMode }))}
                                disabled={!!r2Winner && r2Winner !== advNormalId}
                              >
                                <option value="2-0">2-0</option>
                                <option value="2-1">2-1</option>
                              </select>
                              {r2Winner && r2Winner !== advNormalId ? (
                                <span className="text-gray-400">（予選DEF側が勝つ場合は 2-1 固定）</span>
                              ) : null}
                            </div>

                            {series ? (
                              <div className="mt-2 space-y-1 text-gray-200">
                                {series.games.map((g) => (
                                  <div key={g.label} className="flex items-center justify-between gap-2">
                                    <span className="text-gray-400">{g.label}</span>
                                    <span>
                                      {g.winner ? playerName(g.winner) : '—'}{' '}
                                      {g.note ? <span className="text-gray-400">({g.note})</span> : null}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="mt-2 text-gray-400">※ 勝者を選択すると、3試合の表示が出ます</div>
                            )}
                          </div>
                        ) : (
                          // 通常 best-of-3 でも 2-0/2-1 を指定できる（勝者手動に統一）
                          <div className="rounded-xl border border-white/10 bg-black/10 p-3 text-xs">
                            <div className="text-gray-300">最終結果（勝者手動）:</div>
                            <div className="mt-2 flex items-center gap-2">
                              <select
                                className="px-2 py-1 rounded bg-black/30 border border-white/10"
                                value={mode}
                                onChange={(e) => setSeriesModeMap((p) => ({ ...p, [key]: e.target.value as SeriesMode }))}
                              >
                                <option value="2-0">2-0</option>
                                <option value="2-1">2-1</option>
                              </select>
                              <span className="text-gray-400">（セット入力は参考表示のまま）</span>
                            </div>

                            {series ? (
                              <div className="mt-2 space-y-1 text-gray-200">
                                {series.games.map((g) => (
                                  <div key={g.label} className="flex items-center justify-between gap-2">
                                    <span className="text-gray-400">{g.label}</span>
                                    <span>
                                      {g.winner ? playerName(g.winner) : '—'}{' '}
                                      {g.note ? <span className="text-gray-400">({g.note})</span> : null}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="mt-2 text-gray-400">※ 勝者を選択すると、3試合の表示が出ます</div>
                            )}
                          </div>
                        )}

                        {/* set入力（表示維持） */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {[
                            { key: 's1', label: 'Set1' },
                            { key: 's2', label: 'Set2' },
                            { key: 's3', label: 'Set3' },
                          ].map((s) => {
                            const isSet1 = s.key === 's1';
                            const disableSet1 = !!advNormalId && isSet1;
                            const valA = isSet1 ? set1A : (r2SetA as any)[s.key];
                            const valB = isSet1 ? set1B : (r2SetB as any)[s.key];

                            return (
                              <div key={s.key} className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <div className="text-xs text-gray-300 mb-2">{s.label}</div>
                                <div className="flex items-center gap-2">
                                  <input
                                    value={valA}
                                    onChange={(e) => {
                                      if (disableSet1) return;
                                      setR2SetA((prev) => ({ ...prev, [s.key]: e.target.value }));
                                    }}
                                    disabled={disableSet1}
                                    className="w-full text-sm rounded-lg bg-black/40 border border-white/15 px-3 py-2 disabled:opacity-60"
                                    inputMode="numeric"
                                    placeholder="A"
                                  />
                                  <div className="text-gray-400">-</div>
                                  <input
                                    value={valB}
                                    onChange={(e) => {
                                      if (disableSet1) return;
                                      setR2SetB((prev) => ({ ...prev, [s.key]: e.target.value }));
                                    }}
                                    disabled={disableSet1}
                                    className="w-full text-sm rounded-lg bg-black/40 border border-white/15 px-3 py-2 disabled:opacity-60"
                                    inputMode="numeric"
                                    placeholder="B"
                                  />
                                </div>
                                {disableSet1 ? <div className="mt-1 text-[11px] text-gray-400">※ アドのため Set1 は固定</div> : null}
                              </div>
                            );
                          })}
                        </div>

                        <button
                          onClick={saveR2Final}
                          disabled={savingKey === 'r2:1' || !pidA || !pidB || !r2Winner}
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
