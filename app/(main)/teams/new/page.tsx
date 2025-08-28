// app/(main)/teams/new/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FaUsers, FaChevronLeft, FaPlusCircle, FaSpinner, FaLock } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export default function TeamCreatePage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // サーバーCookie基準のログイン確認（true/false/null）
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
    return () => { cancelled = true; };
  }, []);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    const n = name.trim();
    return !submitting && n.length >= 2 && n.length <= 40;
  }, [name, submitting]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
const { data: { session } } = await supabase.auth.getSession();
      if (!user || !session) throw new Error('ログインが必要です');
      const token = session.access_token;

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        created_by: user.id, // RLS: with check (created_by = auth.uid()) を想定
      };

      const res = await fetch(`${BASE}/rest/v1/teams`, {
        method: 'POST',
        headers: {
          apikey: ANON,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const t = await res.text();
        // 一意制約など
        if (/23505|duplicate key value|unique constraint/i.test(t)) {
          throw new Error('同名のチームが既に存在します。別の名前にしてください。');
        }
        throw new Error(t || '登録に失敗しました');
      }

      const json = await res.json();
      const teamId = json?.[0]?.id as string | undefined;
      setSuccessMsg('チームを作成しました！');
      setTimeout(() => {
        router.replace(teamId ? `/teams/${teamId}` : '/teams');
      }, 800);
    } catch (e: any) {
      setError(e?.message || '登録に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

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

  // 未ログイン
  if (authed === false) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center">
          <p className="mb-4">チーム作成にはログインが必要です。</p>
          <Link href="/login?redirect=/teams/new" className="underline text-purple-300">
            ログインへ移動
          </Link>
        </div>
      </div>
    );
  }

  // 本体
  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8">
        {/* 戻る */}
        <div className="mb-6">
          <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-purple-300 hover:text-purple-200">
            <FaChevronLeft /> 戻る
          </button>
        </div>

        <div className="max-w-2xl mx-auto">
          {/* ヘッダー */}
          <div className="text-center mb-8">
            <div className="inline-block p-4 mb-4 rounded-full bg-gradient-to-br from-purple-400/20 to-pink-600/20">
              <FaUsers className="text-4xl text-purple-300" />
            </div>
            <h1 className="text-3xl font-bold text-yellow-100">チーム作成</h1>
            <p className="text-gray-400 mt-1 flex items-center justify-center gap-2">
              <FaLock className="text-green-400" /> ログイン済み
            </p>
          </div>

          {/* フォーム */}
          <form onSubmit={onSubmit} className="space-y-6">
            <div className="glass-card rounded-2xl p-6 border border-purple-500/30">
              <label className="block text-sm font-medium text-purple-300 mb-2">チーム名（必須）</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: チームA"
                className="w-full px-4 py-3 bg-gray-900/60 border border-purple-500/30 rounded-lg text-yellow-50 focus:outline-none focus:border-purple-400"
              />
              <p className="text-xs text-gray-500 mt-1">2〜40文字。重複不可。</p>
            </div>

            <div className="glass-card rounded-2xl p-6 border border-purple-500/30">
              <label className="block text-sm font-medium text-purple-300 mb-2">紹介文（任意）</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="チームの紹介や方針など"
                className="w-full px-4 py-3 bg-gray-900/60 border border-purple-500/30 rounded-lg text-yellow-50 focus:outline-none focus:border-purple-400"
              />
            </div>

            {error && (
              <div className="glass-card rounded-lg p-4 border border-red-500/50 bg-red-500/10">
                <p className="text-red-400">{error}</p>
              </div>
            )}
            {successMsg && (
              <div className="glass-card rounded-lg p-4 border border-green-500/50 bg-green-500/10">
                <p className="text-green-400">{successMsg}</p>
              </div>
            )}

            <div className="flex justify-center gap-3">
              <Link href="/teams" className="px-6 py-3 rounded-xl bg-gray-700 hover:bg-gray-600">
                キャンセル
              </Link>
              <button
                type="submit"
                disabled={!canSubmit}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white disabled:opacity-50 inline-flex items-center gap-2"
              >
                {submitting ? <FaSpinner className="animate-spin" /> : <FaPlusCircle />}
                作成する
              </button>
            </div>

            <div className="text-xs text-gray-400 text-center">
              ※ メンバーの追加はチーム作成後に「メンバー管理」から行えます。
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
