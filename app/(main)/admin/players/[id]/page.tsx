'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  FaArrowLeft,
  FaSave,
  FaTrashAlt,
  FaImage,
  FaUpload,
  FaFolderOpen,
  FaSyncAlt,
  FaCheck,
  FaLink,
} from 'react-icons/fa';

const supabase = createClient();

// ★ Storage バケット名
const AVATAR_BUCKET = 'avatars';

// ★ 見せたいフォルダ候補
const AVATAR_LIBRARY_PREFIXES = [
  'presets',
  'preset',
  'avatars',
  'public',
  'default',
  '',
] as const;

type PlayerRow = {
  id: string;
  handle_name: string | null;
  avatar_url: string | null;
  address?: string | null;
  ranking_points?: number | null;
  handicap?: number | null;
  is_active?: boolean | null;
  is_admin?: boolean | null;
  created_at?: string | null;

  is_dummy?: boolean | null;
  memo?: string | null;
};

type StorageItem = {
  name: string;
  id?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  metadata?: any;
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
  const s = size ?? 64;
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

function toNumOrNull(v: any) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isLikelyImage(name: string) {
  const lower = name.toLowerCase();
  return (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.svg')
  );
}

function joinPath(prefix: string, name: string) {
  if (!prefix) return name;
  return `${prefix.replace(/\/+$/g, '')}/${name.replace(/^\/+/g, '')}`;
}

export default function AdminPlayerEditPage() {
  const router = useRouter();
  const params = useParams();
  const playerId = typeof params?.id === 'string' ? params.id : '';

  // ✅ useAuth を使わない（ここが最重要：AuthContextの詰まりから独立させる）
  const [authChecking, setAuthChecking] = useState(true);
  const [authUserId, setAuthUserId] = useState<string>('');
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState<string>('');

  const [busy, setBusy] = useState(false);
  const [loadingRow, setLoadingRow] = useState(true);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  const [row, setRow] = useState<PlayerRow | null>(null);

  // 編集フォーム
  const [handleName, setHandleName] = useState('');
  const [address, setAddress] = useState('');
  const [rankingPoints, setRankingPoints] = useState<string>('0');
  const [handicap, setHandicap] = useState<string>('0');
  const [isActive, setIsActive] = useState<boolean>(true);
  const [isDummy, setIsDummy] = useState<boolean>(false);
  const [memoText, setMemoText] = useState<string>('');

  // アバター
  const [avatarDraft, setAvatarDraft] = useState<string>(''); // 保存対象
  const [avatarUploadBusy, setAvatarUploadBusy] = useState(false);
  const [avatarUploadError, setAvatarUploadError] = useState('');

  // ライブラリ
  const [libPrefix, setLibPrefix] =
    useState<(typeof AVATAR_LIBRARY_PREFIXES)[number]>('presets');
  const [libBusy, setLibBusy] = useState(false);
  const [libError, setLibError] = useState('');
  const [libItems, setLibItems] = useState<
    Array<{ path: string; url: string; name: string }>
  >([]);
  const [libOffset, setLibOffset] = useState(0);
  const [libHasMore, setLibHasMore] = useState(true);
  const [libQ, setLibQ] = useState('');
  const [useSignedUrls, setUseSignedUrls] = useState(false);

  // ✅ 認証チェック（このページ単体で完結）
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setAuthChecking(true);
      setAuthError('');

      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;

        const u = data?.user;
        if (!u) {
          if (!cancelled) {
            setAuthUserId('');
            setIsAdmin(null);
          }
          router.replace(`/login?redirect=/admin/players/${encodeURIComponent(playerId)}`);
          return;
        }

        if (cancelled) return;
        setAuthUserId(u.id);

        // 管理者判定（players.id が auth.uid() と同じ前提）
        const { data: meRow, error: meErr } = await supabase
          .from('players')
          .select('is_admin')
          .eq('id', u.id)
          .maybeSingle();

        // ここで失敗しても、表示自体は止めない（RLSで弾かれるなら保存時にエラーになる）
        if (!cancelled) {
          if (!meErr && meRow) setIsAdmin(!!(meRow as any).is_admin);
          else setIsAdmin(null);
        }

        // isAdmin が false と確定したら弾く
        if (!cancelled && meRow && !(meRow as any).is_admin) {
          router.replace('/');
          return;
        }
      } catch (e: any) {
        if (!cancelled) setAuthError(e?.message || 'Auth確認に失敗しました');
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, playerId]);

  const canEdit = useMemo(() => {
    // ✅ isAdmin が null(未確定)でも “表示/保存ボタンを殺さない”
    // ダメならUPDATEでRLSエラーになるので、UIは動かす
    if (!authUserId) return false;
    if (isAdmin === false) return false;
    return true;
  }, [authUserId, isAdmin]);

  // プレーヤー取得（ログインが確定してから）
  useEffect(() => {
    if (!playerId) return;
    if (!authUserId) return;

    let cancelled = false;

    (async () => {
      setError('');
      setSavedMsg('');
      setLoadingRow(true);
      setRow(null);

      try {
        const { data, error } = await supabase
          .from('players')
          .select('*')
          .eq('id', playerId)
          .maybeSingle();

        if (error) throw error;
        if (!data) throw new Error('プレーヤーが見つかりませんでした');

        if (cancelled) return;

        const p = data as any as PlayerRow;
        setRow(p);

        setHandleName(p.handle_name ?? '');
        setAddress((p as any).address ?? '');
        setRankingPoints(String(p.ranking_points ?? 0));
        setHandicap(String(p.handicap ?? 0));
        setIsActive(p.is_active !== false);
        setIsDummy(!!(p as any).is_dummy);
        setMemoText((p as any).memo ?? '');
        setAvatarDraft(p.avatar_url ?? '');
      } catch (e: any) {
        if (!cancelled) setError(e?.message || '読み込みに失敗しました');
      } finally {
        if (!cancelled) setLoadingRow(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [playerId, authUserId]);

  // 画像アップロード
  const onUploadAvatar = async (file: File) => {
    setAvatarUploadError('');
    setSavedMsg('');

    if (!playerId) return;

    if (!file.type.startsWith('image/')) {
      setAvatarUploadError('画像ファイルを選択してください');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setAvatarUploadError('画像サイズが大きすぎます（最大4MB）');
      return;
    }

    setAvatarUploadBusy(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const safeExt = ext.length <= 6 ? ext : 'png';
      const path = `players/${playerId}/${Date.now()}.${safeExt}`;

      const up = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, {
        upsert: true,
        contentType: file.type,
      });
      if (up.error) throw up.error;

      const pub = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      const publicUrl = pub?.data?.publicUrl;

      if (publicUrl) {
        setAvatarDraft(publicUrl);
      } else {
        const signed = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 60 * 60);
        if (signed.error) throw signed.error;
        const signedUrl = signed.data?.signedUrl;
        if (!signedUrl) throw new Error('URLを取得できませんでした（Storage設定をご確認ください）');
        setAvatarDraft(signedUrl);
      }
    } catch (e: any) {
      setAvatarUploadError(e?.message || 'アップロードに失敗しました');
    } finally {
      setAvatarUploadBusy(false);
    }
  };

  const buildStorageUrl = async (path: string) => {
    if (!useSignedUrls) {
      const pub = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      return pub?.data?.publicUrl || '';
    }
    const signed = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 60 * 60);
    if (signed.error) throw signed.error;
    return signed.data?.signedUrl || '';
  };

  const loadLibrary = async (reset = false) => {
    setLibError('');
    setLibBusy(true);

    try {
      const limit = 60;
      const nextOffset = reset ? 0 : libOffset;

      const { data, error } = await supabase.storage.from(AVATAR_BUCKET).list(libPrefix, {
        limit,
        offset: nextOffset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;

      const items = (data ?? [])
        .filter((x: StorageItem) => !!x?.name && isLikelyImage(x.name))
        .map((x: StorageItem) => ({ name: x.name, path: joinPath(libPrefix, x.name) }));

      const withUrl: Array<{ path: string; url: string; name: string }> = [];
      for (const it of items) {
        try {
          const url = await buildStorageUrl(it.path);
          if (url) withUrl.push({ ...it, url });
        } catch {}
      }

      setLibItems((prev) => (reset ? withUrl : [...prev, ...withUrl]));
      setLibOffset(nextOffset + limit);
      setLibHasMore((data ?? []).length >= limit);
    } catch (e: any) {
      setLibError(e?.message || 'アバター一覧の取得に失敗しました');
      setLibHasMore(false);
    } finally {
      setLibBusy(false);
    }
  };

  useEffect(() => {
    if (!canEdit) return;
    setLibItems([]);
    setLibOffset(0);
    setLibHasMore(true);
    void loadLibrary(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, libPrefix, useSignedUrls]);

  const libFiltered = useMemo(() => {
    const key = libQ.trim().toLowerCase();
    if (!key) return libItems;
    return libItems.filter(
      (x) => x.name.toLowerCase().includes(key) || x.path.toLowerCase().includes(key)
    );
  }, [libItems, libQ]);

  const onSave = async () => {
    setError('');
    setSavedMsg('');
    setAvatarUploadError('');

    if (!row) return;
    if (!canEdit) return;

    setBusy(true);
    try {
      const payload: any = {
        handle_name: handleName.trim() || null,
        avatar_url: avatarDraft.trim() || null,
        address: address.trim() || null,
        ranking_points: toNumOrNull(rankingPoints),
        handicap: toNumOrNull(handicap),
        is_active: isActive,
        is_dummy: isDummy,
        memo: memoText.trim() || null,
      };

      const { error } = await supabase.from('players').update(payload).eq('id', row.id);
      if (error) throw error;

      setSavedMsg('保存しました');
      setRow((prev) => (prev ? { ...prev, ...payload } : prev));
    } catch (e: any) {
      setError(e?.message || '保存に失敗しました（RLS/権限をご確認ください）');
    } finally {
      setBusy(false);
    }
  };

  const onClearAvatar = () => setAvatarDraft('');

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8 sm:py-10">
        <div className="flex items-center justify-between mb-4">
          <Link
            href="/admin/players"
            className="text-purple-300 hover:text-purple-200 underline text-sm inline-flex items-center gap-2"
          >
            <FaArrowLeft /> 一覧へ戻る
          </Link>

          <button
            onClick={onSave}
            disabled={!canEdit || busy || loadingRow}
            className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 transition-colors text-sm inline-flex items-center gap-2"
          >
            <FaSave />
            保存
          </button>
        </div>

        <div className="glass-card rounded-2xl border border-purple-500/30 p-5 sm:p-6">
          <div className="text-xs text-gray-300 flex items-center gap-2">
            <span>ADMIN</span>
            {authChecking && (
              <span className="px-2 py-0.5 rounded-full bg-gray-800 text-[11px]">
                Auth 読み込み中…
              </span>
            )}
            {!authChecking && authUserId && isAdmin === null && (
              <span className="px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-200 text-[11px]">
                admin判定未確定（RLSで制御）
              </span>
            )}
            {!authChecking && isAdmin === true && (
              <span className="px-2 py-0.5 rounded-full bg-green-900/30 text-green-200 text-[11px]">
                管理者
              </span>
            )}
          </div>

          <h1 className="text-xl sm:text-2xl font-bold text-yellow-100 mt-1">プレーヤー編集</h1>

          {authError && (
            <div className="mt-4 p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-sm">
              {authError}
            </div>
          )}
          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-sm">
              {error}
            </div>
          )}
          {savedMsg && (
            <div className="mt-4 p-3 rounded-lg bg-green-500/15 border border-green-500/30 text-green-200 text-sm">
              {savedMsg}
            </div>
          )}

          {loadingRow ? (
            <div className="mt-6 text-gray-300">読み込み中...</div>
          ) : !row ? (
            <div className="mt-6 text-gray-300">プレーヤーが見つかりません。</div>
          ) : (
            <>
              {/* アバター編集 */}
              <div className="mt-6 glass-card rounded-xl border border-purple-500/30 p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-yellow-100 inline-flex items-center gap-2">
                    <FaImage className="text-purple-300" />
                    アバター
                  </div>
                  <button
                    type="button"
                    onClick={onClearAvatar}
                    className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors text-xs inline-flex items-center gap-2"
                    title="アバターを未設定に戻す"
                  >
                    <FaTrashAlt />
                    クリア
                  </button>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-[120px,1fr] items-start">
                  <div className="flex flex-col items-center gap-2">
                    <AvatarImg
                      src={avatarDraft || row.avatar_url}
                      alt={handleName || row.handle_name || ''}
                      size={96}
                      className="w-24 h-24 rounded-full border-2 border-purple-500 object-cover"
                    />
                    <div className="text-[11px] text-gray-400">プレビュー</div>
                  </div>

                  <div className="space-y-3">
                    {/* URL */}
                    <div>
                      <div className="text-xs text-gray-300 mb-1 inline-flex items-center gap-2">
                        <FaLink className="opacity-80" />
                        アバターURL（貼り付けで差し替え）
                      </div>
                      <input
                        value={avatarDraft}
                        onChange={(e) => setAvatarDraft(e.target.value)}
                        placeholder="https://... もしくは空で未設定"
                        className="w-full px-3 py-2.5 bg-gray-900/60 border border-purple-500/30 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-400 text-sm"
                      />
                      <div className="mt-1 text-[11px] text-gray-500">
                        ※ Supabase Storage 公開URL / 署名URL / 外部URL どれでもOK
                      </div>
                    </div>

                    {/* アップロード */}
                    <div>
                      <div className="text-xs text-gray-300 mb-1">画像ファイルからアップロードして差し替え</div>
                      <label
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30 hover:border-purple-400/60 cursor-pointer text-sm"
                        title={`Supabase Storage: ${AVATAR_BUCKET}`}
                      >
                        <FaUpload className="text-purple-300" />
                        <span>{avatarUploadBusy ? 'アップロード中…' : '画像を選択'}</span>
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*"
                          disabled={avatarUploadBusy}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            void onUploadAvatar(f);
                            e.currentTarget.value = '';
                          }}
                        />
                      </label>

                      {avatarUploadError && (
                        <div className="mt-2 text-xs text-red-300 bg-red-500/15 border border-red-500/30 rounded-lg p-2">
                          {avatarUploadError}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Storage選択 */}
                <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="font-semibold text-yellow-100 inline-flex items-center gap-2">
                      <FaFolderOpen className="text-amber-300" />
                      Supabaseのアバターから選択
                    </div>

                    <div className="flex flex-wrap items-center gap-2 justify-end">
                      <select
                        value={libPrefix}
                        onChange={(e) => setLibPrefix(e.target.value as any)}
                        className="px-3 py-2 rounded-lg bg-gray-900/60 border border-purple-500/30 text-white text-xs focus:outline-none focus:border-purple-400"
                        title="Storage内のフォルダ"
                      >
                        {AVATAR_LIBRARY_PREFIXES.map((p) => (
                          <option key={p} value={p}>
                            {p === '' ? '(root)' : p}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => setUseSignedUrls((v) => !v)}
                        className={`px-3 py-2 rounded-lg border text-xs transition-colors ${
                          useSignedUrls
                            ? 'border-amber-500/50 bg-amber-900/20 text-amber-200'
                            : 'border-gray-500/30 bg-gray-900/20 text-gray-300'
                        }`}
                        title="Privateバケットで画像が出ない場合はON"
                      >
                        {useSignedUrls ? '署名URL:ON' : '署名URL:OFF'}
                      </button>

                      <button
                        type="button"
                        onClick={() => loadLibrary(true)}
                        disabled={libBusy}
                        className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 transition-colors text-xs inline-flex items-center gap-2"
                        title="一覧を再取得"
                      >
                        <FaSyncAlt />
                        再取得
                      </button>
                    </div>
                  </div>

                  <div className="mt-3">
                    <input
                      value={libQ}
                      onChange={(e) => setLibQ(e.target.value)}
                      placeholder="ファイル名で絞り込み…"
                      className="w-full px-3 py-2 rounded-lg bg-gray-900/60 border border-purple-500/30 text-white placeholder:text-gray-500 text-sm focus:outline-none focus:border-purple-400"
                    />
                  </div>

                  {libError && (
                    <div className="mt-3 text-xs text-red-300 bg-red-500/15 border border-red-500/30 rounded-lg p-2">
                      {libError}
                    </div>
                  )}

                  <div className="mt-4">
                    {libBusy && libItems.length === 0 ? (
                      <div className="text-sm text-gray-400">読み込み中...</div>
                    ) : libFiltered.length === 0 ? (
                      <div className="text-sm text-gray-400">画像が見つかりません。</div>
                    ) : (
                      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                        {libFiltered.map((it) => {
                          const selected = avatarDraft === it.url;
                          return (
                            <button
                              key={it.path}
                              type="button"
                              onClick={() => setAvatarDraft(it.url)}
                              className={[
                                'relative rounded-xl overflow-hidden border transition-all',
                                selected
                                  ? 'border-amber-400/80 ring-2 ring-amber-400/40'
                                  : 'border-white/10 hover:border-purple-400/60',
                              ].join(' ')}
                              title={it.path}
                            >
                              <div className="p-2 bg-gradient-to-b from-white/5 to-transparent">
                                <AvatarImg
                                  src={it.url}
                                  alt={it.name}
                                  size={56}
                                  className="w-12 h-12 sm:w-14 sm:h-14 rounded-full border border-purple-500/30 object-cover mx-auto"
                                />
                              </div>

                              {selected && (
                                <div className="absolute top-1 right-1 w-6 h-6 rounded-full bg-amber-400 text-gray-900 flex items-center justify-center shadow">
                                  <FaCheck className="text-xs" />
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-between">
                      <div className="text-[11px] text-gray-500 truncate">
                        bucket: <span className="text-gray-300">{AVATAR_BUCKET}</span> / prefix:{' '}
                        <span className="text-gray-300">{libPrefix === '' ? '(root)' : libPrefix}</span>
                      </div>

                      {libHasMore && (
                        <button
                          type="button"
                          disabled={libBusy}
                          onClick={() => loadLibrary(false)}
                          className="px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30 hover:border-purple-400/60 disabled:opacity-50 transition-colors text-xs"
                        >
                          {libBusy ? '読み込み中…' : 'さらに読み込む'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* フォーム */}
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="glass-card rounded-xl border border-purple-500/30 p-4 sm:p-5">
                  <div className="text-xs text-gray-300 mb-1">名前（handle_name）</div>
                  <input
                    value={handleName}
                    onChange={(e) => setHandleName(e.target.value)}
                    className="w-full px-3 py-2.5 bg-gray-900/60 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:border-purple-400 text-sm"
                  />
                  <div className="mt-3 text-xs text-gray-300 mb-1">地域（address）</div>
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full px-3 py-2.5 bg-gray-900/60 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:border-purple-400 text-sm"
                  />
                </div>

                <div className="glass-card rounded-xl border border-purple-500/30 p-4 sm:p-5">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-gray-300 mb-1">RP（ranking_points）</div>
                      <input
                        value={rankingPoints}
                        onChange={(e) => setRankingPoints(e.target.value)}
                        inputMode="numeric"
                        className="w-full px-3 py-2.5 bg-gray-900/60 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:border-purple-400 text-sm"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-gray-300 mb-1">HC（handicap）</div>
                      <input
                        value={handicap}
                        onChange={(e) => setHandicap(e.target.value)}
                        inputMode="numeric"
                        className="w-full px-3 py-2.5 bg-gray-900/60 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:border-purple-400 text-sm"
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsActive((v) => !v)}
                      className={`px-3 py-2 rounded-lg transition-colors text-xs inline-flex items-center gap-2 ${
                        isActive ? 'bg-gray-700 hover:bg-gray-600' : 'bg-green-700 hover:bg-green-600'
                      }`}
                      title={isActive ? '無効化' : '有効化'}
                    >
                      {isActive ? '有効' : '無効'}
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsDummy((v) => !v)}
                      className={`px-3 py-2 rounded-lg border text-xs transition-colors ${
                        isDummy
                          ? 'border-amber-500/60 bg-amber-900/20 text-amber-200'
                          : 'border-gray-500/30 bg-gray-900/20 text-gray-300'
                      }`}
                      title="players.is_dummy が存在する場合のみ有効"
                    >
                      {isDummy ? 'ダミーON' : 'ダミーOFF'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 glass-card rounded-xl border border-purple-500/30 p-4 sm:p-5">
                <div className="text-xs text-gray-300 mb-1">メモ（memo）</div>
                <textarea
                  value={memoText}
                  onChange={(e) => setMemoText(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2.5 bg-gray-900/60 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:border-purple-400 text-sm"
                />
                <div className="mt-2 text-[11px] text-gray-500">
                  id: <span className="text-gray-300">{row.id}</span>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  onClick={onSave}
                  disabled={!canEdit || busy}
                  className="px-5 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 transition-colors text-sm inline-flex items-center gap-2"
                >
                  <FaSave />
                  保存
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
