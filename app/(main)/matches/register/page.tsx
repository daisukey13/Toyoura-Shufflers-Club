// app/(main)/matches/register/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FaTrophy,
  FaCalendar,
  FaMapMarkerAlt,
  FaStickyNote,
  FaUsers,
  FaDice,
  FaGamepad,
  FaLock,
} from 'react-icons/fa';

import { createClient } from '@/lib/supabase/client';
import { useFetchPlayersData, updatePlayer } from '@/lib/hooks/useFetchSupabaseData';

/* ========================================================================
 * Types
 * ===================================================================== */
type MatchMode = 'singles' | 'teams';

type Player = {
  id: string;
  handle_name: string;
  avatar_url?: string | null;
  ranking_points: number;
  handicap: number;
  matches_played?: number;
  wins?: number;
  losses?: number;
};

type Team = { id: string; name: string };

type FormState = {
  match_date: string;
  // singles 用
  winner_id: string;
  loser_id: string;
  // teams 用
  winner_team_id: string;
  loser_team_id: string;
  // 共通
  loser_score: number;
  venue: string;
  notes: string;
};

/* ========================================================================
 * Helpers
 * ===================================================================== */

/** PostgREST のエラーテキストを人間向けに整形 */
async function parseRestError(res: Response) {
  let msg = `HTTP ${res.status}`;
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      const m = j?.message || j?.hint || j?.details || text;
      msg = typeof m === 'string' ? m : text;
    } catch {
      msg = text || msg;
    }
  } catch {
    // noop
  }
  return msg;
}

/** Safe int parse for numeric inputs */
function toInt(v: string | number, fallback = 0) {
  const n = typeof v === 'number' ? v : parseInt(v as string, 10);
  return Number.isFinite(n) ? n : fallback;
}

/* ========================================================================
 * Component
 * ===================================================================== */
