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
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(pickerItems.length / PAGE_SIZE)),
    [pickerItems.length]
  );
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

  /* ===== 認証 & 初期化 =====
     ✅ 最小修正ポイント:
     - getUser() は「セッション無し」で AuthSessionMissingError になり得るため、
       先に getSession() で判定してから進む
  */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.auth.getSession();

        // refresh token 系が壊れている可能性があるときは一度サインアウトしてから login へ
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
        // ここで認証が怪しい場合は login へ
        router.replace('/login?redirect=/mypage');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  /* ===== 最近試合取得（DB統一：match_players 起点に固定） =====
     ✅ 最小修正ポイント:
     - uid確定時も getUser() を使わず getSession() を使う（セッション無しで落ちない）
  */
  const fetchRecentMatches = useCallback(async () => {
    setMatchesLoading(true);
    setMatchFetchNote(null);

    try {
      // uid の確定（state優先 / 無ければ session から）
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
            'DBの外部キー（match_players.match_id → matches.id）が未設定、または Supabase の schema cache が未更新の可能性があります。Dashboard → Settings → API → Reload schema cache を試してください。'
          );
        } else {
          setMatchFetchNote(msg);
        }
        setRecentMatches([]);
        return;
      }

      // matches が埋め込まれている行だけにする
      const list = ((myRows ?? []) as any[]).filter((r) => !!r.matches);

      // match_date で必ず降順に並べ替える（DB側 order が効かなくてもOK）
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

      // 2) 相手（同じ match_id の “自分以外” をまとめて取る）
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

      const items: JoinedMatch[] = list.map((r: any) => {
        const mid = String(r.match_id);
        const names = g.get(mid) ?? [];
        const oppName = names.length ? names.join(' / ') : null;
        return {
          match_id: mid,
          side_no: Number(r.side_no ?? 0),
          matches: r.matches as MatchRow,
          opponent: oppName ? { id: 'multi', handle_name: oppName } : null,
        };
      });

      setRecentMatches(items);
    } catch (e: any) {
      console.error('[recent] fail', e);
      setRecentMatches([]);
      setMatchFetchNote(e?.message ?? '戦績取得に失敗しました');
    } finally {
      setMatchesLoading(false);
    }
  }, [userId]);

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

  /* ===== アバター: ピッカー（自分の画像＋プリセット） ===== */
  const openPicker = useCallback(async () => {
    if (!userId) return;
    setPickerOpen(true);
    setPickerLoading(true);
    setPickerMsg('');
    setPickerItems([]);
    setPickerPage(1);
    try {
      // 自分の画像
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

      // プリセット
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
        setPickerMsg(
          '候補がありません（自分でアップロードするか、管理者にプリセットの追加を依頼してください）。'
        );
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
      const { data, error } = await supabase
        .from('teams')
        .select('id, name')
        .ilike('name', `%${teamSearch.trim()}%`)
        .limit(10);
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
      const { count } = await supabase
        .from('team_members')
        .select('player_id', { count: 'exact', head: true })
        .eq('team_id', team.id);
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

  /* ============================ UI（※既存UIそのまま） ============================ */
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
                    'bg-purple-600 hover:bg-purple-700 disabled:opacity-60'
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
                    'bg-green-600 hover:bg-green-700 disabled:opacity-60'
                  )}
                >
                  {savingProfile ? <FaSpinner className="animate-spin" /> : <FaSave />} 保存
                </button>

                {/* JSONエクスポート（統一：match_players 起点） */}
                <button
                  type="button"
                  onClick={async () => {
                    if (!userId) return;

                    const payload: any = {
                      player: null,
                      match_players: [] as any[],
                      note: null as string | null,
                    };

                    try {
                      const { data: p } = await supabase.from('players').select('*').eq('id', userId).single();
                      payload.player = p || null;
                    } catch {}

                    try {
                      const { data: mps, error: mpErr } = await supabase
                        .from('match_players')
                        .select('match_id, side_no, matches:matches(*)')
                        .eq('player_id', userId)
                        .order('match_date', { foreignTable: 'matches', ascending: false })
                        .limit(200);

                      if (mpErr) throw mpErr;

                      const arr = (mps ?? []) as any[];
                      arr.sort((a, b) => {
                        const ta = a.matches?.match_date ? new Date(a.matches.match_date).getTime() : 0;
                        const tb = b.matches?.match_date ? new Date(b.matches.match_date).getTime() : 0;
                        return tb - ta;
                      });

                      payload.match_players = arr;
                    } catch (e: any) {
                      payload.note = e?.message ?? 'match_players fetch failed';
                      payload.match_players = [];
                    }

                    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `mydata-${userId.slice(0, 8)}.json`;
                    a.click();
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
              <button
                onClick={signOut}
                className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 inline-flex items-center gap-2"
              >
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
                <p className="text-sm text-gray-400 mb-3">
                  参加するチームを検索して選択してください（各チーム最大4名／複数チーム参加不可）。
                </p>
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

          {/* チーム試合登録タイル（SSG不可のため dynamic import） */}
          <TeamRegisterFile />
        </div>
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
                      {r.opponent && (
                        <div className="text-xs text-gray-400 truncate">vs {r.opponent.handle_name}</div>
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

        {/* 予備スペース／お知らせ等 */}
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
