'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FaUsers, FaChevronRight } from 'react-icons/fa';

type Team = { id: string; name: string };

export default function TeamRegisterTile() {
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState<Team[]>([]);
  const [admin, setAdmin] = useState(false);
  const [sel, setSel] = useState<string>('');
  const [err, setErr] = useState<string>('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr('');
        const res = await fetch('/api/my/teams', { credentials: 'include', cache: 'no-store' });
        const j = await res.json();
        if (!res.ok || !j?.ok) throw new Error(j?.message || `HTTP ${res.status}`);
        if (!alive) return;
        setTeams(j.teams || []);
        setAdmin(!!j.admin);
        if ((j.teams || []).length === 1) setSel(j.teams[0].id);
      } catch (e: any) {
        if (alive) setErr(e?.message || '所属チームの取得に失敗しました');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <div className="glass-card rounded-xl p-5 border border-purple-500/30">
        <div className="animate-pulse h-6 w-40 bg-white/10 rounded mb-3" />
        <div className="animate-pulse h-10 w-full bg-white/10 rounded" />
      </div>
    );
  }

  // 所属なし：タイルは非活性表示
  if (!admin && teams.length === 0) {
    return (
      <div className="glass-card rounded-xl p-5 border border-purple-500/30">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-3 rounded-full bg-emerald-500/20">
            <FaUsers className="text-emerald-300" />
          </div>
          <h3 className="text-lg font-bold text-yellow-100">チーム試合を登録</h3>
        </div>
        <p className="text-sm text-gray-400">
          所属チームがありません。チームに加入すると、ここからチーム戦の登録ができます。
        </p>
        {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
      </div>
    );
  }

  // 1チームだけ → そのチームで即遷移
  if (!admin && teams.length === 1) {
    const t = teams[0];
    return (
      <Link
        href={`/matches/register/teams?team_id=${encodeURIComponent(t.id)}`}
        className="group glass-card rounded-xl p-5 border border-purple-500/30 hover:border-purple-400/60 transition-colors block"
      >
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-full bg-emerald-500/20">
            <FaUsers className="text-emerald-300" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-yellow-100">チーム試合を登録</h3>
            <p className="text-sm text-gray-400">所属チーム: {t.name}</p>
          </div>
          <FaChevronRight className="text-gray-400 group-hover:text-gray-200" />
        </div>
      </Link>
    );
  }

  // 管理者 or 複数所属 → セレクトして遷移
  return (
    <div className="glass-card rounded-xl p-5 border border-purple-500/30">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-3 rounded-full bg-emerald-500/20">
          <FaUsers className="text-emerald-300" />
        </div>
        <h3 className="text-lg font-bold text-yellow-100">チーム試合を登録</h3>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          className="w-full px-3 py-2 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100"
        >
          <option value="">{admin ? 'チームを選択（全チーム）' : '所属チームを選択'}</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        <Link
          aria-disabled={!sel}
          href={sel ? `/matches/register/teams?team_id=${encodeURIComponent(sel)}` : '#'}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white ${
            sel
              ? 'bg-gradient-to-r from-emerald-500 to-green-500 hover:opacity-90'
              : 'bg-gray-600/50 cursor-not-allowed'
          }`}
        >
          <FaUsers />
          登録画面へ進む
        </Link>

        {err && <p className="text-xs text-red-400">{err}</p>}
      </div>
    </div>
  );
}
