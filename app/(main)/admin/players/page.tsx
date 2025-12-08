// app/(main)/admin/players/page.tsx
'use client';

import { useEffect, useMemo, useState, memo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { FaSearch, FaUserEdit, FaUserPlus, FaToggleOn, FaToggleOff } from 'react-icons/fa';

const supabase = createClient();

type PlayerRow = {
  id: string;
  handle_name: string | null;
  avatar_url: string | null;
  ranking_points: number | null;
  handicap: number | null;
  is_active?: boolean | null;
  is_admin?: boolean | null;
  created_at?: string | null;

  // もし将来追加したら拾える（無くてもOK）
  is_dummy?: boolean | null;
  memo?: string | null;
};

function AvatarImg({
  src,
  alt,
  className,
  size,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  size?: number;
}) {
  const s = size ?? 36;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src || '/default-avatar.png'}
      alt={alt || ''}
      width={s}
      height={s}
      className={className}
      loading="lazy"
      decoding="async"
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).src = '/default-avatar.png';
      }}
    />
  );
}

/** ダミー強調：斜めリボン */
const DummyRibbon = memo(function DummyRibbon() {
  return (
    <div className="absolute -left-10 top-4 rotate-[-18deg] pointer-events-none">
      <div
        className="px-10 py-1.5 text-[11px] font-extrabold tracking-widest text-gray-900
        bg-gradient-to-r from-amber-300 via-yellow-300 to-amber-400
        shadow-lg shadow-amber-500/30 border border-amber-200/70"
      >
        DUMMY
      </div>
    </div>
  );
});

