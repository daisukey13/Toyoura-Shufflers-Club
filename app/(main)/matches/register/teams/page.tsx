'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FaUsers, FaLock, FaTrophy, FaCalendar, FaMinus, FaPlus } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

type Team = { id: string; name: string };

async function parseRestError(res: Response) {
  let msg = `HTTP ${res.status}`;
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      msg = j?.message || j?.hint || j?.details || text || msg;
    } catch {
      msg = text || msg;
    }
  } catch {}
  return msg;
}
const toInt = (v: string | number, fb = 0) => {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fb;
};

export default function TeamsRegisterPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // ログイン判定
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/auth/whoami', { cache: 'no-store', credentials: 'include' });
        const j = r.ok ? await r.json() : { authenticated: false };
        if (alive) setAuthed(!!j?.authenticated);
      } catch {
        if (alive) setAuthed(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const [meId, setMeId] = useState<string | null>(null);
  useEffect(() => {
    if (authed !== true) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMeId(user?.id ?? null);
    })();
  }, [authed, supabase]);

  // 所属チーム（team_members: player_id -> teams）
  const [myTeams, setMyTeams] = useState<Team[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [teamsError, setTeamsError] = useState<string | null>(null);

  useEffect(() => {
    if (authed !== true || !meId) return;
    let alive = true;
    (async () => {
      setLoadingTeams(true);
      setTeamsError(null);
      try {
        // 所属チーム
        const { data: myRows, error: myErr } = await supabase
          .from('team_members')
          .select('team_id, teams ( id, name )')
          .eq('player_id', meId);

        if (myErr) throw myErr;
        const mine: Team[] = (myRows ?? [])
          .map((r: any) => r.teams)
          .filter(Boolean);

        // 全チーム（対戦相手用）
        const { data: tdata, error: tErr } = await supabase
          .from('teams')
          .select('id,name')
          .order('name', { ascending: true });

        if (tErr) throw tErr;

        if (alive) {
          setMyTeams(mine);
          setAllTeams((tdata ?? []) as Team[]);
        }
      } catch (e: any) {
        if (alive) setTeamsError(e?.message || 'チームの取得に失敗しました');
      } finally {
        if (alive) setLoadingTeams(false);
      }
    })();
    return () => { alive = false; };
  }, [authed, meId, supabase]);

  // UI 状態
  const [matchDate, setMatchDate] = useState(new Date().toISOString().slice(0, 16));
  const [myTeamId, setMyTeamId] = useState('');
  const [opponentTeamId, setOpponentTeamId] = useState('');
  const [iWon, setIWon] = useState(true);
  const [loserScore, setLoserScore] = useState(0);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);

  useEffect(() => {
    // 自分のチームが一つなら自動選択
    if (!myTeamId && myTeams.length === 1) setMyTeamId(myTeams[0].id);
  }, [myTeams, myTeamId]);

  const opponentCandidates = allTeams.filter(t => t.id !== myTeamId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError('');
    setSuccess(false);
    try {
      if (authed !== true) throw new Error('ログインが必要です');
      if (!myTeamId) throw new Error('自チームを選択してください');
      if (!opponentTeamId) throw new Error('相手チームを選択してください');
      if (myTeamId === opponentTeamId) throw new Error('同一チームは選べません');
      if (loserScore < 0 || loserScore > 14) throw new Error('敗者スコアは 0〜14 点です');

      const winner_team_id = iWon ? myTeamId : opponentTeamId;
      const loser_team_id  = iWon ? opponentTeamId : myTeamId;

      const payload = {
        mode: 'teams',
        match_date: matchDate,
        winner_team_id,
        loser_team_id,
        loser_score: loserScore,
      };

      const res = await fetch('/api/matches', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        try {
          const j = await res.json();
          throw new Error(j?.message || `登録に失敗しました (HTTP ${res.status})`);
        } catch {
          throw new Error(await parseRestError(res));
        }
      }

      setSuccess(true);
      setTimeout(() => router.push('/matches'), 700);
    } catch (err: any) {
      setError(err?.message || '登録に失敗しました');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  // 画面
  if (authed === null) {
    return (
      <div className="min-h-screen grid place-items-center p-8">
        <div className="glass-card rounded-xl p-8 w-full max-w-xl">
          <div className="h-6 w-40 bg-white/10 rounded mb-6" />
          <div className="h-32 bg-white/10 rounded" />
        </div>
      </div>
    );
  }
  if (authed === false) {
    return (
      <div className="min-h-screen grid place-items-center p-8">
        <div className="text-center">
          <p className="mb-3">試合結果の登録にはログインが必要です。</p>
          <Link href="/login?redirect=/matches/register/teams" className="underline text-purple-300">
            ログインへ移動
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="text-center mb-8">
        <div className="inline-block p-4 mb-3 rounded-full bg-gradient-to-br from-emerald-400/20 to-cyan-600/20">
          <FaUsers className="text-4xl text-emerald-300" />
        </div>
        <h1 className="text-3xl font-bold text-yellow-100">チーム試合を登録</h1>
        <p className="text-gray-400 mt-1">所属チームでの試合のみ登録できます。</p>
        <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 bg-green-500/20 rounded-full">
          <FaLock className="text-green-400 text-sm" />
          <span className="text-green-400 text-sm">ログイン済み</span>
        </div>
      </div>

      {teamsError && (
        <div className="glass-card rounded-md p-3 mb-4 border border-yellow-500/40 bg-yellow-500/10">
          <p className="text-yellow-200 text-sm">{teamsError}</p>
        </div>
      )}

      {error && (
        <div className="glass-card rounded-md p-3 mb-4 border border-red-500/40 bg-red-500/10">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}
      {success && (
        <div className="glass-card rounded-md p-3 mb-4 border border-green-500/40 bg-green-500/10">
          <p className="text-green-300 text-sm">🎉 登録しました。まもなく一覧へ移動します…</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 日時 */}
        <div className="glass-card rounded-xl p-5 border border-purple-500/30">
          <label className="block text-sm font-medium mb-2 text-gray-300">
            <FaCalendar className="inline mr-2 text-purple-400" />
            試合日時
          </label>
          <input
            type="datetime-local"
            required
            value={matchDate}
            onChange={(e) => setMatchDate(e.target.value)}
            className="w-full px-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100 focus:outline-none focus:border-purple-400"
          />
        </div>

        {/* 自チーム */}
        <div className="glass-card rounded-xl p-5 border border-purple-500/30">
          <label className="block text-sm font-medium mb-2 text-gray-300">自チーム</label>
          <select
            required
            disabled={loadingTeams}
            value={myTeamId}
            onChange={(e) => setMyTeamId(e.target.value)}
            className="w-full px-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100"
          >
            <option value="">{loadingTeams ? '読み込み中...' : '選択してください'}</option>
            {myTeams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* 相手チーム */}
        <div className="glass-card rounded-xl p-5 border border-purple-500/30">
          <label className="block text-sm font-medium mb-2 text-gray-300">相手チーム</label>
          <select
            required
            disabled={loadingTeams || !myTeamId}
            value={opponentTeamId}
            onChange={(e) => setOpponentTeamId(e.target.value)}
            className="w-full px-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100"
          >
            <option value="">{loadingTeams ? '読み込み中...' : '選択してください'}</option>
            {opponentCandidates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* 勝敗 */}
        <div className="glass-card rounded-xl p-5 border border-purple-500/30">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIWon(true)}
              className={`px-4 py-2 rounded-lg border transition-all ${
                iWon
                  ? 'bg-green-500/20 border-green-400/60 text-green-200'
                  : 'bg-purple-900/20 border-purple-500/30 text-gray-300'
              }`}
            >
              自チームの勝ち
            </button>
            <button
              type="button"
              onClick={() => setIWon(false)}
              className={`px-4 py-2 rounded-lg border transition-all ${
                !iWon
                  ? 'bg-red-500/20 border-red-400/60 text-red-200'
                  : 'bg-purple-900/20 border-purple-500/30 text-gray-300'
              }`}
            >
              自チームの負け
            </button>
          </div>
        </div>

        {/* スコア（敗者スコアのみ入力） */}
        <div className="glass-card rounded-xl p-5 border border-purple-500/30">
          <p className="text-sm text-gray-300 mb-2">スコア</p>
          <div className="grid grid-cols-2 gap-6 items-center">
            <div className="text-center">
              <div className="text-xs text-gray-400 mb-1">勝者</div>
              <div className="text-3xl font-bold text-green-400">15</div>
            </div>

            <div className="text-center">
              <div className="text-xs text-gray-400 mb-1">敗者</div>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  className="p-2 rounded-lg bg-purple-900/30 border border-purple-500/30"
                  onClick={() => setLoserScore(s => Math.max(0, s - 1))}
                >
                  <FaMinus />
                </button>
                <input
                  type="number"
                  min={0}
                  max={14}
                  value={loserScore}
                  onChange={(e) => setLoserScore(toInt(e.target.value, 0))}
                  className="w-20 text-center px-3 py-2 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100 text-xl font-bold"
                />
                <button
                  type="button"
                  className="p-2 rounded-lg bg-purple-900/30 border border-purple-500/30"
                  onClick={() => setLoserScore(s => Math.min(14, s + 1))}
                >
                  <FaPlus />
                </button>
              </div>
              <div className="text-[11px] text-gray-500 mt-1">0〜14点</div>
            </div>
          </div>
        </div>

        {/* 送信 */}
        <div className="flex justify-center">
          <button
            type="submit"
            disabled={loading || loadingTeams || !myTeamId || !opponentTeamId || myTeamId === opponentTeamId}
            className="gradient-button px-10 py-3 rounded-full text-white font-medium text-lg disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                登録中...
              </>
            ) : (
              <>
                <FaTrophy /> 登録する
              </>
            )}
          </button>
        </div>
      </form>

      <div className="mt-6 glass-card rounded-md p-4 border border-blue-500/30 bg-blue-900/20 text-sm text-blue-300">
        勝者スコアは 15 点固定、敗者スコアは 0〜14 点で登録されます。
      </div>
    </div>
  );
}
