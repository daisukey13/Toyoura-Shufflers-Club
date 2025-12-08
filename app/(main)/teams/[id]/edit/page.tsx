// app/(main)/teams/[id]/edit/page.tsx
'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  FaUsers,
  FaChevronLeft,
  FaSave,
  FaSpinner,
  FaTrashAlt,
  FaUserPlus,
  FaShieldAlt,
} from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type Team = {
  id: string;
  name: string;
  description?: string | null;
  created_by?: string | null;
  created_at?: string | null;
};

type Player = {
  id: string;
  handle_name: string;
  avatar_url?: string | null;
  ranking_points?: number | null;
  handicap?: number | null;
  is_active?: boolean | null;
};

type TeamMemberRow = {
  team_id: string;
  player_id: string;
  role?: string | null;
  joined_at?: string | null;
};

type MemberWithPlayer = TeamMemberRow & { player?: Player };

async function restGet<T = any>(path: string, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      apikey: ANON,
      Authorization: token ? `Bearer ${token}` : ANON,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as T;
}

export default function TeamEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const teamId = params?.id!;
  const supabase = useMemo(() => createClient(), []);

  // ログイン確認（サーバCookie基準）
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/auth/whoami', { cache: 'no-store' });
        const j = r.ok ? await r.json() : { authenticated: false };
        if (!cancelled) setAuthed(!!j?.authenticated);
      } catch {
        if (!cancelled) setAuthed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // タブ
  type TabKey = 'basic' | 'members';
  const [tab, setTab] = useState<TabKey>('basic');

  // 基本情報
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<Team | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // メンバー管理
  const [members, setMembers] = useState<MemberWithPlayer[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [occupiedMap, setOccupiedMap] = useState<Map<string, string>>(new Map()); // player_id -> team_id
  const [mLoading, setMLoading] = useState(false);
  const [mError, setMError] = useState<string | null>(null);

  // 役割ドラフト（入力欄の制御用）
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);

  // 追加UI
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const canSubmitBasic = useMemo(() => {
    const n = name.trim();
    return !saving && n.length >= 2 && n.length <= 40;
  }, [name, saving]);

  // 初期ロード
  const loadAll = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    setError(null);
    setMLoading(true);
    setMError(null);

    try {
      const { data: { session }, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;
      const token = session?.access_token;

      // チーム本体
      const teamRows = await restGet<Team[]>(`/rest/v1/teams?id=eq.${teamId}&select=*`, token);
      const t = teamRows?.[0] ?? null;
      setTeam(t);
      setName(t?.name ?? '');
      setDescription(t?.description ?? '');

      // メンバー行
      const tm = await restGet<TeamMemberRow[]>(
        `/rest/v1/team_members?team_id=eq.${teamId}&select=team_id,player_id,role,joined_at&order=joined_at.asc`,
        token
      );

      // 対象プレイヤー詳細
      const ids = tm.map((x) => x.player_id);
      let pmap = new Map<string, Player>();
      if (ids.length) {
        const inList = ids.map((id) => `"${id}"`).join(',');
        const ps = await restGet<Player[]>(
          `/rest/v1/players?id=in.(${inList})&select=id,handle_name,avatar_url,ranking_points,handicap,is_active`,
          token
        );
        pmap = new Map(ps.map((p) => [p.id, p]));
      }
      const enriched = tm.map((m) => ({ ...m, player: pmap.get(m.player_id) }));
      setMembers(enriched);

      // 役割ドラフト初期化
      const draftInit: Record<string, string> = {};
      for (const m of enriched) draftInit[m.player_id] = m.role ?? '';
      setRoleDrafts(draftInit);

      // 追加候補のための全プレイヤー（アクティブのみ）
      const all = await restGet<Player[]>(
        `/rest/v1/players?is_active=is.true&select=id,handle_name,avatar_url,ranking_points,handicap,is_active&order=ranking_points.desc`,
        token
      );
      setAllPlayers(all ?? []);

      // 現在の所属状況（1人1チーム）
      const occ = await restGet<TeamMemberRow[]>(
        `/rest/v1/team_members?select=player_id,team_id`,
        token
      );
      setOccupiedMap(new Map(occ.map((r) => [r.player_id, r.team_id])));
    } catch (e: any) {
      setError(e?.message || '読み込みに失敗しました');
    } finally {
      setLoading(false);
      setMLoading(false);
    }
  }, [teamId, supabase]);

  useEffect(() => {
    if (authed === true) loadAll();
  }, [authed, loadAll]);

  // 🔧 Hook は早期 return より前で呼ぶ
  const eligiblePlayers = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return allPlayers
      .filter((p) => {
        // すでにこのチームのメンバーは除外
        if (members.find((m) => m.player_id === p.id)) return false;
        // 他チーム所属は除外
        const tId = occupiedMap.get(p.id);
        if (tId && tId !== teamId) return false;
        // 検索
        if (!kw) return true;
        return p.handle_name.toLowerCase().includes(kw);
      })
      .slice(0, 30); // 表示上限
  }, [allPlayers, occupiedMap, members, teamId, search]);

  // 未ログイン
  if (authed === false) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 text-white">
        <div className="text-center">
          <p className="mb-4">チーム編集にはログインが必要です。</p>
          <Link href={`/login?redirect=/teams/${teamId}/edit`} className="underline text-purple-300">
            ログインへ移動
          </Link>
        </div>
      </div>
    );
  }

  // 判定中
  if (authed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="w-full max-w-2xl glass-card rounded-xl p-8">
          <div className="h-6 w-48 bg-white/10 rounded mb-6" />
          <div className="h-40 bg-white/10 rounded" />
        </div>
      </div>
    );
  }

  // 保存（基本）
  const onSaveBasic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitBasic || !teamId) return;

    setSaving(true);
    setError(null);
    setSavedMsg(null);

    try {
      const { data: { session }, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;
      if (!session) throw new Error('ログインが必要です');
      const token = session.access_token;

      const res = await fetch(`${BASE}/rest/v1/teams?id=eq.${teamId}`, {
        method: 'PATCH',
        headers: {
          apikey: ANON,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      });

      if (!res.ok) {
        const t = await res.text();
        if (/permission denied|policy/i.test(t)) {
          throw new Error('編集権限がありません（作成者または管理者のみ編集可能）');
        }
        if (/23505|duplicate key value|unique constraint/i.test(t)) {
          throw new Error('同名のチームが既に存在します。別の名前にしてください。');
        }
        throw new Error(t || '保存に失敗しました');
      }

      setSavedMsg('保存しました');
      setTimeout(() => router.replace(`/teams/${teamId}`), 700);
    } catch (e: any) {
      setError(e?.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // ===== メンバー管理 =====

  const onAddMember = async (playerId: string) => {
    if (!playerId) return;
    if (members.length >= 4) {
      setMError('このチームは最大4名までです');
      return;
    }
    // 所属チェック
    const tId = occupiedMap.get(playerId);
    if (tId && tId !== teamId) {
      setMError('このプレイヤーは別のチームに所属しています');
      return;
    }

    setAdding(true);
    setMError(null);
    try {
      const { data: { session }, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;
      if (!session) throw new Error('ログインが必要です');
      const token = session.access_token;

      const res = await fetch(`${BASE}/rest/v1/team_members`, {
        method: 'POST',
        headers: {
          apikey: ANON,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ team_id: teamId, player_id: playerId }),
      });
      if (!res.ok) {
        const t = await res.text();
        if (/permission denied|policy/i.test(t)) {
          throw new Error('メンバーを追加する権限がありません（作成者または管理者のみ）');
        }
        if (/unique|duplicate|already|23505/i.test(t)) {
          throw new Error('このプレイヤーは既にチームに所属しています');
        }
        throw new Error(t || '追加に失敗しました');
      }

      // 画面反映
      const added = await res.json();
      const pid = added?.[0]?.player_id ?? playerId;

      // プレイヤー詳細を取得
      const ps = await restGet<Player[]>(
        `/rest/v1/players?id=eq.${pid}&select=id,handle_name,avatar_url,ranking_points,handicap,is_active`,
        token
      );
      const player = ps?.[0];

      setMembers((cur) => [...cur, { team_id: teamId, player_id: pid, player }]);

      // 所属マップ＆役割ドラフトを同期
      setOccupiedMap((m) => {
        const cp = new Map(m);
        cp.set(pid, teamId);
        return cp;
      });
      setRoleDrafts((d) => ({ ...d, [pid]: '' }));
      setSearch('');
    } catch (e: any) {
      setMError(e?.message || '追加に失敗しました');
    } finally {
      setAdding(false);
    }
  };

  const onSaveRole = async (playerId: string) => {
    const role = (roleDrafts[playerId] ?? '').trim();
    setSavingRoleId(playerId);
    setMError(null);
    try {
      const { data: { session }, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;
      if (!session) throw new Error('ログインが必要です');
      const token = session.access_token;

      const res = await fetch(
        `${BASE}/rest/v1/team_members?team_id=eq.${teamId}&player_id=eq.${playerId}`,
        {
          method: 'PATCH',
          headers: {
            apikey: ANON,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify({ role: role || null }),
        }
      );

      if (!res.ok) {
        const t = await res.text();
        if (/permission denied|policy/i.test(t)) {
          throw new Error('役割を変更する権限がありません');
        }
        throw new Error(t || '更新に失敗しました');
      }

      setMembers((cur) =>
        cur.map((m) => (m.player_id === playerId ? { ...m, role: role || null } : m))
      );
    } catch (e: any) {
      setMError(e?.message || '更新に失敗しました');
    } finally {
      setSavingRoleId(null);
    }
  };

  const onRemoveMember = async (playerId: string) => {
    if (members.length <= 2) {
      setMError('チームは最低2名必要です（削除できません）');
      return;
    }
    setRemovingId(playerId);
    setMError(null);

    try {
      const { data: { session }, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;
      if (!session) throw new Error('ログインが必要です');
      const token = session.access_token;

      const res = await fetch(
        `${BASE}/rest/v1/team_members?team_id=eq.${teamId}&player_id=eq.${playerId}`,
        {
          method: 'DELETE',
          headers: {
            apikey: ANON,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!res.ok) {
        const t = await res.text();
        if (/permission denied|policy/i.test(t)) {
          throw new Error('メンバーを削除する権限がありません');
        }
        throw new Error(t || '削除に失敗しました');
      }

      setMembers((cur) => cur.filter((m) => m.player_id !== playerId));
      setOccupiedMap((m) => {
        const cp = new Map(m);
        if (cp.get(playerId) === teamId) cp.delete(playerId);
        return cp;
      });
      setRoleDrafts((d) => {
        const nd = { ...d };
        delete nd[playerId];
        return nd;
      });
    } catch (e: any) {
      setMError(e?.message || '削除に失敗しました');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8">
        {/* 戻る */}
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 text-purple-300 hover:text-purple-200"
          >
            <FaChevronLeft /> 戻る
          </button>
        </div>

        {loading ? (
          <div className="max-w-3xl mx-auto glass-card rounded-xl p-8">
            <div className="h-6 w-48 bg-white/10 rounded mb-6" />
            <div className="h-40 bg-white/10 rounded" />
          </div>
        ) : !team ? (
          <div className="max-w-3xl mx-auto glass-card rounded-xl p-8 border border-purple-500/30 bg-gray-900/50">
            チームが見つかりませんでした。
          </div>
        ) : (
          <div className="max-w-3xl mx-auto">
            {/* ヘッダー */}
            <div className="text-center mb-6">
              <div className="inline-block p-4 mb-4 rounded-full bg-gradient-to-br from-purple-400/20 to-pink-600/20">
                <FaUsers className="text-4xl text-purple-300" />
              </div>
              <h1 className="text-3xl font-bold text-yellow-100">チーム編集</h1>
              <p className="text-gray-400 mt-1">ID: {team.id}</p>
            </div>

            {/* タブ */}
            <div className="mb-6 flex justify-center">
              <div className="inline-flex rounded-lg overflow-hidden shadow-lg">
                <button
                  onClick={() => setTab('basic')}
                  className={`px-5 py-2.5 font-medium transition-all ${
                    tab === 'basic'
                      ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                      : 'bg-purple-900/30 text-gray-300 hover:text-white'
                  }`}
                  aria-pressed={tab === 'basic'}
                >
                  基本情報
                </button>
                <button
                  onClick={() => setTab('members')}
                  className={`px-5 py-2.5 font-medium transition-all ${
                    tab === 'members'
                      ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                      : 'bg-purple-900/30 text-gray-300 hover:text-white'
                  }`}
                  aria-pressed={tab === 'members'}
                >
                  メンバー管理
                </button>
              </div>
            </div>

            {/* タブ内容 */}
            {tab === 'basic' && (
              <form onSubmit={onSaveBasic} className="space-y-6">
                <div className="glass-card rounded-2xl p-6 border border-purple-500/30">
                  <label className="block text-sm font-medium text-purple-300 mb-2">
                    チーム名（必須）
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-900/60 border border-purple-500/30 rounded-lg text-yellow-50 focus:outline-none focus:border-purple-400"
                  />
                  <p className="text-xs text-gray-500 mt-1">2〜40文字。重複不可。</p>
                </div>

                <div className="glass-card rounded-2xl p-6 border border-purple-500/30">
                  <label className="block text-sm font-medium text-purple-300 mb-2">
                    紹介文（任意）
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    className="w-full px-4 py-3 bg-gray-900/60 border border-purple-500/30 rounded-lg text-yellow-50 focus:outline-none focus:border-purple-400"
                  />
                </div>

                {error && (
                  <div className="glass-card rounded-lg p-4 border border-red-500/50 bg-red-500/10">
                    <p className="text-red-400">{error}</p>
                  </div>
                )}
                {savedMsg && (
                  <div className="glass-card rounded-lg p-4 border border-green-500/50 bg-green-500/10">
                    <p className="text-green-400">{savedMsg}</p>
                  </div>
                )}

                <div className="flex justify-center gap-3">
                  <Link
                    href={`/teams/${teamId}`}
                    className="px-6 py-3 rounded-xl bg-gray-700 hover:bg-gray-600"
                  >
                    プロフィールへ戻る
                  </Link>
                  <button
                    type="submit"
                    disabled={!canSubmitBasic}
                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {saving ? <FaSpinner className="animate-spin" /> : <FaSave />}
                    保存する
                  </button>
                </div>
              </form>
            )}

            {tab === 'members' && (
              <div className="space-y-6">
                {/* ルール説明 */}
                <div className="glass-card rounded-2xl p-4 border border-blue-500/30 bg-blue-900/10 text-sm text-blue-300">
                  ・チームは <b>2人以上4人まで</b>。<br />
                  ・<b>プレーヤーは1つのチームのみに所属</b>できます（他チーム所属者は追加できません）。
                </div>

                {/* メンバー一覧 */}
                <div className="glass-card rounded-2xl p-6 border border-purple-500/30">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-yellow-100">
                      現在のメンバー（{members.length}人）
                    </h2>
                    <span className="text-xs text-gray-400">最小2 / 最大4</span>
                  </div>

                  <div className="space-y-3">
                    {members.map((m) => (
                      <div
                        key={m.player_id}
                        className="flex items-center gap-3 p-3 rounded-xl bg-gray-900/50 border border-purple-500/20"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={m.player?.avatar_url || '/default-avatar.png'}
                          alt={m.player?.handle_name || ''}
                          className="w-10 h-10 rounded-full border-2 border-purple-500 object-cover"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-yellow-100 truncate">
                            {m.player?.handle_name ?? '(不明)'}
                          </p>
                          <p className="text-xs text-gray-500">
                            RP {m.player?.ranking_points ?? '-'} / HC {m.player?.handicap ?? '-'}
                          </p>
                        </div>

                        {/* 役割編集（制御コンポーネント） */}
                        <div className="flex items-center gap-2">
                          <FaShieldAlt className="text-purple-300 hidden sm:block" />
                          <input
                            value={roleDrafts[m.player_id] ?? ''}
                            onChange={(e) =>
                              setRoleDrafts((d) => ({ ...d, [m.player_id]: e.target.value }))
                            }
                            maxLength={32}
                            placeholder="役割（任意: 主将 等）"
                            className="px-3 py-2 bg-gray-800/60 border border-purple-500/30 rounded-lg text-sm focus:outline-none focus:border-purple-400"
                          />
                          <button
                            onClick={() => onSaveRole(m.player_id)}
                            disabled={savingRoleId === m.player_id}
                            className="px-3 py-2 rounded-lg bg-purple-700/60 hover:bg-purple-700 text-white text-sm inline-flex items-center gap-2 disabled:opacity-50"
                            title="役割を保存"
                          >
                            {savingRoleId === m.player_id ? (
                              <FaSpinner className="animate-spin" />
                            ) : (
                              <FaSave />
                            )}
                            保存
                          </button>
                        </div>

                        <button
                          onClick={() => onRemoveMember(m.player_id)}
                          disabled={removingId === m.player_id}
                          className="ml-2 px-3 py-2 rounded-lg bg-red-700/70 hover:bg-red-700 text-white inline-flex items-center gap-2 disabled:opacity-50"
                          title="このメンバーを外す"
                        >
                          {removingId === m.player_id ? (
                            <FaSpinner className="animate-spin" />
                          ) : (
                            <FaTrashAlt />
                          )}
                          削除
                        </button>
                      </div>
                    ))}

                    {!members.length && (
                      <div className="p-4 rounded-xl border border-purple-500/30 bg-gray-900/50 text-gray-300">
                        メンバーがいません。下のフォームから追加してください。
                      </div>
                    )}
                  </div>
                </div>

                {/* 追加フォーム */}
                <div className="glass-card rounded-2xl p-6 border border-green-500/30">
                  <h3 className="text-lg font-semibold text-yellow-100 mb-3">メンバーを追加</h3>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="ハンドルネームで検索（未所属のみ表示）"
                        className="w-full px-4 py-3 bg-gray-900/60 border border-purple-500/30 rounded-lg text-yellow-50 focus:outline-none focus:border-purple-400"
                      />
                    </div>
                  </div>

                  <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-purple-500/20">
                    {mLoading ? (
                      <div className="p-4 text-center text-gray-400">読み込み中...</div>
                    ) : eligiblePlayers.length ? (
                      eligiblePlayers.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between p-3 bg-gray-900/50 border-b border-purple-500/10"
                        >
                          <div className="flex items-center gap-3">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={p.avatar_url || '/default-avatar.png'}
                              alt={p.handle_name}
                              className="w-9 h-9 rounded-full border-2 border-purple-500 object-cover"
                            />
                            <div>
                              <p className="font-semibold text-yellow-100">{p.handle_name}</p>
                              <p className="text-xs text-gray-500">
                                RP {p.ranking_points ?? '-'} / HC {p.handicap ?? '-'}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => onAddMember(p.id)}
                            disabled={adding || members.length >= 4}
                            className="px-3 py-2 rounded-lg bg-gradient-to-r from-green-600 to-emerald-600 text-white inline-flex items-center gap-2 disabled:opacity-50"
                          >
                            {adding ? <FaSpinner className="animate-spin" /> : <FaUserPlus />}
                            追加
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="p-4 text-center text-gray-400">
                        未所属で該当するプレーヤーが見つかりません
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-gray-500 mt-3">
                    ※ 他チーム所属者は表示されません。<br />
                    ※ 最低2名・最大4名の制約があります。
                  </p>
                </div>

                {mError && (
                  <div className="glass-card rounded-lg p-4 border border-red-500/50 bg-red-500/10">
                    <p className="text-red-400">{mError}</p>
                  </div>
                )}

                <div className="flex justify-center gap-3">
                  <Link
                    href={`/teams/${teamId}`}
                    className="px-6 py-3 rounded-xl bg-gray-700 hover:bg-gray-600"
                  >
                    プロフィールへ戻る
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