export default function MatchRegisterPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // 1) サーバー Cookie 基準のログイン確認（フラッシュ防止）
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

  // 2) 個人プレイヤー（認証確認後に読み込み）
  const {
    players,
    loading: playersLoading,
    error: playersError,
    refetch: refetchPlayers,
  } = useFetchPlayersData({ enabled: authed === true, requireAuth: true });

  // 3) チーム一覧（団体戦用）
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamsError, setTeamsError] = useState<string | null>(null);

  useEffect(() => {
    if (authed !== true) return;
    let cancelled = false;

    (async () => {
      setTeamsLoading(true);
      setTeamsError(null);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const headers = {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${token ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
          'Content-Type': 'application/json',
        };
        const url = `${base}/rest/v1/teams?select=id,name&order=name.asc`;
        const res = await fetch(url, { headers, cache: 'no-store' });
        if (!res.ok) throw new Error(await parseRestError(res));
        const json = (await res.json()) as Team[];
        if (!cancelled) setTeams(json ?? []);
      } catch (e: any) {
        if (!cancelled) setTeamsError(e?.message || 'チームの取得に失敗しました');
      } finally {
        if (!cancelled) setTeamsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authed, supabase]);

  // 4) UI 状態
  const [mode, setMode] = useState<MatchMode>('singles');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const submittingRef = useRef(false);

  const [formData, setFormData] = useState<FormState>({
    match_date: new Date().toISOString().slice(0, 16),
    winner_id: '',
    loser_id: '',
    winner_team_id: '',
    loser_team_id: '',
    loser_score: 0,
    venue: '',
    notes: '',
  });

  // モード切り替え時は相互に関係ない値をクリア（DB 制約違反を避ける）
  useEffect(() => {
    setFormData((prev) => {
      if (mode === 'singles') {
        return { ...prev, winner_team_id: '', loser_team_id: '' };
      }
      return { ...prev, winner_id: '', loser_id: '' };
    });
  }, [mode]);

  // 便利 getters
  const getSelectedPlayer = (playerId: string) =>
    players.find((p: any) => p.id === playerId) as Player | undefined;

  const getSelectedTeam = (teamId: string) => teams.find((t) => t.id === teamId);

  /* ---------------------------------------------------------------------
   * ELO ライク計算（個人戦のみ使用。団体戦は個人 RP/HC を変更しない）
   * ------------------------------------------------------------------- */
  const calculatePointsAndHandicapChange = (
    winnerPoints: number,
    loserPoints: number,
    winnerHandicap: number,
    loserHandicap: number,
    scoreDifference: number
  ) => {
    const K = 32;
    const expectedWinner = 1 / (1 + Math.pow(10, (loserPoints - winnerPoints) / 400));
    const scoreDiffMultiplier = 1 + scoreDifference / 30;
    const handicapDiff = winnerHandicap - loserHandicap;
    const handicapMultiplier = 1 + handicapDiff / 50;

    const baseWinnerChange = K * (1 - expectedWinner) * scoreDiffMultiplier * handicapMultiplier;
    const baseLoserChange = -K * expectedWinner * scoreDiffMultiplier;

    const winnerHandicapChange = scoreDifference >= 10 ? -1 : 0;
    const loserHandicapChange = scoreDifference >= 10 ? 1 : 0;

    return {
      winnerPointsChange: Math.round(baseWinnerChange),
      loserPointsChange: Math.round(baseLoserChange),
      winnerHandicapChange,
      loserHandicapChange,
    };
  };

  /* ---------------------------------------------------------------------
   * 送信
   * ------------------------------------------------------------------- */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      if (!authed) throw new Error('ログインが必要です');

      // reporter_id (NOT NULL 制約対応)
      const { data: userData } = await supabase.auth.getUser();
      const reporter_id = userData.user?.id;
      if (!reporter_id) throw new Error('セッションが失効しました。ログインし直してください。');

      const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const headers = {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${token ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      };

      // 共通バリデーション（DB 側の check と足並み）
      const loserScore = toInt(formData.loser_score, 0);
      if (loserScore < 0 || loserScore >= 15) {
        throw new Error('敗者スコアは 0〜14 点です');
      }

      /* --------------------- 個人戦 --------------------- */
      if (mode === 'singles') {
        if (!formData.winner_id || !formData.loser_id) {
          throw new Error('勝者と敗者を選択してください');
        }
        if (formData.winner_id === formData.loser_id) {
          throw new Error('同一プレイヤーは選べません');
        }

        const winner = getSelectedPlayer(formData.winner_id);
        const loser = getSelectedPlayer(formData.loser_id);
        if (!winner || !loser) throw new Error('プレイヤー情報の取得に失敗しました');

        const scoreDifference = 15 - loserScore;
        const changes = calculatePointsAndHandicapChange(
          winner.ranking_points,
          loser.ranking_points,
          winner.handicap,
          loser.handicap,
          scoreDifference
        );

        // matches 挿入（DB 制約：mode ∈ ('singles','teams')、status ∈ ('pending','finalized')、winner_score=15）
        const matchPayload: any = {
          mode: 'singles',
          status: 'finalized',
          match_date: formData.match_date,
          reporter_id,
          winner_id: formData.winner_id,
          loser_id: formData.loser_id,
          winner_score: 15,
          loser_score: loserScore,
          // venue/notes が DB に存在する場合は以下を有効化
          // venue: formData.venue || null,
          // notes: formData.notes || null,
        };

        const res = await fetch(`${base}/rest/v1/matches`, {
          method: 'POST',
          headers,
          body: JSON.stringify(matchPayload),
        });
        if (!res.ok) {
          throw new Error(`登録に失敗しました: ${await parseRestError(res)}`);
        }
        const inserted = (await res.json()) as Array<{ id: string }>;
        const matchId = inserted?.[0]?.id;
        if (!matchId) console.warn('matches inserted but id not returned');

        // 個人の RP/HC 更新
        const winnerNext = {
          ranking_points: winner.ranking_points + changes.winnerPointsChange,
          handicap: Math.max(0, winner.handicap + changes.winnerHandicapChange),
          matches_played: (winner.matches_played ?? 0) + 1,
          wins: (winner.wins ?? 0) + 1,
        };
        const loserNext = {
          ranking_points: Math.max(0, loser.ranking_points + changes.loserPointsChange),
          handicap: Math.min(50, loser.handicap + changes.loserHandicapChange),
          matches_played: (loser.matches_played ?? 0) + 1,
          losses: (loser.losses ?? 0) + 1,
        };

        const [uw, ul] = await Promise.all([
          updatePlayer(formData.winner_id, winnerNext),
          updatePlayer(formData.loser_id, loserNext),
        ]);
        if (uw.error) console.warn('Winner update warning:', uw.error);
        if (ul.error) console.warn('Loser update warning:', ul.error);

        setSuccess(true);
        setTimeout(() => router.push('/matches'), 800);
        return;
      }

      /* --------------------- 団体戦 --------------------- */
      if (mode === 'teams') {
        if (!formData.winner_team_id || !formData.loser_team_id) {
          throw new Error('勝利チームと敗北チームを選択してください');
        }
        if (formData.winner_team_id === formData.loser_team_id) {
          throw new Error('同一チームは選べません');
        }

        // matches 挿入（teams: team_no=1 が勝利 / 2 が敗北）
        const mPayload: any = {
          mode: 'teams',
          status: 'finalized',
          match_date: formData.match_date,
          reporter_id,
          winner_score: 15,
          loser_score: loserScore,
          winner_team_no: 1,
          loser_team_no: 2,
          // venue/notes を使う場合は列名に合わせて追加
          // venue: formData.venue || null,
          // notes: formData.notes || null,
        };

        const res = await fetch(`${base}/rest/v1/matches`, {
          method: 'POST',
          headers,
          body: JSON.stringify(mPayload),
        });
        if (!res.ok) {
          throw new Error(`登録に失敗しました: ${await parseRestError(res)}`);
        }
        const inserted = (await res.json()) as Array<{ id: string }>;
        const matchId = inserted?.[0]?.id;
        if (!matchId) throw new Error('登録は成功しましたが match_id を取得できませんでした');

        // match_teams に 2 行挿入
        const mtRows = [
          { match_id: matchId, team_id: formData.winner_team_id, team_no: 1 },
          { match_id: matchId, team_id: formData.loser_team_id, team_no: 2 },
        ];
        const res2 = await fetch(`${base}/rest/v1/match_teams`, {
          method: 'POST',
          headers,
          body: JSON.stringify(mtRows),
        });
        if (!res2.ok) {
          throw new Error(`チーム割当の登録に失敗しました: ${await parseRestError(res2)}`);
        }

        // 団体戦では個人 RP/HC は変更しない（チームランキングは集計で）
        setSuccess(true);
        setTimeout(() => router.push('/matches'), 800);
        return;
      }

      throw new Error('不明なモードです');
    } catch (err: any) {
      setError(err?.message || '登録に失敗しました');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const winner = getSelectedPlayer(formData.winner_id);
  const loser = getSelectedPlayer(formData.loser_id);

  /* ========================================================================
   * Render
   * ===================================================================== */

  // 判定中スケルトン
  if (authed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="w-full max-w-3xl glass-card rounded-xl p-8">
          <div className="h-6 w-48 bg-white/10 rounded mb-6" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-40 bg-white/10 rounded" />
            <div className="h-40 bg-white/10 rounded" />
          </div>
        </div>
      </div>
    );
  }

  // 未ログイン（自動リダイレクトせず案内）
  if (authed === false) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center">
          <p className="mb-4">試合結果の登録にはログインが必要です。</p>
          <Link href="/login?redirect=/matches/register" className="underline text-purple-300">
            ログインへ移動
          </Link>
        </div>
      </div>
    );
  }

  // 本体
  return (
    <div className="container mx-auto px-4 py-8">
      {/* ヘッダー */}
      <div className="text-center mb-12">
        <div className="inline-block p-4 mb-4 rounded-full bg-gradient-to-br from-purple-400/20 to-pink-600/20">
          <FaGamepad className="text-5xl text-purple-400" />
        </div>
        <h1 className="text-4xl font-bold mb-2 text-yellow-100">試合結果登録</h1>
        <p className="text-gray-400">個人戦 / 団体戦を選び、必要事項を入力して登録します。</p>
        <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 bg-green-500/20 rounded-full">
          <FaLock className="text-green-400 text-sm" />
          <span className="text-green-400 text-sm">ログイン済み</span>
        </div>
      </div>

      {/* エラー / 成功 */}
      {error && (
        <div className="glass-card rounded-lg p-4 mb-6 border border-red-500/50 bg-red-500/10" role="alert" aria-live="polite">
          <p className="text-red-400">{error}</p>
        </div>
      )}
      {success && (
        <div className="glass-card rounded-lg p-4 mb-6 border border-green-500/50 bg-green-500/10" role="status" aria-live="polite">
          <p className="text-green-400 text-center text-xl font-bold animate-pulse">🎉 試合結果を登録しました！一覧へ移動します…</p>
        </div>
      )}

      {/* ローディング */}
      {(playersLoading || teamsLoading) && (
        <div className="min-h-[140px] flex items-center justify-center mb-8" role="status" aria-busy="true">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-400" />
        </div>
      )}

      {/* 追加の読み込みエラー表示（非ブロッキング） */}
      {(playersError || teamsError) && (
        <div className="glass-card rounded-lg p-4 mb-6 border border-yellow-500/50 bg-yellow-500/10">
          <p className="text-yellow-300 text-sm">
            {playersError && <>プレイヤー取得エラー: {String(playersError)}<br /></>}
            {teamsError && <>チーム取得エラー: {String(teamsError)}</>}
          </p>
          <div className="mt-2 flex gap-2">
            {playersError && (
              <button
                onClick={() => refetchPlayers()}
                className="px-3 py-1 rounded bg-yellow-600/30 hover:bg-yellow-600/50 text-yellow-100 text-sm"
              >
                プレイヤー再読込
              </button>
            )}
          </div>
        </div>
      )}

      {/* フォーム */}
      <form onSubmit={handleSubmit} className="max-w-4xl mx-auto space-y-6">
        {/* モード切替 */}
        <div className="glass-card rounded-xl p-6 border border-purple-500/30">
          <label className="block text-sm font-medium mb-4 text-gray-300">試合モード</label>
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setMode('singles')}
              className={`p-4 rounded-lg border transition-all ${
                mode === 'singles'
                  ? 'bg-gradient-to-r from-blue-500/20 to-purple-500/20 border-blue-500/50'
                  : 'bg-purple-900/20 border-purple-500/20 hover:border-purple-400/40'
              }`}
            >
              <FaDice className="text-2xl mb-2 mx-auto text-blue-400" />
              <p className="font-medium text-yellow-100">個人戦</p>
            </button>

            <button
              type="button"
              onClick={() => setMode('teams')}
              className={`p-4 rounded-lg border transition-all ${
                mode === 'teams'
                  ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-500/50'
                  : 'bg-purple-900/20 border-purple-500/20 hover:border-purple-400/40'
              }`}
            >
              <FaUsers className="text-2xl mb-2 mx-auto text-yellow-400" />
              <p className="font-medium text-yellow-100">団体戦</p>
            </button>
          </div>
        </div>

        {/* 試合日時 */}
        <div className="glass-card rounded-xl p-6 border border-purple-500/30">
          <label className="block text-sm font-medium mb-2 text-gray-300">
            <FaCalendar className="inline mr-2 text-purple-400" />
            試合日時
          </label>
          <input
            type="datetime-local"
            required
            value={formData.match_date}
            onChange={(e) => setFormData({ ...formData, match_date: e.target.value })}
            className="w-full px-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100 focus:outline-none focus:border-purple-400"
          />
        </div>

        {/* 選択 UI（モードで切替） */}
        {mode === 'singles' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 勝者 */}
            <div className="glass-card rounded-xl p-6 border border-green-500/30">
              <label className="block text-sm font-medium mb-2 text-gray-300">勝者</label>
              <select
                required
                value={formData.winner_id}
                onChange={(e) => setFormData({ ...formData, winner_id: e.target.value })}
                className="w-full px-4 py-3 bg-purple-900/30 border border-green-500/30 rounded-lg text-yellow-100 focus:outline-none focus:border-green-400"
              >
                <option value="">選択してください</option>
                {players.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.handle_name} (RP: {p.ranking_points}, HC: {p.handicap})
                  </option>
                ))}
              </select>

              {winner && <PlayerCard player={winner} tone="green" />}
            </div>

            {/* 敗者 */}
            <div className="glass-card rounded-xl p-6 border border-red-500/30">
              <label className="block text-sm font-medium mb-2 text-gray-300">敗者</label>
              <select
                required
                value={formData.loser_id}
                onChange={(e) => setFormData({ ...formData, loser_id: e.target.value })}
                className="w-full px-4 py-3 bg-purple-900/30 border border-red-500/30 rounded-lg text-yellow-100 focus:outline-none focus:border-red-400"
              >
                <option value="">選択してください</option>
                {players.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.handle_name} (RP: {p.ranking_points}, HC: {p.handicap})
                  </option>
                ))}
              </select>

              {loser && <PlayerCard player={loser} tone="red" />}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 勝利チーム */}
            <div className="glass-card rounded-xl p-6 border border-green-500/30">
              <label className="block text-sm font-medium mb-2 text-gray-300">勝利チーム</label>
              <select
                required
                value={formData.winner_team_id}
                onChange={(e) => setFormData({ ...formData, winner_team_id: e.target.value })}
                className="w-full px-4 py-3 bg-purple-900/30 border border-green-500/30 rounded-lg text-yellow-100 focus:outline-none focus:border-green-400"
              >
                <option value="">選択してください</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {getSelectedTeam(formData.winner_team_id) && <TeamChip name={getSelectedTeam(formData.winner_team_id)!.name} tone="green" />}
            </div>

            {/* 敗北チーム */}
            <div className="glass-card rounded-xl p-6 border border-red-500/30">
              <label className="block text-sm font-medium mb-2 text-gray-300">敗北チーム</label>
              <select
                required
                value={formData.loser_team_id}
                onChange={(e) => setFormData({ ...formData, loser_team_id: e.target.value })}
                className="w-full px-4 py-3 bg-purple-900/30 border border-red-500/30 rounded-lg text-yellow-100 focus:outline-none focus:border-red-400"
              >
                <option value="">選択してください</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {getSelectedTeam(formData.loser_team_id) && <TeamChip name={getSelectedTeam(formData.loser_team_id)!.name} tone="red" />}
            </div>
          </div>
        )}

        {/* スコア */}
        <div className="glass-card rounded-xl p-6 border border-purple-500/30">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
            <div className="text-center">
              <label className="block text-sm font-medium mb-2 text-gray-300">勝者スコア</label>
              <div className="text-4xl font-bold text-green-400">15</div>
            </div>

            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 shadow-lg">
                <span className="text-white font-bold text-lg">VS</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-gray-300">敗者スコア</label>
              <input
                type="number"
                required
                min={0}
                max={14}
                value={formData.loser_score}
                onChange={(e) => setFormData({ ...formData, loser_score: toInt(e.target.value, 0) })}
                className="w-full px-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100 text-center text-2xl font-bold focus:outline-none focus:border-purple-400"
              />
              <p className="text-xs text-gray-500 mt-1 text-center">0〜14点</p>
            </div>
          </div>
        </div>

        {/* 会場・備考（DB に列があればサーバ送信も可） */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="glass-card rounded-xl p-6 border border-purple-500/30">
            <label className="block text-sm font-medium mb-2 text-gray-300">
              <FaMapMarkerAlt className="inline mr-2 text-purple-400" />
              会場（任意）
            </label>
            <input
              type="text"
              value={formData.venue}
              onChange={(e) => setFormData({ ...formData, venue: e.target.value })}
              className="w-full px-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100 focus:outline-none focus:border-purple-400"
              placeholder="例: 〇〇体育館"
            />
          </div>

          <div className="glass-card rounded-xl p-6 border border-purple-500/30">
            <label className="block text-sm font-medium mb-2 text-gray-300">
              <FaStickyNote className="inline mr-2 text-purple-400" />
              備考（任意）
            </label>
            <input
              type="text"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100 focus:outline-none focus:border-purple-400"
              placeholder="試合に関するメモ"
            />
          </div>
        </div>

        {/* 個人戦プレビュー（団体戦は個人 RP/HC を変えないため省略） */}
        {mode === 'singles' && winner && loser && (
          <PreviewPanel
            winner={winner}
            loser={loser}
            loserScore={formData.loser_score}
            calc={calculatePointsAndHandicapChange}
          />
        )}

        {/* 送信ボタン */}
        <div className="flex justify-center">
          <button
            type="submit"
            disabled={
              loading ||
              (mode === 'singles'
                ? !formData.winner_id || !formData.loser_id
                : !formData.winner_team_id || !formData.loser_team_id)
            }
            className="gradient-button px-12 py-4 rounded-full text-white font-medium text-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                登録中...
              </>
            ) : (
              <>
                <FaTrophy />
                試合結果を登録
              </>
            )}
          </button>
        </div>
      </form>

      {/* 注意事項 */}
      <div className="max-w-4xl mx-auto mt-8">
        <div className="glass-card rounded-lg p-4 border border-blue-500/30 bg-blue-900/20">
          <p className="text-sm text-blue-400">
            ※ 登録後は自動で「試合結果一覧」へ遷移します。<br />
            ※ 団体戦では個人 RP/HC は変更しません（チームランキングは集計で管理）。
          </p>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================
 * Small UI components
 * ===================================================================== */

