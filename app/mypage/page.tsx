// app/mypage/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FaUserEdit, FaSignOutAlt, FaSave, FaSpinner, FaTrophy, FaUpload, FaTimes, FaPlus,
  FaGamepad, FaCheckCircle, FaExclamationTriangle, FaUsers, FaSearch, FaDoorOpen,
  FaAngleLeft, FaAngleRight, FaAngleDoubleLeft, FaAngleDoubleRight
} from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

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
  matches?: MatchRow; // 取得できないケースもあるので UI 側で ! 使用
  opponent?: { id: string; handle_name: string } | null;
};

type TeamLite = { id: string; name: string };

type PickerItem = {
  id?: string;
  fullPath: string;
  url: string;
  source: 'own' | 'preset';
  created_at?: string | null;
};

/** fetchRecentMatches 用の簡易型（型生成なし前提） */
type MatchPlayerRowLite = {
  match_id: string;
  side_no: number;
  matches?: MatchRow | null;
};
type OppRow = {
  match_id: string;
  player_id: string;
  players?: { id: string; handle_name: string } | null;
};

const supabase = createClient();
const cls = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(' ');

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

  // Storage ピッカー＋ページャ（自分=avatars/public/users/<uid>/... とプリセット=avatars/preset）
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

  /* ===== 認証 & 初期化 ===== */
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.replace('/login?redirect=/mypage');
          return;
        }
        setUserId(user.id);
        setEmail(user.email ?? null);

        // players
        const { data: player, error } = await supabase
          .from('players')
          .select('id, handle_name, avatar_url, ranking_points, handicap, wins, losses, matches_played, created_at')
          .eq('id', user.id)
          .maybeSingle();
        if (error && error.code !== 'PGRST116') throw error;

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

        setMe(current);
        setHandle(current.handle_name || '');
        setAvatarUrl(current.avatar_url || null);

        // 参加チーム（tm をローカルでチェックして安全にガード）
        try {
          const { data: tm, error: tmErr } = await supabase
            .from('team_members')
            .select('team_id, teams:team_id(id, name)')
            .eq('player_id', user.id)
            .maybeSingle();
          if (tmErr && tmErr.code !== 'PGRST116') throw tmErr;

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
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  /* ===== 最近試合取得 ===== */
  const fetchRecentMatches = useCallback(async () => {
    if (!userId) return;
    setMatchesLoading(true);
    setRecentMatches(null);
    setMatchFetchNote(null);
    try {
      const { data, error } = await supabase
        .from('match_players')
        .select('match_id, side_no, matches:matches ( id, mode, status, match_date, winner_score, loser_score )')
        .eq('player_id', userId)
        .order('match_date', { foreignTable: 'matches', ascending: false })
        .limit(30);
      if (error) throw error;

      // ★ data を明示型にして never 推論を回避
      const rows = (data ?? []) as MatchPlayerRowLite[];

      const matchIds = rows.map((r) => r.match_id);
      if (matchIds.length === 0) {
        setRecentMatches([]);
        return;
      }

      const { data: opponents } = await supabase
        .from('match_players')
        .select('match_id, player_id, players:players(id, handle_name)')
        .in('match_id', matchIds);

      const byMatch = new Map<string, Array<{ id: string; handle_name: string }>>();
      ((opponents ?? []) as OppRow[]).forEach((row) => {
        const arr = byMatch.get(row.match_id) || [];
        if (row.players?.id) {
          arr.push({ id: row.players.id, handle_name: row.players.handle_name });
        }
        byMatch.set(row.match_id, arr);
      });

      const joined: JoinedMatch[] = rows.map((r) => {
        const people = byMatch.get(r.match_id) || [];
        const opp = people.find((p) => p.id !== userId) || null;
        return {
          match_id: r.match_id,
          side_no: r.side_no,
          matches: (r.matches ?? undefined) as MatchRow | undefined,
          opponent: opp,
        };
      });

      setRecentMatches(joined);
    } catch (e: any) {
      console.warn('戦績取得に失敗:', e?.message || e);
      setMatchFetchNote('戦績テーブル/ビューが未設定のため、最近の試合履歴を表示できません。');
      setRecentMatches([]);
    } finally {
      setMatchesLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchRecentMatches(); }, [fetchRecentMatches]);

  /* ===== プロフィール保存 ===== */
  const saveProfile = async () => {
    if (!userId) return;
    setProfileMsg('');
    setSavingProfile(true);
    try {
      const { error } = await supabase
        .from('players')
        .update({ handle_name: handle.trim(), avatar_url: avatarUrl || null } as any)
        .eq('id', userId);
      if (error) throw error;
      setProfileMsg('保存しました。');
      setMe((m) => (m ? { ...m, handle_name: handle.trim(), avatar_url: avatarUrl || null } : m));
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

  /* ===== アバター: ピッカー（自分の画像＋プリセット） ===== */
  const openPicker = useCallback(async () => {
    if (!userId) return;
    setPickerOpen(true);
    setPickerLoading(true);
    setPickerMsg('');
    setPickerItems([]);
    setPickerPage(1);
    try {
      // 自分の画像（avatars/public/users/<uid> 以下）
      const ownListRes = await supabase.storage.from('avatars').list(`public/users/${userId}`, {
        limit: 200, sortBy: { column: 'created_at', order: 'desc' }
      });
      const ownItems: PickerItem[] = (ownListRes.data || [])
        .filter((f) => !f.name.endsWith('/'))
        .map((f) => {
          const fullPath = `public/users/${userId}/${f.name}`;
          const { data } = supabase.storage.from('avatars').getPublicUrl(fullPath);
          return { fullPath, url: data?.publicUrl || '', source: 'own', created_at: (f as any).created_at ?? null };
        });

      // プリセット（avatars/preset）
      const presetRes = await supabase.storage.from('avatars').list(`preset`, {
        limit: 200, sortBy: { column: 'name', order: 'asc' }
      });
      const presetItems: PickerItem[] = (presetRes.data || [])
        .filter((f) => !f.name.endsWith('/'))
        .map((f) => {
          const fullPath = `preset/${f.name}`;
          const { data } = supabase.storage.from('avatars').getPublicUrl(fullPath);
          return { fullPath, url: data?.publicUrl || '', source: 'preset', created_at: (f as any).created_at ?? null };
        });

      const all = [...ownItems, ...presetItems].filter((x) => !!x.url);
      if (all.length === 0) setPickerMsg('候補がありません（自分でアップロードするか、管理者にプリセットの追加を依頼してください）。');
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
          <button onClick={() => gotoPage(1)} disabled={pickerPage === 1} className="px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40" title="最初"><FaAngleDoubleLeft/></button>
          <button onClick={() => gotoPage(pickerPage - 1)} disabled={pickerPage === 1} className="px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40" title="前"><FaAngleLeft/></button>
          <span className="px-2">{pickerPage} / {totalPages}</span>
          <button onClick={() => gotoPage(pickerPage + 1)} disabled={pickerPage === totalPages} className="px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40" title="次"><FaAngleRight/></button>
          <button onClick={() => gotoPage(totalPages)} disabled={pickerPage === totalPages} className="px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40" title="最後"><FaAngleDoubleRight/></button>
        </div>
      </div>
    );
  };

  /* ===== 参加チーム ===== */
  useEffect(() => {
    if (!teamSearch.trim()) { setTeamCandidates([]); return; }
    const t = setTimeout(async () => {
      const { data, error } = await supabase.from('teams').select('id, name').ilike('name', `%${teamSearch.trim()}%`).limit(10);
      if (!error) setTeamCandidates((data || []) as TeamLite[]);
    }, 250);
    return () => clearTimeout(t);
  }, [teamSearch]);

  const joinTeam = async (team: TeamLite) => {
    if (!userId) return;
    setJoinMsg('');
    if (myTeam) { setJoinMsg(`すでに「${myTeam.name}」に参加中です。複数チームへの参加はできません。`); return; }
    setJoinBusy(true);
    try {
      const { count } = await supabase.from('team_members').select('player_id', { count: 'exact', head: true }).eq('team_id', team.id);
      if ((count ?? 0) >= TEAM_CAP) { setJoinMsg('定員オーバーのため参加できません（各チーム最大4名）。'); return; }
      const { data: already } = await supabase.from('team_members').select('team_id').eq('player_id', userId).limit(1);
      if ((already || []).length > 0) { setJoinMsg('すでにチームに参加済みです。'); return; }
      const { error: jErr } = await supabase.from('team_members').insert([{ team_id: team.id, player_id: userId }] as any);
      if (jErr) throw jErr;
      setMyTeam({ id: team.id, name: team.name });
      setJoinMsg(`「${team.name}」に参加しました！`);
      setTeamSearch(''); setTeamCandidates([]);
    } catch (e: any) {
      setJoinMsg(e?.message || '参加に失敗しました。');
    } finally {
      setJoinBusy(false);
    }
  };

  const leaveTeam = async () => {
    if (!userId || !myTeam) return;
    setJoinBusy(true); setJoinMsg('');
    try {
      const { error } = await supabase.from('team_members').delete().eq('player_id', userId).eq('team_id', myTeam.id);
      if (error) throw error;
      setMyTeam(null); setJoinMsg('チームを脱退しました。');
    } catch (e: any) {
      setJoinMsg(e?.message || '脱退に失敗しました。');
    } finally { setJoinBusy(false); }
  };

  /* ===== ログアウト ===== */
  const signOut = async () => {
    await supabase.auth.signOut();
    try {
      await fetch('/auth/callback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'SIGNED_OUT', session: null }) });
    } catch {}
    router.replace('/');
  };

  /* ============================ 試合登録 UI/処理 ============================ */
  const [regOpen, setRegOpen] = useState(false);
  const [regSaving, setRegSaving] = useState(false);
  const [regError, setRegError] = useState<string>('');
  const [regDone, setRegDone] = useState<string>('');
  const [regMode, setRegMode] = useState<'SINGLES' | 'DOUBLES'>('SINGLES');
  const [regAt, setRegAt] = useState<string>(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16); // yyyy-MM-ddTHH:mm
  });
  const [regMy, setRegMy] = useState<number>(0);
  const [regOpp, setRegOpp] = useState<number>(0);

  const [oppoQuery, setOppoQuery] = useState('');
  const [oppoOptions, setOppoOptions] = useState<Array<{ id: string; handle_name: string; avatar_url?: string | null }>>([]);
  const [oppo, setOppo] = useState<{ id: string; handle_name: string } | null>(null);

  // 相手検索
  useEffect(() => {
    if (!regOpen) return;
    const t = setTimeout(async () => {
      if (!oppoQuery.trim()) { setOppoOptions([]); return; }
      const { data } = await supabase
        .from('players')
        .select('id, handle_name, avatar_url')
        .ilike('handle_name', `%${oppoQuery.trim()}%`)
        .neq('id', userId)
        .limit(10);
      setOppoOptions(data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [oppoQuery, regOpen, userId]);

  const submitRegister = async () => {
    if (!userId) return;
    setRegError(''); setRegDone('');
    if (!oppo) { setRegError('対戦相手を選択してください。'); return; }
    if (regMy === regOpp) { setRegError('同点は登録できません。どちらかが勝利するようにスコアを入力してください。'); return; }
    const dt = new Date(regAt);
    if (Number.isNaN(dt.getTime())) { setRegError('試合日時の形式が正しくありません。'); return; }

    setRegSaving(true);
    try {
      const winner_score = Math.max(regMy, regOpp);
      const loser_score  = Math.min(regMy, regOpp);

      // matches
      const { data: m, error: mErr } = await supabase
        .from('matches')
        .insert([{ mode: regMode, status: 'completed', match_date: dt.toISOString(), winner_score, loser_score }] as any)
        .select('id')
        .single();
      if (mErr) throw mErr;

      // match_players（自分=side 1、相手=side 2）
      const { error: mpErr } = await supabase.from('match_players').insert([
        { match_id: m.id, player_id: userId, side_no: 1 },
        { match_id: m.id, player_id: oppo.id, side_no: 2 },
      ] as any);
      if (mpErr) throw mpErr;

      setRegDone('試合を登録しました。BOX を閉じます。');
      setRegOpen(false);
      setRegMy(0); setRegOpp(0); setOppo(null); setOppoQuery('');
      await fetchRecentMatches();
    } catch (e: any) {
      setRegError(e?.message || '登録に失敗しました。スキーマとRLSをご確認ください。');
    } finally {
      setRegSaving(false);
    }
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
        <p className="text-gray-400 mt-1">{email ? <>ログイン中: <span className="text-purple-300">{email}</span></> : 'ログイン中'}</p>
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
              <img src={avatarUrl || '/default-avatar.png'} alt="avatar" className="w-24 h-24 rounded-full border-2 border-purple-500 object-cover" />
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onAvatarFile} />
              <div className="flex gap-2 mt-3 flex-wrap">
                <button type="button" onClick={onPickAvatar} disabled={uploadBusy} className={cls('px-3 py-2 rounded-lg text-sm inline-flex items-center gap-2','bg-purple-600 hover:bg-purple-700 disabled:opacity-60')}>
                  <FaUpload /> 画像をアップロード
                </button>
                <button type="button" onClick={openPicker} className="px-3 py-2 rounded-lg text-sm inline-flex items-center gap-2 bg-gray-700 hover:bg-gray-600">
                  <FaSearch /> 候補から選ぶ
                </button>
                {avatarUrl && (
                  <button type="button" onClick={() => setAvatarUrl(null)} className="px-3 py-2 rounded-lg text-sm inline-flex items-center gap-2 bg-gray-700 hover:bg-gray-600">
                    <FaTimes /> クリア
                  </button>
                )}
              </div>
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
                <button type="button" onClick={saveProfile} disabled={savingProfile} className={cls('px-4 py-2 rounded-lg inline-flex items-center gap-2','bg-green-600 hover:bg-green-700 disabled:opacity-60')}>
                  {savingProfile ? <FaSpinner className="animate-spin" /> : <FaSave />} 保存
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    if (!userId) return;
                    const payload: any = {};
                    const { data: p } = await supabase.from('players').select('*').eq('id', userId).single();
                    payload.player = p || null;
                    try {
                      const { data: mp } = await supabase.from('match_players').select('*, matches:matches(*)').eq('player_id', userId).limit(200);
                      payload.matches = mp || [];
                    } catch { payload.matches = []; }
                    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a'); a.href = url; a.download = `mydata-${userId.slice(0, 8)}.json`; a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600"
                >
                  データをエクスポート(JSON)
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

            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={() => setRegOpen(true)}
                className="px-4 py-2 rounded-lg bg-purple-600/80 hover:bg-purple-700 inline-flex items-center gap-2"
              >
                <FaGamepad /> 試合を登録
              </button>
              <Link href="/teams" className="px-4 py-2 rounded-lg bg-purple-600/30 hover:bg-purple-600/40 inline-flex items-center gap-2">
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
              <FaUsers /> 参加チーム
            </h3>

            {myTeam ? (
              <div className="p-3 rounded-lg bg-purple-900/30 border border-purple-500/30">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-yellow-100 font-semibold">{myTeam.name}</div>
                    <div className="text-xs text-gray-400">参加中</div>
                  </div>
                  <button onClick={leaveTeam} disabled={joinBusy} className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 inline-flex items-center gap-2 text-sm" title="チームを脱退する">
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
                        <button disabled={joinBusy} onClick={() => joinTeam(t)} className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 inline-flex items-center gap-2 text-sm">
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
        </div>
      </div>

      {/* 最近の試合 */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-card rounded-xl p-5 border border-purple-500/30 bg-gray-900/50">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-purple-200">最近の試合</h2>
            <Link href="/rankings" className="px-3 py-2 rounded-lg bg-purple-700/70 hover:bg-purple-700 inline-flex items-center gap-2">ランキングへ</Link>
          </div>

          {matchesLoading ? (
            <div className="p-6 text-center text-gray-400"><FaSpinner className="animate-spin inline mr-2" />取得中…</div>
          ) : recentMatches && recentMatches.length > 0 ? (
            <div className="space-y-3">
              {recentMatches.map((r) => {
                const m = r.matches!;
                const when = m.match_date ? new Date(m.match_date).toLocaleString() : '-';
                return (
                  <div key={r.match_id} className="p-3 rounded-xl border border-purple-500/30 bg-gray-900/40 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-purple-600/20 border border-purple-500 flex items-center justify-center">
                        <FaGamepad className="text-purple-200" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-yellow-100 truncate">{m.mode || '試合'} ・ {when}</div>
                        <div className="text-xs text-gray-400 truncate">対 {r.opponent?.handle_name ?? '不明'}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold">{m.winner_score ?? '-'} - {m.loser_score ?? '-'}</div>
                      <div className="text-xs text-gray-400">{m.status || ''}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-6 text-center text-gray-400">
              {matchFetchNote ? (
                <div className="inline-flex items-start gap-2 text-left max-w-lg">
                  <FaExclamationTriangle className="mt-1 text-yellow-400 flex-shrink-0" />
                  <div>{matchFetchNote}</div>
                </div>
              ) : 'まだ試合がありません'}
            </div>
          )}
        </div>

        {/* 便利リンク */}
        <div className="glass-card rounded-xl p-5 border border-purple-500/30 bg-gray-900/50">
          <h3 className="text-lg font-semibold text-purple-200 mb-3">便利リンク</h3>
          <ul className="space-y-2 text-sm">
            <li><Link href="/rankings" className="text-purple-300 hover:text-purple-200">ランキングを見る</Link></li>
            <li><Link href="/teams" className="text-purple-300 hover:text-purple-200">チーム一覧</Link></li>
            <li><Link href="/forgot-password" className="text-purple-300 hover:text-purple-200">パスワード変更（メール再設定）</Link></li>
          </ul>
          <div className="mt-6 p-3 rounded-lg border border-green-500/30 bg-green-500/10 text-green-300 text-sm">
            <FaCheckCircle className="inline mr-2" />
            拡張アイデア：チーム招待承認フロー、チームチャット、通知（招待/試合結果）など。
          </div>
        </div>
      </div>

      {/* ── アバター・ピッカー（DB一覧＋ページャ） ── */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" role="dialog" aria-modal>
          <div className="w-full max-w-3xl glass-card rounded-xl p-5 border border-purple-500/40 bg-gray-900">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-purple-200"><FaSearch className="inline mr-2" />アバターを選ぶ（自分の画像＋プリセット）</h3>
              <button onClick={() => setPickerOpen(false)} className="p-2 rounded hover:bg白/10"><FaTimes /></button>
            </div>

            {pickerLoading ? (
              <div className="p-8 text-center text-gray-400"><FaSpinner className="animate-spin inline mr-2" />読み込み中…</div>
            ) : pickerItems.length === 0 ? (
              <div className="p-6 text-center text-gray-400">{pickerMsg || '候補がありません。'}</div>
            ) : (
              <>
                <div className="mb-3"><Pager /></div>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                  {pageSlice.map((item) => (
                    <button key={`${item.source}-${item.fullPath}`} onClick={() => chooseFromStorage(item)} className="group relative rounded-xl overflow-hidden border border-purple-500/30 hover:border-purple-400" title={item.fullPath}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.url} alt={item.fullPath} className="w-full aspect-square object-cover" />
                      <div className="absolute左-1 top-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-gray-200">
                        {item.source === 'own' ? 'My' : 'Preset'}
                      </div>
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20" />
                    </button>
                  ))}
                </div>
                <div className="mt-4"><Pager /></div>
              </>
            )}

            <div className="mt-4 text-right">
              <button onClick={() => setPickerOpen(false)} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600">閉じる</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 試合登録モーダル ── */}
      {regOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4">
          <div className="w-full max-w-xl glass-card rounded-xl p-5 border border-purple-500/40 bg-gray-900">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text紫-200"><FaGamepad className="inline mr-2" />試合を登録</h3>
              <button onClick={() => setRegOpen(false)} className="p-2 rounded hover:bg白/10"><FaTimes/></button>
            </div>

            {regError && <div className="mb-3 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{regError}</div>}
            {regDone &&  <div className="mb-3 p-3 rounded-lg border border-green-500/30 bg-green-500/10 text-green-300 text-sm"><FaCheckCircle className="inline mr-2" />{regDone}</div>}

            <div className="space-y-4">
              {/* 相手検索 */}
              <div>
                <label className="block text-sm text-gray-300 mb-1">対戦相手</label>
                {oppo ? (
                  <div className="flex items-center justify-between rounded-lg bg-purple-900/30 border border-purple-500/30 px-3 py-2">
                    <span>{oppo.handle_name}</span>
                    <button onClick={() => setOppo(null)} className="text-sm px-2 py-1 rounded bg-gray-700 hover:bg-gray-600"><FaTimes/> 変更</button>
                  </div>
                ) : (
                  <>
                    <input
                      value={oppoQuery}
                      onChange={(e) => setOppoQuery(e.target.value)}
                      placeholder="ハンドルネームで検索"
                      className="w-full px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 outline-none"
                    />
                    {oppoOptions.length > 0 && (
                      <div className="mt-2 rounded-lg border border-purple-500/30 overflow-hidden">
                        {oppoOptions.map((p) => (
                          <button key={p.id} onClick={() => setOppo({ id: p.id, handle_name: p.handle_name })} className="w-full text-left px-3 py-2 bg-gray-900/60 hover:bg-gray-800">
                            {p.handle_name}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 日時・モード */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">試合日時</label>
                  <input type="datetime-local" value={regAt} onChange={(e) => setRegAt(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 outline-none"/>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">モード</label>
                  <select value={regMode} onChange={(e) => setRegMode(e.target.value as any)} className="w-full px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 outline-none">
                    <option value="SINGLES">SINGLES</option>
                    <option value="DOUBLES">DOUBLES</option>
                  </select>
                </div>
              </div>

              {/* スコア */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">自分のスコア</label>
                  <input type="number" min={0} value={regMy} onChange={(e) => setRegMy(parseInt(e.target.value || '0', 10))} className="w-full px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 outline-none"/>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">相手のスコア</label>
                  <input type="number" min={0} value={regOpp} onChange={(e) => setRegOpp(parseInt(e.target.value || '0', 10))} className="w-full px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 outline-none"/>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button onClick={() => setRegOpen(false)} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600">閉じる</button>
                <button onClick={submitRegister} disabled={regSaving || !oppo} className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-60 inline-flex items-center gap-2">
                  {regSaving ? <FaSpinner className="animate-spin" /> : <FaGamepad />} 登録
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
