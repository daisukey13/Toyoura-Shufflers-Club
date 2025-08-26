'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FaTrophy, FaCalendar, FaMapMarkerAlt, FaStickyNote, FaMedal, FaGamepad, FaDice, FaLock
} from 'react-icons/fa';

import { Player } from '@/types/player';
import { Tournament, MatchFormData } from '@/types/matches';

import { createClient } from '@/lib/supabase/client';
import {
  useFetchPlayersData,
  createMatch,
  updatePlayer,
} from '@/lib/hooks/useFetchSupabaseData';

type MatchType = 'normal' | 'tournament';

// DB 制約に合わせた既定値（必要なら .env で上書き）
const MODE_FOR_NORMAL =
  process.env.NEXT_PUBLIC_MATCH_MODE_NORMAL?.trim() || 'singles';
const MODE_FOR_TOURNAMENT =
  process.env.NEXT_PUBLIC_MATCH_MODE_TOURNAMENT?.trim() || 'singles';
const STATUS_ON_CREATE =
  process.env.NEXT_PUBLIC_MATCH_STATUS_ON_CREATE?.trim() || 'finalized';

export default function MatchRegisterPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // 1) サーバーCookie基準のログイン確認（true/false/null）
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

  // 2) プレイヤーはログイン確認後にだけ取得（フラッシュ防止）
  const {
    players,
    loading: playersLoading,
    error: playersError,
  } = useFetchPlayersData({ enabled: authed === true, requireAuth: true });

  // 3) 大会データ
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [tournamentsLoading, setTournamentsLoading] = useState(true);

  useEffect(() => {
    if (authed !== true) return;
    let cancelled = false;

    const fetchTournaments = async () => {
      setTournamentsLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const headers = {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${token ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
          'Content-Type': 'application/json',
        };

        const tryUrls = [
          `${base}/rest/v1/tournaments?is_active=eq.true&order=tournament_date.desc`,
          `${base}/rest/v1/tournaments?is_active=eq.true&order=created_at.desc`,
          `${base}/rest/v1/tournaments?is_active=eq.true`,
        ];

        let got: Tournament[] | null = null;
        for (const url of tryUrls) {
          const res = await fetch(url, { headers });
          if (res.ok) {
            const json = (await res.json()) as Tournament[];
            got = json ?? [];
            break;
          }
        }
        if (!cancelled) setTournaments(got ?? []);
      } catch {
        if (!cancelled) setTournaments([]);
      } finally {
        if (!cancelled) setTournamentsLoading(false);
      }
    };

    fetchTournaments();
    return () => { cancelled = true; };
  }, [authed, supabase]);

  // 4) UI 状態
  const [matchType, setMatchType] = useState<MatchType>('normal');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState<MatchFormData>({
    match_date: new Date().toISOString().slice(0, 16),
    winner_id: '',
    loser_id: '',
    loser_score: 0,
    tournament_id: '',
    venue: '',
    notes: '',
  });

  const getSelectedPlayer = (playerId: string) =>
    players.find((p: any) => p.id === playerId) as Player | undefined;

  // 5) ポイント & ハンディ計算
  const calculatePointsAndHandicapChange = (
    winnerPoints: number,
    loserPoints: number,
    winnerHandicap: number,
    loserHandicap: number,
    scoreDifference: number,
    tournamentBonus: number = 1.0
  ) => {
    const K = 32;
    const expectedWinner = 1 / (1 + Math.pow(10, (loserPoints - winnerPoints) / 400));
    const scoreDiffMultiplier = 1 + scoreDifference / 30;
    const handicapDiff = winnerHandicap - loserHandicap;
    const handicapMultiplier = 1 + handicapDiff / 50;

    const baseWinnerChange = K * (1 - expectedWinner) * scoreDiffMultiplier * handicapMultiplier * tournamentBonus;
    const baseLoserChange  = -K * expectedWinner * scoreDiffMultiplier * tournamentBonus;

    const winnerHandicapChange = scoreDifference >= 10 ? -1 : 0;
    const loserHandicapChange  = scoreDifference >= 10 ?  1 : 0;

    return {
      winnerPointsChange: Math.round(baseWinnerChange),
      loserPointsChange:  Math.round(baseLoserChange),
      winnerHandicapChange,
      loserHandicapChange,
    };
  };

  /** セッション読み込みのレースを避けるため、ユーザーを確実に取得 */
  const waitForUser = async (tries = 10, delayMs = 250) => {
    for (let i = 0; i < tries; i++) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) return user;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
  };

  // 6) 送信
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      if (!authed) throw new Error('ログインが必要です');
      if (!formData.winner_id || !formData.loser_id) throw new Error('勝者と敗者を選択してください');
      if (formData.winner_id === formData.loser_id) throw new Error('同一プレイヤーは選べません');
      if (formData.loser_score >= 15) throw new Error('敗者スコアは 0〜14 点です');
      if (matchType === 'tournament' && !formData.tournament_id) throw new Error('大会を選択してください');

      // ← ここが重要：クライアント側のセッションが読み込まれるまで待つ
      const user = await waitForUser();
      if (!user) throw new Error('セッションが失効しました。ログインし直してください。');

      const winner = getSelectedPlayer(formData.winner_id);
      const loser  = getSelectedPlayer(formData.loser_id);
      if (!winner || !loser) throw new Error('プレイヤー情報の取得に失敗しました');

      let tournamentBonus = 1.0;
      if (matchType === 'tournament' && formData.tournament_id) {
        const t = tournaments.find((x) => x.id === formData.tournament_id);
        if (t) tournamentBonus = t.bonus_coefficient ?? 1.0;
      }

      const scoreDifference = 15 - (formData.loser_score ?? 0);
      const changes = calculatePointsAndHandicapChange(
        winner.ranking_points,
        loser.ranking_points,
        winner.handicap,
        loser.handicap,
        scoreDifference,
        tournamentBonus
      );

      // DB 制約に合わせた最小限のカラム（view 経由でも基表の制約を満たす）
      const detailPayload: any = {
        winner_id: formData.winner_id,
        loser_id: formData.loser_id,
        winner_score: 15,
        loser_score: formData.loser_score,
        match_date: formData.match_date,

        // ✅ 重要：NOT NULL / CHECK 制約に対応
        mode: matchType === 'tournament' ? MODE_FOR_TOURNAMENT : MODE_FOR_NORMAL, // 'singles' 既定
        status: STATUS_ON_CREATE,                                                // 'finalized' 既定
        reporter_id: user.id,                                                    // NOT NULL 用
      };

      // これらの列が存在する DB なら付与（存在しなくても view が無視するならOK）
      if (formData.venue) detailPayload.venue = formData.venue;
      if (formData.notes) detailPayload.notes = formData.notes;
      if (matchType === 'tournament' && formData.tournament_id) {
        detailPayload.tournament_id = formData.tournament_id;
        detailPayload.is_tournament = true; // 列が無ければ無視される/エラーなら消してください
      }

      // もし match_details に winner/loser のポイント変動列が無いなら、この2行は削除OK
      // detailPayload.winner_points_change = changes.winnerPointsChange;
      // detailPayload.loser_points_change  = changes.loserPointsChange;

      const { data: inserted, error: insertErr } = await createMatch(detailPayload);
      if (insertErr) throw new Error(insertErr);

      // プレイヤーの更新
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
        updatePlayer(formData.loser_id,  loserNext),
      ]);
      if (uw.error) console.warn('Winner update warning:', uw.error);
      if (ul.error) console.warn('Loser  update warning:', ul.error);

      setSuccess(true);
      // すぐ一覧へ
      router.replace('/matches');
    } catch (err: any) {
      setError(err?.message || '登録に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const winner = getSelectedPlayer(formData.winner_id);
  const loser  = getSelectedPlayer(formData.loser_id);

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

  // 未ログイン（このページ内で案内。自動リダイレクトはさせない）
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

  // コンテンツ本体
  return (
    <div className="container mx-auto px-4 py-8">
      {/* ヘッダー */}
      <div className="text-center mb-12">
        <div className="inline-block p-4 mb-4 rounded-full bg-gradient-to-br from-purple-400/20 to-pink-600/20">
          <FaGamepad className="text-5xl text-purple-400" />
        </div>
        <h1 className="text-4xl font-bold mb-4 text-yellow-100">試合結果登録</h1>
        <p className="text-gray-400">熱戦の記録を残そう</p>
        <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 bg-green-500/20 rounded-full">
          <FaLock className="text-green-400 text-sm" />
          <span className="text-green-400 text-sm">ログイン済み</span>
        </div>
      </div>

      {error && (
        <div className="glass-card rounded-lg p-4 mb-6 border border-red-500/50 bg-red-500/10">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {success && (
        <div className="glass-card rounded-lg p-4 mb-6 border border-green-500/50 bg-green-500/10">
          <p className="text-green-400 text-center text-xl font-bold animate-pulse">
            🎉 試合結果を登録しました！
          </p>
        </div>
      )}

      {(playersLoading || tournamentsLoading) && (
        <div className="min-h-[140px] flex items-center justify-center mb-8">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-400" />
        </div>
      )}

      {/* フォーム */}
      <form onSubmit={handleSubmit} className="max-w-4xl mx-auto space-y-6">
        {/* 試合タイプ */}
        <div className="glass-card rounded-xl p-6 border border-purple-500/30">
          <label className="block text-sm font-medium mb-4 text-gray-300">試合タイプ</label>
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setMatchType('normal')}
              className={`p-4 rounded-lg border transition-all ${
                matchType === 'normal'
                  ? 'bg-gradient-to-r from-blue-500/20 to-purple-500/20 border-blue-500/50'
                  : 'bg-purple-900/20 border-purple-500/20 hover:border-purple-400/40'
              }`}
            >
              <FaDice className="text-2xl mb-2 mx-auto text-blue-400" />
              <p className="font-medium text-yellow-100">通常試合</p>
            </button>

            <button
              type="button"
              onClick={() => setMatchType('tournament')}
              className={`p-4 rounded-lg border transition-all ${
                matchType === 'tournament'
                  ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-500/50'
                  : 'bg-purple-900/20 border-purple-500/20 hover:border-purple-400/40'
              }`}
            >
              <FaMedal className="text-2xl mb-2 mx-auto text-yellow-400" />
              <p className="font-medium text-yellow-100">大会</p>
            </button>
          </div>
        </div>

        {/* 大会選択 */}
        {matchType === 'tournament' && (
          <div className="glass-card rounded-xl p-6 border border-yellow-500/30">
            <label className="block text-sm font-medium mb-2 text-gray-300">
              <FaMedal className="inline mr-2 text-yellow-400" />
              大会選択
            </label>
            <select
              required
              value={formData.tournament_id}
              onChange={(e) => setFormData({ ...formData, tournament_id: e.target.value })}
              className="w-full px-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100 focus:outline-none focus:border-purple-400"
            >
              <option value="">大会を選択してください</option>
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (ボーナス: {t.bonus_coefficient}倍)
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 日時 */}
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

        {/* プレイヤー選択 */}
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

            {getSelectedPlayer(formData.winner_id) && (
              <PlayerCard player={getSelectedPlayer(formData.winner_id)!} tone="green" />
            )}
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

            {getSelectedPlayer(formData.loser_id) && (
              <PlayerCard player={getSelectedPlayer(formData.loser_id)!} tone="red" />
            )}
          </div>
        </div>

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
                onChange={(e) =>
                  setFormData({ ...formData, loser_score: Number.isFinite(+e.target.value) ? parseInt(e.target.value) : 0 })
                }
                className="w-full px-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100 text-center text-2xl font-bold focus:outline-none focus:border-purple-400"
              />
              <p className="text-xs text-gray-500 mt-1 text-center">0〜14点</p>
            </div>
          </div>
        </div>

        {/* 会場・備考 */}
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

        {/* プレビュー */}
        {winner && loser && (
          <PreviewPanel
            winner={winner}
            loser={loser}
            loserScore={formData.loser_score}
            matchType={matchType}
            tournaments={tournaments}
            tournamentId={formData.tournament_id}
            calc={calculatePointsAndHandicapChange}
          />
        )}

        {/* 送信ボタン */}
        <div className="flex justify-center">
          <button
            type="submit"
            disabled={loading || !formData.winner_id || !formData.loser_id}
            className="gradient-button px-12 py-4 rounded-full text-white font-medium text-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
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
            ※ 試合結果の登録にはログインが必要です。<br />
            ※ 登録後の修正は管理者にお問い合わせください。
          </p>
        </div>
      </div>
    </div>
  );
}

/* --- 小さな表示用コンポーネント --- */

function PlayerCard({ player, tone }: { player: any; tone: 'green' | 'red' }) {
  // ※ Tailwind の動的クラスがツリーシェイクで落ちる場合は safelist に追加してください
  return (
    <div className={`mt-4 p-3 bg-${tone}-500/10 rounded-lg flex items-center gap-3`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={player.avatar_url || '/default-avatar.png'}
        alt={player.handle_name}
        className={`w-12 h-12 rounded-full border-2 border-${tone}-500`}
      />
      <div>
        <p className="font-bold text-yellow-100">{player.handle_name}</p>
        <p className="text-sm text-gray-400">RP: {player.ranking_points} | HC: {player.handicap}</p>
      </div>
    </div>
  );
}

function PreviewPanel(props: {
  winner: any; loser: any; loserScore: number;
  matchType: 'normal' | 'tournament';
  tournaments: Tournament[]; tournamentId: string;
  calc: (
    wp: number, lp: number, wh: number, lh: number, diff: number, bonus?: number
  ) => { winnerPointsChange: number; loserPointsChange: number; };
}) {
  const { winner, loser, loserScore, matchType, tournaments, tournamentId, calc } = props;

  const bonus =
    matchType === 'tournament' && tournamentId
      ? (tournaments.find(t => t.id === tournamentId)?.bonus_coefficient ?? 1)
      : 1;

  const res = calc(
    winner.ranking_points,
    loser.ranking_points,
    winner.handicap,
    loser.handicap,
    15 - loserScore,
    bonus
  );

  return (
    <div className="glass-card rounded-xl p-6 border border-purple-500/30">
      <h3 className="text-lg font-bold mb-4 text-yellow-100">ポイント変動予測</h3>
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
