// app/mypage/page.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  FaAngleDoubleLeft,
  FaAngleLeft,
  FaAngleRight,
  FaAngleDoubleRight,
  FaSpinner,
  FaUserEdit,
  FaExclamationTriangle,
  FaUpload,
  FaSearch,
  FaTimes,
  FaSave,
  FaGamepad,
  FaTrophy,
  FaSignOutAlt,
  FaDoorOpen,
  FaPlus,
} from 'react-icons/fa';

const TeamRegisterFile = dynamic(() => import('./TeamRegisterFile'), { ssr: false });

/* ================================ 型 ================================ */
type Player = {
  id: string;
  handle_name: string;
  avatar_url?: string | null;
  ranking_points?: number | null;
  handicap?: number | null;
  wins?: number | null;
  losses?: number | null;
  matches_played?: number | null;
  created_at?: string | null;
};

type MatchRow = {
  id: string;
  mode: string;
  status?: string | null;
  match_date?: string | null;
  winner_score?: number | null;
  loser_score?: number | null;
};

type JoinedMatch = {
  match_id: string;
  side_no: number;
  matches?: MatchRow | undefined;
  opponent?: { id: string; handle_name: string } | null;

  // ✅ 不戦勝などで false のときはRP/HC表示しない＆グラフにも含めない
  affects_rating?: boolean;

  // ✅ 自分の変化
  my_points_change?: number;
  my_handicap_change?: number;
  my_rp_after?: number | null;
};

type TeamLite = { id: string; name: string };

type PickerItem = {
  id?: string;
  fullPath: string;
  url: string;
  source: 'own' | 'preset';
  created_at?: string | null;
};

const supabase = createClient();
const cls = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(' ');

