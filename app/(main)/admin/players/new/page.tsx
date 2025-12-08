'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { FaArrowLeft, FaPlus } from 'react-icons/fa';

const supabase = createClient();

export default function AdminPlayerNewPage() {
  const router = useRouter();
  const { user, player, loading } = useAuth();

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const [handleName, setHandleName] = useState('テスト太郎');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [rankingPoints, setRankingPoints] = useState<number>(1000);
  const [handicap, setHandicap] = useState<number>(30);
  const [isActive, setIsActive] = useState<boolean>(true);
  const [isDummy, setIsDummy] = useState<boolean>(true);
  const [memo, setMemo] = useState<string>('ダミー登録');

  // admin guard
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login?redirect=/admin/players/new');
      return;
    }
    if (!player?.is_admin) {
      router.replace('/');
    }
  }, [loading, user, player, router]);

  // 最下位RPを取得して初期値にする（失敗しても1000のまま）
  useEffect(() => {
    if (loading || !user || !player?.is_admin) return;

    (async () => {
      try {
        const { data, error } = await supabase
          .from('players')
          .select('ranking_points')
          .eq('is_admin', false)
          .order('ranking_points', { ascending: true })
          .limit(1);

        if (error) return;
        const min = Number((data?.[0] as any)?.ranking_points ?? 1000);
        if (Number.isFinite(min)) setRankingPoints(min);
      } catch {
        // noop
      }
    })();
  }, [loading, user, player?.is_admin]);

  const create = async () => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const payloadBase: any = {
        handle_name: handleName.trim() || null,
        avatar_url: avatarUrl.trim() || null,
        ranking_points: rankingPoints,
        handicap: handicap,
        is_active: isActive,
        is_admin: false,
      };

      // is_dummy/memo カラムが無い可能性があるので、まず入れて試し、失敗なら外して作成
      const tryInsert = async (p: any) => {
        const { data, error } = await supabase.from('players').insert([p]).select('id').maybeSingle();
        return { data, error };
      };

      let { data, error } = await tryInsert({ ...payloadBase, is_dummy: isDummy, memo });
      if (error) {
        const r2 = await tryInsert(payloadBase);
        data = r2.data;
        error = r2.error;
      }
      if (error) throw error;

      setMsg('作成しました');
      const newId = (data as any)?.id;
      if (newId) router.replace(`/admin/players/${newId}`);
      else router.replace('/admin/players');
    } catch (e: any) {
      setErr(e?.message || '作成に失敗しました（必須カラムが他にもある場合はテーブル定義に合わせて項目を追加します）');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !user || !player?.is_admin) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen">
      <div className="container mx-auto px-4 py-8 sm:py-10">
        <div className="glass-card rounded-2xl border border-purple-500/30 p-5 sm:p-6">
          <Link href="/admin/players" className="text-purple-300 hover:text-purple-200 inline-flex items-center gap-2 text-sm">
            <FaArrowLeft /> プレイヤー一覧へ
          </Link>

          <h1 className="mt-2 text-xl sm:text-2xl font-bold text-yellow-100">プレイヤー新規作成</h1>
          <p className="text-xs sm:text-sm text-gray-400 mt-1">
            初期値：HC=30 / RP=最下位（取得できない場合1000）
          </p>

          {err && (
            <div className="mt-4 p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-sm">
              {err}
            </div>
          )}
          {msg && (
            <div className="mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/25 text-green-200 text-sm">
              {msg}
            </div>
          )}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-gray-300 mb-1">表示名（handle_name）</label>
              <input
                value={handleName}
                onChange={(e) => setHandleName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-300 mb-1">アバターURL（任意）</label>
              <input
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none text-sm"
                placeholder="https://..."
              />
            </div>

            <div>
              <label className="block text-xs text-gray-300 mb-1">ランキングポイント</label>
              <input
                type="number"
                value={rankingPoints}
                onChange={(e) => setRankingPoints(parseInt(e.target.value || '0', 10))}
                className="w-full px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-300 mb-1">ハンディ</label>
              <input
                type="number"
                value={handicap}
                onChange={(e) => setHandicap(parseInt(e.target.value || '0', 10))}
                className="w-full px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none text-sm"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-300">有効</label>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="accent-purple-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-300">ダミー</label>
              <input
                type="checkbox"
                checked={isDummy}
                onChange={(e) => setIsDummy(e.target.checked)}
                className="accent-amber-500"
                title="players.is_dummy がある場合のみDBに保存されます（無ければ自動フォールバック）"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-300 mb-1">メモ（任意）</label>
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 focus:outline-none text-sm"
                placeholder="例）ダミー登録 / サンプル / テスト用"
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={create}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 transition-colors text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
            >
              <FaPlus /> 作成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
