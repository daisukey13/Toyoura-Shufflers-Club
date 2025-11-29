'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FaArrowLeft, FaEdit, FaSave, FaTimes, FaTrophy, FaPlus } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

type TournamentRow = {
  id: string;
  name: string | null;
  tournament_date: string | null;
  mode: string | null;
  description: string | null; // ← ここが無いなら notes に変えてOK
};

export default function AdminTournamentsPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [authz, setAuthz] = useState<'checking' | 'ok' | 'no'>('checking');

  const [tournaments, setTournaments] = useState<TournamentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 編集モーダル
  const [editing, setEditing] = useState<TournamentRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [saving, setSaving] = useState(false);

  /** 管理者チェック（既存運用に合わせて app_admins / players.is_admin を見る） */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/auth/whoami', { cache: 'no-store' });
        const j = r.ok ? await r.json() : { authenticated: false };
        if (!j?.authenticated) {
          router.replace('/login?redirect=/admin/tournaments');
          return;
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace('/login?redirect=/admin/tournaments');
          return;
        }

        const [adminResp, playerResp] = await Promise.all([
          (supabase.from('app_admins') as any).select('user_id').eq('user_id', user.id).maybeSingle(),
          (supabase.from('players') as any).select('is_admin').eq('id', user.id).maybeSingle(),
        ]);

        const isAdmin = Boolean(adminResp?.data?.user_id) || playerResp?.data?.is_admin === true;

        if (cancelled) return;
        setAuthz(isAdmin ? 'ok' : 'no');

        if (isAdmin) void fetchTournaments();
      } catch {
        if (!cancelled) setAuthz('no');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  const fetchTournaments = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await (supabase.from('tournaments') as any)
        .select('id,name,tournament_date,mode,description')
        .order('tournament_date', { ascending: false })
        .limit(200);

      if (error) throw error;
      setTournaments((data ?? []) as TournamentRow[]);
    } catch (e: any) {
      console.error('[admin/tournaments] fetch error:', e);
      setError('大会一覧の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  const openEdit = (t: TournamentRow) => {
    setEditing(t);
    setEditName(t.name ?? '');
    setEditDesc(t.description ?? '');
  };

  const closeEdit = () => {
    setEditing(null);
    setEditName('');
    setEditDesc('');
    setSaving(false);
  };

  const saveEdit = async () => {
    if (!editing) return;

    const name = editName.trim();
    const description = editDesc.trim();

    if (!name) {
      alert('大会名を入力してください。');
      return;
    }

    setSaving(true);
    try {
      const { error } = await (supabase.from('tournaments') as any)
        .update({
          name,
          description: description || null,
        })
        .eq('id', editing.id);

      if (error) throw error;

      // 画面反映
      setTournaments((prev) =>
        prev.map((t) => (t.id === editing.id ? { ...t, name, description: description || null } : t)),
      );

      closeEdit();
    } catch (e: any) {
      console.error('[admin/tournaments] update error:', e);
      alert(`更新に失敗しました: ${e?.message || 'unknown error'}`);
      setSaving(false);
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
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-full">
              <FaTrophy className="text-2xl" />
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              大会管理
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/admin/tournaments/new"
              prefetch={false}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 transition-colors"
              title="新規大会を作成"
            >
              <FaPlus />
              新規大会
            </Link>

            <Link
              href="/admin/dashboard"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-purple-500/40 hover:bg-purple-900/20 transition-colors"
            >
              <FaArrowLeft />
              ダッシュボードへ戻る
            </Link>
          </div>
        </div>

        {/* body */}
        <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-gray-300">一覧から「編集」で大会名・説明を更新できます。</div>

            <div className="flex items-center gap-2">
              <Link
                href="/admin/tournaments/new"
                prefetch={false}
                className="px-3 py-1 text-xs rounded-full border border-pink-500/40 hover:bg-pink-900/10 transition-colors inline-flex items-center gap-1.5"
                title="新規大会を作成"
              >
                <FaPlus />
                新規作成
              </Link>

              <button
                onClick={fetchTournaments}
                className="px-3 py-1 text-xs rounded-full border border-purple-500/40 hover:bg-purple-900/20 transition-colors"
              >
                再読み込み
              </button>
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-gray-400">読み込み中...</div>
          ) : error ? (
            <div className="text-sm text-red-400">{error}</div>
          ) : tournaments.length === 0 ? (
            <div className="text-sm text-gray-400">まだ大会が登録されていません。</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-800 text-gray-100 text-xs">
                    <th className="border border-gray-700 px-2 py-2 text-left">大会名</th>
                    <th className="border border-gray-700 px-2 py-2 text-left">開催日</th>
                    <th className="border border-gray-700 px-2 py-2 text-left">形式</th>
                    <th className="border border-gray-700 px-2 py-2 text-left">公開</th>
                    <th className="border border-gray-700 px-2 py-2 text-left">管理</th>
                  </tr>
                </thead>

                <tbody>
                  {tournaments.map((t) => {
                    const dateLabel = t.tournament_date
                      ? new Date(t.tournament_date).toLocaleDateString('ja-JP', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : '-';

                    const modeLabel =
                      t.mode === 'player' || t.mode === 'singles'
                        ? '個人戦'
                        : t.mode === 'teams'
                          ? 'チーム戦'
                          : t.mode || '-';

                    return (
                      <tr key={t.id} className="hover:bg-gray-800/60">
                        <td className="border border-gray-700 px-2 py-2">
                          <div className="font-medium">{t.name || '(名称未設定)'}</div>
                          {t.description && (
                            <div className="text-xs text-gray-400 line-clamp-2">{t.description}</div>
                          )}
                        </td>

                        <td className="border border-gray-700 px-2 py-2">{dateLabel}</td>
                        <td className="border border-gray-700 px-2 py-2">{modeLabel}</td>

                        {/* 公開リンク群 */}
                        <td className="border border-gray-700 px-2 py-2">
                          <div className="flex flex-col gap-1">
                            <Link
                              href={`/tournaments/${t.id}/league/results`}
                              className="text-xs text-green-300 underline hover:text-green-200"
                              target="_blank"
                              rel="noreferrer"
                            >
                              リーグ結果
                            </Link>

                            {/* ✅ 追加：トーナメント結果（公開） */}
                            <Link
                              href={`/tournaments/${t.id}/finals`}
                              className="text-xs text-emerald-300 underline hover:text-emerald-200"
                              target="_blank"
                              rel="noreferrer"
                            >
                              トーナメント結果
                            </Link>
                          </div>
                        </td>

                        {/* 管理リンク群 */}
                        <td className="border border-gray-700 px-2 py-2">
                          <div className="flex flex-wrap items-center gap-3">
                            <Link
                              href={`/admin/tournaments/${t.id}/league`}
                              className="text-xs text-blue-300 underline hover:text-blue-200"
                            >
                              ブロック管理
                            </Link>

                            {/* ✅ 追加：トーナメント管理（管理） */}
                            <Link
                              href={`/admin/tournaments/${t.id}/finals`}
                              className="text-xs text-purple-200 underline hover:text-purple-100"
                            >
                              トーナメント管理
                            </Link>

                            <button
                              onClick={() => openEdit(t)}
                              className="inline-flex items-center gap-2 px-3 py-1 text-xs rounded-lg border border-purple-500/40 hover:bg-purple-900/20 transition-colors"
                              title="大会名/説明を編集"
                            >
                              <FaEdit />
                              編集
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="mt-3 text-[11px] text-gray-400">
                ※「トーナメント結果」は公開画面（別タブ）、「トーナメント管理」は管理画面です。
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== 編集モーダル ===== */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-purple-500/30 bg-gray-900/90 backdrop-blur-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-purple-500/20">
              <div className="font-bold text-lg">大会を編集</div>
              <button
                onClick={closeEdit}
                className="p-2 rounded-lg hover:bg-purple-900/30 transition-colors"
                title="閉じる"
              >
                <FaTimes />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <div className="text-xs text-gray-300 mb-1">大会名</div>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-xl bg-black/40 border border-purple-500/30 px-3 py-2 outline-none focus:border-purple-400"
                  placeholder="例：2025年11月テスト大会"
                />
              </div>

              <div>
                <div className="text-xs text-gray-300 mb-1">説明</div>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full min-h-[120px] rounded-xl bg-black/40 border border-purple-500/30 px-3 py-2 outline-none focus:border-purple-400"
                  placeholder="大会の補足情報、注意事項など（任意）"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={closeEdit}
                  disabled={saving}
                  className="px-4 py-2 rounded-xl border border-purple-500/40 hover:bg-purple-900/20 transition-colors disabled:opacity-50"
                >
                  キャンセル
                </button>
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 transition-colors disabled:opacity-50"
                >
                  <FaSave />
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>

              <div className="text-[11px] text-gray-400">
                ※ 保存できない場合は、tournaments の RLS（管理者のみ update 許可）をご確認ください。
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