/* ================================ 小道具 ================================ */
function toNum(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const m = s.match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickDelta(m: any, keys: string[]): number | null {
  for (const k of keys) {
    const n = toNum(m?.[k]);
    if (n !== null) return n;
  }
  return null;
}

function pointsChangeOf(m: any, isWin: boolean): number {
  const keys = isWin
    ? ['winner_points_change', 'winner_points_delta', 'winner_rp_change', 'winner_rp_delta']
    : ['loser_points_change', 'loser_points_delta', 'loser_rp_change', 'loser_rp_delta'];
  return pickDelta(m, keys) ?? 0;
}

function handicapChangeOf(m: any, isWin: boolean): number {
  const keys = isWin
    ? ['winner_handicap_change', 'winner_handicap_delta', 'winner_hc_change', 'winner_hc_delta']
    : ['loser_handicap_change', 'loser_handicap_delta', 'loser_hc_change', 'loser_hc_delta'];
  return pickDelta(m, keys) ?? 0;
}

function formatShortDate(s?: string | null) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 簡易SVG折れ線（順位は 1 が上） */
function MiniRankLine({
  ranks,
  labels,
  currentRank,
}: {
  ranks: number[];
  labels: string[];
  currentRank: number | null;
}) {
  const w = 320;
  const h = 120;
  const padX = 18;
  const padY = 14;

  const n = ranks.length;
  if (n === 0) {
    return <div className="text-xs text-gray-400">データがありません。</div>;
  }

  const minR = Math.min(...ranks);
  const maxR = Math.max(...ranks);
  const spanR = Math.max(1, maxR - minR);

  const xOf = (i: number) => {
    if (n === 1) return w / 2;
    return padX + (i * (w - padX * 2)) / (n - 1);
  };
  const yOf = (rank: number) => {
    // rankが小さいほど上（yが小さい）
    return padY + ((rank - minR) * (h - padY * 2)) / spanR;
  };

  const pts = ranks.map((r, i) => `${xOf(i)},${yOf(r)}`).join(' ');
  const path = `M ${pts.replaceAll(' ', ' L ')}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-gray-300">最近5試合の順位推移</div>
        <div className="text-xs text-gray-400">
          現在: <span className="text-yellow-100 font-semibold">{currentRank ?? '—'}位</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[120px]">
        <rect x="0" y="0" width={w} height={h} rx="12" className="fill-black/20" />
        <path d={path} className="stroke-purple-300" strokeWidth="2.5" fill="none" />
        {ranks.map((r, i) => (
          <circle key={i} cx={xOf(i)} cy={yOf(r)} r="4" className="fill-yellow-100/90" />
        ))}
      </svg>

      <div className="mt-2 flex justify-between text-[11px] text-gray-400">
        {labels.map((lb, i) => (
          <span key={i} className="tabular-nums">
            {lb || ' '}
          </span>
        ))}
      </div>

      <div className="mt-2 text-[11px] text-gray-500">
        ※順位は「各試合時点のRP（match_details側の値）」から推定しています（最小実装）
      </div>
    </div>
  );
}

/* ================================ ページ本体 ================================ */
export default function MyPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Player | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const [handle, setHandle] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string>('');

  // 画像アップロード
  const [uploadBusy, setUploadBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [avatarBucketMissing, setAvatarBucketMissing] = useState(false);

  // Storage ピッカー＋ページャ
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerItems, setPickerItems] = useState<PickerItem[]>([]);
  const [pickerMsg, setPickerMsg] = useState<string>('');
  const PAGE_SIZE = 20;
  const [pickerPage, setPickerPage] = useState(1);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(pickerItems.length / PAGE_SIZE)), [pickerItems.length]);
  const pageSlice = useMemo(() => {
    const s = (pickerPage - 1) * PAGE_SIZE;
    return pickerItems.slice(s, s + PAGE_SIZE);
  }, [pickerItems, pickerPage]);

  // 戦績
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [recentMatches, setRecentMatches] = useState<JoinedMatch[] | null>(null);
  const [matchFetchNote, setMatchFetchNote] = useState<string | null>(null);

  // 参加チーム
  const [myTeam, setMyTeam] = useState<TeamLite | null>(null);
  const [teamSearch, setTeamSearch] = useState('');
  const [teamCandidates, setTeamCandidates] = useState<TeamLite[]>([]);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinMsg, setJoinMsg] = useState<string>('');
  const TEAM_CAP = 4;

  // ✅ 順位推移用：全体RP
  const [playersLite, setPlayersLite] = useState<Array<{ id: string; ranking_points: number | null }>>([]);

  const computeRank = useCallback(
    (rp: number, uid: string) => {
      const arr = (playersLite ?? []).map((p) => ({
        id: String(p.id),
        rp: String(p.id) === String(uid) ? rp : (p.ranking_points ?? 0),
      }));
      arr.sort((a, b) => b.rp - a.rp || a.id.localeCompare(b.id));
      const idx = arr.findIndex((x) => x.id === String(uid));
      return idx >= 0 ? idx + 1 : null;
    },
    [playersLite],
  );

  const currentRank = useMemo(() => {
    if (!userId || !me) return null;
    const rp = me.ranking_points ?? 0;
    return computeRank(rp, userId);
  }, [userId, me, computeRank]);

  const [rankTrend, setRankTrend] = useState<{ labels: string[]; ranks: number[] } | null>(null);

  // ✅ 最近5試合（レートに影響する試合のみ）から順位推移を作る
  useEffect(() => {
    if (!recentMatches || recentMatches.length === 0 || !userId) {
      setRankTrend(null);
      return;
    }

    // 不戦勝など affects_rating=false を除外
    const base = recentMatches.filter((x) => x.affects_rating !== false);

    const last5 = base
      .slice(0, 5)
      .filter((x) => typeof x.my_rp_after === 'number' && Number.isFinite(x.my_rp_after as number));

    if (last5.length === 0) {
      setRankTrend(null);
      return;
    }

    // 古い→新しいにして折れ線
    const seq = [...last5].reverse();
    const labels = seq.map((x) => formatShortDate(x.matches?.match_date ?? null));
    const ranks = seq
      .map((x) => computeRank(x.my_rp_after as number, userId) ?? 0)
      .filter((n) => n > 0);

    if (ranks.length === 0) {
      setRankTrend(null);
      return;
    }

    setRankTrend({ labels, ranks });
  }, [recentMatches, userId, computeRank]);

  /* ===== 認証 & 初期化 ===== */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          const msg = String((error as any)?.message ?? '');
          if (msg.includes('Invalid Refresh Token') || msg.includes('Already Used')) {
            try {
              await supabase.auth.signOut();
            } catch {}
          }
          router.replace('/login?redirect=/mypage');
          return;
        }

        const session = data.session;
        if (!session?.user) {
          router.replace('/login?redirect=/mypage');
          return;
        }

        const user = session.user;
        if (cancelled) return;

        setUserId(user.id);
        setEmail(user.email ?? null);

        // players
        const { data: player, error: pErr } = await supabase
          .from('players')
          .select('id, handle_name, avatar_url, ranking_points, handicap, wins, losses, matches_played, created_at')
          .eq('id', user.id)
          .maybeSingle();

        if (pErr && (pErr as any).code !== 'PGRST116') throw pErr;

        let current = player as Player | null;
        if (!current) {
          const initialHandle = (user.email?.split('@')[0] || 'Player') + '-' + user.id.slice(0, 6);
          const { data: created, error: iErr } = await supabase
            .from('players')
            .insert([{ id: user.id, handle_name: initialHandle }] as any)
            .select('*')
            .single();
          if (iErr) throw iErr;
          current = created as Player;
        }

        if (cancelled) return;

        setMe(current);
        setHandle(current.handle_name || '');
        setAvatarUrl(current.avatar_url || null);

        // ✅ 順位用：全体RP
        try {
          const { data: pls } = await supabase.from('players').select('id, ranking_points').limit(500);
          if (!cancelled) setPlayersLite((pls ?? []) as any);
        } catch {
          if (!cancelled) setPlayersLite([]);
        }

        // 参加チーム
        try {
          const { data: tm, error: tmErr } = await supabase
            .from('team_members')
            .select('team_id, teams:team_id(id, name)')
            .eq('player_id', user.id)
            .maybeSingle();

          if (tmErr && (tmErr as any).code !== 'PGRST116') throw tmErr;

          if (tm && (tm as any).teams) {
            const t = (tm as any).teams as { id: string; name: string };
            setMyTeam({ id: t.id, name: t.name });
          } else {
            setMyTeam(null);
          }
        } catch {
          setMyTeam(null);
        }
      } catch (e) {
        console.error(e);
        router.replace('/login?redirect=/mypage');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  /* ✅ players を軽く再取得（ポイントが反映されない対策） */
  const refreshMe = useCallback(async (uid: string) => {
    try {
      const { data, error } = await supabase
        .from('players')
        .select('id, handle_name, avatar_url, ranking_points, handicap, wins, losses, matches_played, created_at')
        .eq('id', uid)
        .maybeSingle();
      if (!error && data) {
        setMe((prev) => (prev ? { ...prev, ...(data as any) } : (data as any)));
      }
    } catch {}
  }, []);

  /* ===== 最近試合取得（match_players 起点） + 変化は match_details から補完 ===== */
  const fetchRecentMatches = useCallback(async () => {
    setMatchesLoading(true);
    setMatchFetchNote(null);

    try {
      let uid = userId;

      if (!uid) {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          setRecentMatches([]);
          setMatchFetchNote((error as any)?.message ?? 'セッション取得に失敗しました。');
          return;
        }
        uid = data.session?.user?.id ?? null;
      }

      if (!uid) {
        setRecentMatches([]);
        setMatchFetchNote('未ログインのため戦績を取得できません。');
        return;
      }

      // 1) 自分の参加試合（match_players -> matches を JOIN）
      const { data: myRows, error: myErr } = await supabase
        .from('match_players')
        .select('match_id, side_no, matches:matches(id, mode, status, match_date, winner_score, loser_score)')
        .eq('player_id', uid)
        .order('match_date', { foreignTable: 'matches', ascending: false })
        .limit(30);

      if (myErr) {
        const msg = myErr.message || '戦績取得に失敗しました';
        if (msg.includes('relationship') || msg.includes('schema cache')) {
          setMatchFetchNote(
            'DBの外部キー（match_players.match_id → matches.id）が未設定、または Supabase の schema cache が未更新の可能性があります。Dashboard → Settings → API → Reload schema cache を試してください。',
          );
        } else {
          setMatchFetchNote(msg);
        }
        setRecentMatches([]);
        return;
      }

      const list = ((myRows ?? []) as any[]).filter((r) => !!r.matches);

      list.sort((a, b) => {
        const ta = a.matches?.match_date ? new Date(a.matches.match_date).getTime() : 0;
        const tb = b.matches?.match_date ? new Date(b.matches.match_date).getTime() : 0;
        return tb - ta;
      });

      if (list.length === 0) {
        setRecentMatches([]);
        return;
      }

      const matchIds = list.map((r) => String(r.match_id));

      // 2) 相手（同じ match_id の “自分以外”）
      const { data: oppRows, error: oppErr } = await supabase
        .from('match_players')
        .select('match_id, player_id, players:players(id, handle_name)')
        .in('match_id', matchIds)
        .neq('player_id', uid);

      if (oppErr) {
        setMatchFetchNote(oppErr.message || '相手情報の取得に失敗しました（試合自体は表示します）。');
      }

      const g = new Map<string, string[]>();
      for (const r of (oppRows ?? []) as any[]) {
        const mid = String(r.match_id);
        const name = r.players?.handle_name;
        if (!name) continue;
        g.set(mid, [...(g.get(mid) ?? []), String(name)]);
      }

      // 3) 変化(pt/HC)・試合時点RP・affects_rating を match_details から取得（VIEWフォールバック）
      const detailCandidates = ['match_details_mv', 'match_details_public', 'match_details'] as const;
      let detailRows: any[] = [];
      let lastDetailErr: any = null;

      for (const t of detailCandidates) {
        const { data, error } = await (supabase.from(t) as any)
          .select(
            'id,winner_id,loser_id,affects_rating,winner_points_change,loser_points_change,winner_points_delta,loser_points_delta,winner_rp_change,loser_rp_change,winner_handicap_change,loser_handicap_change,winner_hc_change,loser_hc_change,winner_current_points,loser_current_points',
          )
          .in('id', matchIds);

        if (!error && data) {
          detailRows = data as any[];
          lastDetailErr = null;
          break;
        }
        lastDetailErr = error;
      }
      if (lastDetailErr) {
        console.warn('[mypage] match_details fallback error:', lastDetailErr);
      }

      const dmap = new Map<string, any>();
      for (const r of detailRows ?? []) dmap.set(String(r.id), r);

      const items: JoinedMatch[] = list.map((r: any) => {
        const mid = String(r.match_id);
        const names = g.get(mid) ?? [];
        const oppName = names.length ? names.join(' / ') : null;

        const d = dmap.get(mid);
        const isWin = d ? String(d.winner_id) === String(uid) : false;
        const affects = d ? d.affects_rating !== false : true;

        const pt = d ? pointsChangeOf(d, isWin) : 0;
        const hc = d ? handicapChangeOf(d, isWin) : 0;
        const rpAfter = d ? toNum(isWin ? d.winner_current_points : d.loser_current_points) : null;

        return {
          match_id: mid,
          side_no: Number(r.side_no ?? 0),
          matches: r.matches as MatchRow,
          opponent: oppName ? { id: 'multi', handle_name: oppName } : null,
          affects_rating: affects,
          my_points_change: pt,
          my_handicap_change: hc,
          my_rp_after: rpAfter,
        };
      });

      setRecentMatches(items);

      // pointsが反映されない対策：最後にmeを軽く更新
      refreshMe(uid);

      // 順位推定に使う全体RPもたまに更新
      try {
        const { data: pls } = await supabase.from('players').select('id, ranking_points').limit(500);
        setPlayersLite((pls ?? []) as any);
      } catch {}
    } catch (e: any) {
      console.error('[recent] fail', e);
      setRecentMatches([]);
      setMatchFetchNote(e?.message ?? '戦績取得に失敗しました');
    } finally {
      setMatchesLoading(false);
    }
  }, [userId, refreshMe]);

  useEffect(() => {
    fetchRecentMatches();
  }, [fetchRecentMatches]);

  /* ===== プロフィール保存 ===== */
  const saveProfile = async () => {
    if (!userId) return;
    setProfileMsg('');
    setSavingProfile(true);
    try {
      const payload = { handle_name: handle.trim(), avatar_url: avatarUrl ?? null };
      const { error } = await (supabase as any).from('players').update(payload).eq('id', userId);
      if (error) throw error;

      setProfileMsg('保存しました。');
      setMe((m) => (m ? { ...m, handle_name: payload.handle_name, avatar_url: payload.avatar_url } : m));
      setTimeout(() => setProfileMsg(''), 2500);
    } catch (e: any) {
      setProfileMsg(e?.message || '保存に失敗しました');
    } finally {
      setSavingProfile(false);
    }
  };

  /* ===== アバター: アップロード ===== */
  const onPickAvatar = () => fileRef.current?.click();
  const onAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !userId) return;

    setUploadBusy(true);
    setAvatarBucketMissing(false);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `public/users/${userId}/${Date.now()}.${ext}`;
      const up = await supabase.storage.from('avatars').upload(path, file, {
        cacheControl: '3600',
        upsert: true,
      });
      if (up.error) {
        if (String(up.error.message || '').toLowerCase().includes('bucket')) setAvatarBucketMissing(true);
        throw up.error;
      }
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = pub?.publicUrl || null;
      setAvatarUrl(url);
      setProfileMsg('アップロード成功。保存ボタンで反映します。');
    } catch (e: any) {
      setProfileMsg(e?.message || 'アップロードに失敗しました');
    } finally {
      setUploadBusy(false);
    }
  };

  /* ===== アバター: ピッカー ===== */
  const openPicker = useCallback(async () => {
    if (!userId) return;
    setPickerOpen(true);
    setPickerLoading(true);
    setPickerMsg('');
    setPickerItems([]);
    setPickerPage(1);
    try {
      const ownListRes = await supabase.storage.from('avatars').list(`public/users/${userId}`, {
        limit: 200,
        sortBy: { column: 'created_at', order: 'desc' },
      });
      const ownItems: PickerItem[] = (ownListRes.data || [])
        .filter((f) => !f.name.endsWith('/'))
        .map((f) => {
          const fullPath = `public/users/${userId}/${f.name}`;
          const { data } = supabase.storage.from('avatars').getPublicUrl(fullPath);
          return {
            fullPath,
            url: data?.publicUrl || '',
            source: 'own',
            created_at: (f as any).created_at ?? null,
          };
        });

      const presetRes = await supabase.storage.from('avatars').list(`preset`, {
        limit: 200,
        sortBy: { column: 'name', order: 'asc' },
      });
      const presetItems: PickerItem[] = (presetRes.data || [])
        .filter((f) => !f.name.endsWith('/'))
        .map((f) => {
          const fullPath = `preset/${f.name}`;
          const { data } = supabase.storage.from('avatars').getPublicUrl(fullPath);
          return {
            fullPath,
            url: data?.publicUrl || '',
            source: 'preset',
            created_at: (f as any).created_at ?? null,
          };
        });

      const all = [...ownItems, ...presetItems].filter((x) => !!x.url);
      if (all.length === 0)
        setPickerMsg('候補がありません（自分でアップロードするか、管理者にプリセットの追加を依頼してください）。');
      setPickerItems(all);
    } catch (e: any) {
      setPickerItems([]);
      setPickerMsg(e?.message || '画像候補の読み込みに失敗しました。');
    } finally {
      setPickerLoading(false);
    }
  }, [userId]);

  const chooseFromStorage = (item: PickerItem) => {
    setAvatarUrl(item.url);
    setProfileMsg('画像を選択しました。保存ボタンで反映します。');
    setPickerOpen(false);
  };

  const gotoPage = (p: number) => setPickerPage((t) => Math.max(1, Math.min(totalPages, p)));
  const Pager = () => {
    if (pickerItems.length === 0) return null;
    return (
      <div className="flex items-center justify-between gap-3 text-sm text-gray-300">
        <div>
          全 {pickerItems.length} 件中{' '}
          <span className="text-yellow-100">
            {(pickerPage - 1) * PAGE_SIZE + 1}–{Math.min(pickerPage * PAGE_SIZE, pickerItems.length)}
          </span>
          件を表示
        </div>
        <div className="inline-flex items-center gap-1">
          <button
            onClick={() => gotoPage(1)}
            disabled={pickerPage === 1}
            className="px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40"
            title="最初"
          >
            <FaAngleDoubleLeft />
          </button>
          <button
            onClick={() => gotoPage(pickerPage - 1)}
            disabled={pickerPage === 1}
            className="px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40"
            title="前"
          >
            <FaAngleLeft />
          </button>
          <span className="px-2">
            {pickerPage} / {totalPages}
          </span>
          <button
            onClick={() => gotoPage(pickerPage + 1)}
            disabled={pickerPage === totalPages}
            className="px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40"
            title="次"
          >
            <FaAngleRight />
          </button>
          <button
            onClick={() => gotoPage(totalPages)}
            disabled={pickerPage === totalPages}
            className="px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40"
            title="最後"
          >
            <FaAngleDoubleRight />
          </button>
        </div>
      </div>
    );
  };

  /* ===== 参加チーム ===== */
  useEffect(() => {
    if (!teamSearch.trim()) {
      setTeamCandidates([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data, error } = await supabase.from('teams').select('id, name').ilike('name', `%${teamSearch.trim()}%`).limit(10);
      if (!error) setTeamCandidates((data || []) as TeamLite[]);
    }, 250);
    return () => clearTimeout(t);
  }, [teamSearch]);

  const joinTeam = async (team: TeamLite) => {
    if (!userId) return;
    setJoinMsg('');
    if (myTeam) {
      setJoinMsg(`すでに「${myTeam.name}」に参加中です。複数チームへの参加はできません。`);
      return;
    }
    setJoinBusy(true);
    try {
      const { count } = await supabase.from('team_members').select('player_id', { count: 'exact', head: true }).eq('team_id', team.id);
      if ((count ?? 0) >= TEAM_CAP) {
        setJoinMsg('定員オーバーのため参加できません（各チーム最大4名）。');
        return;
      }
      const { data: already } = await supabase.from('team_members').select('team_id').eq('player_id', userId).limit(1);
      if ((already || []).length > 0) {
        setJoinMsg('すでにチームに参加済みです。');
        return;
      }
      const { error: jErr } = await supabase.from('team_members').insert([{ team_id: team.id, player_id: userId }] as any);
      if (jErr) throw jErr;
      setMyTeam({ id: team.id, name: team.name });
      setJoinMsg(`「${team.name}」に参加しました！`);
      setTeamSearch('');
      setTeamCandidates([]);
    } catch (e: any) {
      setJoinMsg(e?.message || '参加に失敗しました。');
    } finally {
      setJoinBusy(false);
    }
  };

  const leaveTeam = async () => {
    if (!userId || !myTeam) return;
    setJoinBusy(true);
    setJoinMsg('');
    try {
      const { error } = await supabase.from('team_members').delete().eq('player_id', userId).eq('team_id', myTeam.id);
      if (error) throw error;
      setMyTeam(null);
      setJoinMsg('チームを脱退しました。');
    } catch (e: any) {
      setJoinMsg(e?.message || '脱退に失敗しました。');
    } finally {
      setJoinBusy(false);
    }
  };

  /* ===== ログアウト ===== */
  const signOut = async () => {
    await supabase.auth.signOut();
    try {
      await fetch('/auth/callback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: 'SIGNED_OUT', session: null }),
      });
    } catch {}
    router.replace('/');
  };

  /* ============================ UI ============================ */
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="glass-card rounded-xl p-8 text-center">
          <FaSpinner className="mx-auto mb-3 animate-spin text-purple-400" />
          <p className="text-gray-300">読み込み中...</p>
        </div>
      </div>
    );
  }
  if (!me || !userId) return null;

  const wins = me.wins ?? 0;
  const losses = me.losses ?? 0;
  const games = wins + losses;
  const winRate = games > 0 ? ((wins / games) * 100).toFixed(1) : null;

  return (
    <div className="container mx-auto px-4 py-6 sm:py-8">
      {/* ヘッダー */}
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-yellow-100 flex items-center gap-3">
          <FaUserEdit /> マイページ
        </h1>
        <p className="text-gray-400 mt-1">
          {email ? (
            <>
              ログイン中: <span className="text-purple-300">{email}</span>
            </>
          ) : (
            'ログイン中'
          )}
        </p>
      </div>

      {/* プロフィール編集 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-card rounded-xl p-5 border border-purple-500/30 bg-gray-900/50">
          <h2 className="text-lg font-semibold text-purple-200 mb-4">プロフィール編集</h2>

          {avatarBucketMissing && (
            <div className="mb-4 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 text-sm">
              <FaExclamationTriangle className="inline mr-2" />
              Supabase Storage の <code>avatars</code> バケットが見つかりません。作成して公開設定を有効にしてください。
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-4 items-start">
            {/* Avatar */}
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={avatarUrl || '/default-avatar.png'}
                alt="avatar"
                className="w-24 h-24 rounded-full border-2 border-purple-500 object-cover"
              />
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onAvatarFile} />
              <div className="flex gap-2 mt-3 flex-wrap">
                <button
                  type="button"
                  onClick={onPickAvatar}
                  disabled={uploadBusy}
                  className={cls(
                    'px-3 py-2 rounded-lg text-sm inline-flex items-center gap-2',
                    'bg-purple-600 hover:bg-purple-700 disabled:opacity-60',
                  )}
                >
                  <FaUpload /> 画像をアップロード
                </button>
                <button
                  type="button"
                  onClick={openPicker}
                  className="px-3 py-2 rounded-lg text-sm inline-flex items-center gap-2 bg-gray-700 hover:bg-gray-600"
                >
                  <FaSearch /> 候補から選ぶ
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarUrl(null)}
                    className="px-3 py-2 rounded-lg text-sm inline-flex items-center gap-2 bg-gray-700 hover:bg-gray-600"
                  >
                    <FaTimes /> クリア
                  </button>
                )}
              </div>

              {/* 画像ピッカー */}
              {pickerOpen && (
                <div className="mt-3 p-3 rounded-lg border border-purple-500/30 bg-gray-900/80 w-[22rem] max-w-full">
                  <div className="mb-2 text-sm text-gray-300">画像を選択</div>
                  {pickerLoading ? (
                    <div className="py-6 text-center text-gray-400">
                      <FaSpinner className="animate-spin inline mr-2" />
                      読み込み中…
                    </div>
                  ) : pickerItems.length === 0 ? (
                    <div className="text-sm text-gray-400">{pickerMsg || '候補なし'}</div>
                  ) : (
                    <>
                      <div className="grid grid-cols-4 gap-2 max-h-64 overflow-auto pr-1">
                        {pageSlice.map((it) => (
                          <button
                            key={it.fullPath}
                            onClick={() => chooseFromStorage(it)}
                            className="rounded-lg overflow-hidden border border-purple-500/20 hover:border-purple-400/60"
                            title={it.fullPath}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={it.url} alt="" className="w-full h-16 object-cover" />
                          </button>
                        ))}
                      </div>
                      <div className="mt-2">
                        <Pager />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Fields */}
            <div className="flex-1 w-full">
              <label className="block text-sm text-gray-300 mb-2">ハンドルネーム</label>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="ハンドルネーム"
                className="w-full px-4 py-2.5 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 outline-none"
              />

              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={saveProfile}
                  disabled={savingProfile}
                  className={cls(
                    'px-4 py-2 rounded-lg inline-flex items-center gap-2',
                    'bg-green-600 hover:bg-green-700 disabled:opacity-60',
                  )}
                >
                  {savingProfile ? <FaSpinner className="animate-spin" /> : <FaSave />} 保存
                </button>

                <button type="button" onClick={() => refreshMe(userId)} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600">
                  再読み込み
                </button>
              </div>

              {profileMsg && <p className="mt-3 text-sm text-gray-300">{profileMsg}</p>}
            </div>
          </div>
        </div>

        {/* 概要＋チーム参加＋試合登録 */}
        <div className="space-y-6">
          {/* 概要カード */}
          <div className="glass-card rounded-xl p-5 border border-purple-500/30 bg-gray-900/50">
            <h3 className="text-lg font-semibold text-purple-200 mb-3">概要</h3>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-lg bg-purple-900/30 p-3">
                <div className="text-2xl font-bold text-yellow-100">{me.ranking_points ?? 0}</div>
                <div className="text-xs text-gray-400">ポイント</div>
              </div>
              <div className="rounded-lg bg-purple-900/30 p-3">
                <div className="text-2xl font-bold text-yellow-100">{me.handicap ?? 0}</div>
                <div className="text-xs text-gray-400">ハンディ</div>
              </div>
              <div className="rounded-lg bg-purple-900/30 p-3">
                <div className="text-2xl font-bold text-green-400">{me.wins ?? 0}</div>
                <div className="text-xs text-gray-400">勝</div>
              </div>
              <div className="rounded-lg bg-purple-900/30 p-3">
                <div className="text-2xl font-bold text-red-400">{me.losses ?? 0}</div>
                <div className="text-xs text-gray-400">敗</div>
              </div>
              <div className="col-span-2 rounded-lg bg-purple-900/30 p-3">
                <div className="text-2xl font-bold text-blue-400">{games > 0 ? `${winRate}%` : '—'}</div>
                <div className="text-xs text-gray-400">勝率</div>
              </div>
            </div>

            <div className="mt-5 flex gap-2 flex-col">
              <Link
                href="/matches/register/singles"
                className="px-4 py-2 rounded-lg bg-purple-600/80 hover:bg-purple-700 inline-flex items-center gap-2"
              >
                <FaGamepad /> 個人戦に登録
              </Link>
              <Link
                href="/teams"
                className="px-4 py-2 rounded-lg bg-purple-600/30 hover:bg-purple-600/40 inline-flex items-center gap-2"
              >
                <FaTrophy /> チームを探す
              </Link>
              <button onClick={signOut} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 inline-flex items-center gap-2">
                <FaSignOutAlt /> ログアウト
              </button>
            </div>
          </div>

          {/* 参加チームカード */}
          <div className="glass-card rounded-xl p-5 border border-purple-500/30 bg-gray-900/50">
            <h3 className="text-lg font-semibold text-purple-200 mb-3 flex items-center gap-2">
              <FaTrophy /> 参加チーム
            </h3>

            {myTeam ? (
              <div className="p-3 rounded-lg bg-purple-900/30 border border-purple-500/30">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-yellow-100 font-semibold">{myTeam.name}</div>
                    <div className="text-xs text-gray-400">参加中</div>
                  </div>
                  <button
                    onClick={leaveTeam}
                    disabled={joinBusy}
                    className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 inline-flex items-center gap-2 text-sm"
                    title="チームを脱退する"
                  >
                    <FaDoorOpen /> 脱退
                  </button>
                </div>
                {joinMsg && <p className="mt-2 text-sm text-gray-300">{joinMsg}</p>}
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-400 mb-3">参加するチームを検索して選択してください（各チーム最大4名／複数チーム参加不可）。</p>
                <div className="relative">
                  <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={teamSearch}
                    onChange={(e) => setTeamSearch(e.target.value)}
                    placeholder="チーム名で検索"
                    className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-purple-900/30 border border-purple-500/30 text-yellow-100 placeholder:text-gray-400 focus:outline-none focus:border-purple-400"
                  />
                </div>
                {teamCandidates.length > 0 && (
                  <div className="mt-3 rounded-lg border border-purple-500/30 overflow-hidden">
                    {teamCandidates.map((t) => (
                      <div key={t.id} className="flex items-center justify-between px-3 py-2 bg-gray-900/60">
                        <div className="truncate">{t.name}</div>
                        <button
                          disabled={joinBusy}
                          onClick={() => joinTeam(t)}
                          className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 inline-flex items-center gap-2 text-sm"
                        >
                          {joinBusy ? <FaSpinner className="animate-spin" /> : <FaPlus />} 参加する
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {joinMsg && <p className="mt-2 text-sm text-gray-300">{joinMsg}</p>}
                <div className="mt-3 text-xs text-gray-500">※ 定員（{TEAM_CAP}名）を超える場合は参加できません。</div>
              </>
            )}
          </div>

          {/* チーム試合登録タイル */}
          <TeamRegisterFile />
        </div>
      </div>

      {/* ✅ 所属チームと直近の試合の間：最近5試合のランキング折線グラフ */}
      <div className="mt-8 glass-card rounded-xl p-5 border border-purple-500/30 bg-gray-900/50">
        {rankTrend ? (
          <MiniRankLine ranks={rankTrend.ranks} labels={rankTrend.labels} currentRank={currentRank} />
        ) : (
          <div className="text-sm text-gray-400">順位推移は、レートに影響する試合が増えると表示されます。</div>
        )}
      </div>

      {/* 最近の試合 */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-card rounded-xl p-5 border border-purple-500/30 bg-gray-900/50">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-purple-200">最近の試合</h2>
            <Link
              href="/rankings"
              className="px-3 py-2 rounded-lg bg-purple-700/70 hover:bg-purple-700 inline-flex items-center gap-2"
            >
              ランキングへ
            </Link>
          </div>

          {matchesLoading ? (
            <div className="p-6 text-center text-gray-400">
              <FaSpinner className="animate-spin inline mr-2" />
              取得中…
            </div>
          ) : recentMatches && recentMatches.length > 0 ? (
            <div className="space-y-3">
              {recentMatches.map((r) => {
                const m = r.matches!;
                const when = m.match_date ? new Date(m.match_date).toLocaleString() : '-';

                const pt = r.my_points_change ?? 0;
                const hc = r.my_handicap_change ?? 0;

                return (
                  <div
                    key={r.match_id}
                    className="p-3 rounded-xl border border-purple-500/30 bg-gray-900/40 flex items-center justify-between"
                  >
                    <div className="min-w-0">
                      <div className="text-xs text-gray-400">{when}</div>
                      <div className="text-sm text-yellow-100 truncate">
                        {m.mode} / {m.status || '-'}
                      </div>

                      {r.opponent && <div className="text-xs text-gray-400 truncate">vs {r.opponent.handle_name}</div>}

                      {/* ✅ RP/HC は「レートに影響する試合」だけ表示（不戦勝など affects_rating=false は非表示） */}
                      {r.affects_rating !== false && (
                        <div className="mt-1 text-xs">
                          <span className={pt >= 0 ? 'text-green-300' : 'text-red-300'}>
                            {pt > 0 ? '+' : ''}
                            {pt}pt
                          </span>
                          <span className="ml-2 text-blue-200">
                            HC {hc > 0 ? '+' : ''}
                            {hc}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="text-right">
                      <div className="text-lg font-bold text-white">
                        {m.winner_score ?? '-'} - {m.loser_score ?? '-'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-6 text-center text-gray-400">試合がありません。</div>
          )}

          {matchFetchNote && <div className="mt-3 text-xs text-gray-400">{matchFetchNote}</div>}
        </div>

        <div className="glass-card rounded-xl p-5 border border-purple-500/30 bg-gray-900/50">
          <h2 className="text-lg font-semibold text-purple-200 mb-3">お知らせ</h2>
          <p className="text-sm text-gray-300">
            チーム戦の登録は右側「チーム試合登録」タイルから行えます。所属していない場合は、まず参加チームを設定してください。
          </p>
        </div>
      </div>
    </div>
  );
}