export default function AdminPlayersPage() {
  const router = useRouter();
  const { user, player, loading } = useAuth();

  const [rows, setRows] = useState<PlayerRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [q, setQ] = useState('');
  const [onlyActive, setOnlyActive] = useState<boolean>(true);
  const [hideAdmins, setHideAdmins] = useState<boolean>(true);
  const [onlyDummy, setOnlyDummy] = useState<boolean>(false);

  // 管理者ガード（動けばリダイレクト、動かなくても画面は描画）
  useEffect(() => {
    if (loading) return;

    // middleware でも /admin はログイン必須だけど、念のためUI側でもガード
    if (!user) {
      router.replace('/login?redirect=/admin/players');
      return;
    }

    // player が取れて「非管理者」と確定したら弾く
    if (player && !player.is_admin) {
      router.replace('/');
    }
  }, [loading, user, player, router]);

  const fetchPlayers = async () => {
    setBusy(true);
    setError('');
    try {
      const { data, error } = await supabase
        .from('players')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) throw error;
      setRows((data ?? []) as any);
    } catch (e: any) {
      setError(e?.message || '読み込みに失敗しました（RLS/権限/キー設定をご確認ください）');
    } finally {
      setBusy(false);
    }
  };

  // ▶ 認証 loading に関係なく、「ログインしていれば」一覧を取りにいく
  useEffect(() => {
    if (user) {
      void fetchPlayers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const filtered = useMemo(() => {
    const key = q.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (hideAdmins && r.is_admin) return false;
        if (onlyActive && r.is_active === false) return false;
        if (onlyDummy) {
          // is_dummy が無いプロジェクトでも壊れない（無い場合はヒットしない）
          if (!(r as any).is_dummy) return false;
        }
        if (!key) return true;
        const hn = (r.handle_name ?? '').toLowerCase();
        const id = (r.id ?? '').toLowerCase();
        return hn.includes(key) || id.includes(key);
      })
      .sort((a, b) => {
        const ac = String(a.created_at ?? '');
        const bc = String(b.created_at ?? '');
        if (ac && bc && ac !== bc) return ac < bc ? 1 : -1;
        return String(a.id).localeCompare(String(b.id));
      });
  }, [rows, q, onlyActive, hideAdmins, onlyDummy]);

  const toggleActive = async (id: string, next: boolean) => {
    setError('');
    try {
      const { error } = await supabase.from('players').update({ is_active: next }).eq('id', id);
      if (error) throw error;
      setRows((prev) => prev.map((p) => (p.id === id ? { ...p, is_active: next } : p)));
    } catch (e: any) {
      setError(e?.message || '更新に失敗しました（RLS/権限をご確認ください）');
    }
  };

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8 sm:py-10">
        <div className="glass-card rounded-2xl border border-purple-500/30 p-5 sm:p-6">
          {/* ヘッダー */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="text-xs text-gray-300 flex items-center gap-2">
                <span>ADMIN</span>
                {/* 認証状態の小さなインジケータ（デバッグ用） */}
                {loading && <span className="px-2 py-0.5 rounded-full bg-gray-800 text-[11px]">Auth 読み込み中…</span>}
                {!loading && user && !player && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-200 text-[11px]">
                    player 情報未取得
                  </span>
                )}
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-yellow-100">プレイヤー管理</h1>
              <p className="text-xs sm:text-sm text-gray-400 mt-1">
                ダミー含む登録内容の管理（一覧 / 検索 / 編集 / 無効化 / 新規作成）
              </p>
            </div>

            <div className="flex items-center gap-2 justify-end">
              <Link
                href="/admin/players/new"
                className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 transition-colors text-sm font-medium inline-flex items-center gap-2"
              >
                <FaUserPlus />
                新規作成
              </Link>
              <button
                onClick={fetchPlayers}
                className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors text-sm"
                disabled={busy}
              >
                再読込
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* 検索＋フィルタ */}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30">
                <FaSearch className="text-purple-300" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="名前 or ID で検索"
                  className="w-full bg-transparent outline-none text-sm text-gray-100 placeholder:text-gray-500"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 justify-start sm:justify-end">
              <button
                type="button"
                onClick={() => setOnlyActive((v) => !v)}
                className={`px-3 py-2 rounded-lg border text-xs transition-colors ${
                  onlyActive
                    ? 'border-green-500/40 bg-green-900/20 text-green-200'
                    : 'border-gray-500/30 bg-gray-900/20 text-gray-300'
                }`}
              >
                {onlyActive ? '有効のみ' : '全て'}
              </button>

              <button
                type="button"
                onClick={() => setHideAdmins((v) => !v)}
                className={`px-3 py-2 rounded-lg border text-xs transition-colors ${
                  hideAdmins
                    ? 'border-blue-500/40 bg-blue-900/20 text-blue-200'
                    : 'border-gray-500/30 bg-gray-900/20 text-gray-300'
                }`}
              >
                {hideAdmins ? '管理者除外' : '管理者含む'}
              </button>

              <button
                type="button"
                onClick={() => setOnlyDummy((v) => !v)}
                className={`px-3 py-2 rounded-lg border text-xs transition-colors ${
                  onlyDummy
                    ? 'border-amber-500/40 bg-amber-900/20 text-amber-200'
                    : 'border-gray-500/30 bg-gray-900/20 text-gray-300'
                }`}
                title="players.is_dummy が存在する場合のみ機能します"
              >
                {onlyDummy ? 'ダミーのみ' : 'ダミーOFF'}
              </button>
            </div>
          </div>

          {/* 一覧 */}
          <div className="mt-5 space-y-2">
            {busy && <div className="text-sm text-gray-400">読み込み中...</div>}

            {!busy && filtered.length === 0 && (
              <div className="text-sm text-gray-400">該当するプレイヤーがいません。</div>
            )}

            {filtered.map((p) => {
              const active = p.is_active !== false;
              const isDummy = !!(p as any).is_dummy;

              return (
                <div
                  key={p.id}
                  className={[
                    'relative glass-card rounded-xl border p-3 sm:p-4 transition-colors overflow-hidden',
                    'hover:bg-purple-900/10',
                    !isDummy ? 'border-purple-500/30' : '',
                    isDummy
                      ? 'border-amber-500/60 bg-amber-900/10 shadow-lg shadow-amber-500/10'
                      : '',
                  ].join(' ')}
                >
                  {/* ダミー透かし */}
                  {isDummy && (
                    <div className="absolute right-3 bottom-2 text-5xl font-black text-amber-200/10 select-none pointer-events-none">
                      D
                    </div>
                  )}
                  {/* ダミー斜めリボン */}
                  {isDummy && <DummyRibbon />}

                  <div className="flex items-center gap-3">
                    <AvatarImg
                      src={p.avatar_url}
                      alt={p.handle_name ?? ''}
                      size={42}
                      className={[
                        'w-10 h-10 rounded-full border-2 object-cover',
                        isDummy ? 'border-amber-400' : 'border-purple-500',
                      ].join(' ')}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="font-semibold text-yellow-100 truncate">
                          {p.handle_name ?? '（名前未設定）'}
                        </div>

                        {isDummy && (
                          <span
                            className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold tracking-wide
                            border bg-gradient-to-r from-amber-400/25 to-yellow-400/20
                            border-amber-400/60 text-amber-200 shadow shadow-amber-500/10"
                          >
                            ★ ダミー
                          </span>
                        )}

                        {!active && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] border bg-red-900/20 border-red-500/40 text-red-200">
                            無効
                          </span>
                        )}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-300">
                        <span className="px-2 py-0.5 rounded-full bg-purple-900/30 border border-purple-500/30 text-purple-200">
                          RP <b className="text-yellow-100 ml-1">{p.ranking_points ?? '—'}</b>
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-purple-900/30 border border-purple-500/30 text-purple-200">
                          HC <b className="text-yellow-100 ml-1">{p.handicap ?? '—'}</b>
                        </span>
                        <span className="text-[11px] text-gray-500 truncate">id: {p.id}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/players/${p.id}`}
                        className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors text-xs inline-flex items-center gap-2"
                      >
                        <FaUserEdit />
                        編集
                      </Link>

                      <button
                        onClick={() => toggleActive(p.id, !active)}
                        className={`px-3 py-2 rounded-lg transition-colors text-xs inline-flex items-center gap-2 ${
                          active ? 'bg-gray-700 hover:bg-gray-600' : 'bg-green-700 hover:bg-green-600'
                        }`}
                        title={active ? '無効化' : '有効化'}
                      >
                        {active ? <FaToggleOff /> : <FaToggleOn />}
                        {active ? '無効' : '有効'}
                      </button>
                    </div>
                  </div>

                  {(p as any).memo && (
                    <div className="mt-2 text-xs text-gray-400 border-l-4 border-purple-500/40 pl-2">
                      {(p as any).memo}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-6 text-right text-xs">
            <Link href="/admin/dashboard" className="text-purple-300 hover:text-purple-200 underline">
              ← 管理ダッシュボードへ
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