function PlayerCard({ player, tone }: { player: Player; tone: 'green' | 'red' }) {
  return (
    <div className={`mt-4 p-3 bg-${tone}-500/10 rounded-lg flex items-center gap-3`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={player.avatar_url || '/default-avatar.png'}
        alt={player.handle_name}
        className={`w-12 h-12 rounded-full border-2 border-${tone}-500 object-cover`}
      />
      <div>
        <p className="font-bold text-yellow-100">{player.handle_name}</p>
        <p className="text-sm text-gray-400">RP: {player.ranking_points} | HC: {player.handicap}</p>
      </div>
    </div>
  );
}

function TeamChip({ name, tone }: { name: string; tone: 'green' | 'red' }) {
  return (
    <div className={`mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-${tone}-500/10 border border-${tone}-500/40`}>
      <span className={`w-2 h-2 rounded-full bg-${tone}-400`} />
      <span>{name}</span>
    </div>
  );
}

function PreviewPanel(props: {
  winner: Player;
  loser: Player;
  loserScore: number;
  calc: (
    wp: number,
    lp: number,
    wh: number,
    lh: number,
    diff: number
  ) => { winnerPointsChange: number; loserPointsChange: number };
}) {
  const { winner, loser, loserScore, calc } = props;

  const res = calc(
    winner.ranking_points,
    loser.ranking_points,
    winner.handicap,
    loser.handicap,
    15 - loserScore
  );

  return (
    <div className="glass-card rounded-xl p-6 border border-purple-500/30">
      <h3 className="text-lg font-bold mb-4 text-yellow-100">ポイント変動予測（個人戦）</h3>
      <div className="grid grid-cols-2 gap-4 text-center">
        <div className="p-4 bg-green-500/10 rounded-lg">
          <p className="text-sm text-gray-400">勝者</p>
          <p className="font-bold text-yellow-100">{winner.handle_name}</p>
          <p className="text-2xl font-bold text-green-400">+{res.winnerPointsChange}pt</p>
        </div>
        <div className="p-4 bg-red-500/10 rounded-lg">
          <p className="text-sm text-gray-400">敗者</p>
          <p className="font-bold text-yellow-100">{loser.handle_name}</p>
          <p className="text-2xl font-bold text-red-400">{res.loserPointsChange}pt</p>
        </div>
      </div>
    </div>
  );
}
