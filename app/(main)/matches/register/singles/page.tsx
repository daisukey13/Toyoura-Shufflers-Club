// app/(main)/matches/register/singles/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FaGamepad,
  FaLock,
  FaTrophy,
  FaCalendar,
  FaUserFriends,
  FaMinus,
  FaPlus,
  FaShieldAlt,
} from 'react-icons/fa';

import { createClient } from '@/lib/supabase/client';
import { useFetchPlayersData } from '@/lib/hooks/useFetchSupabaseData';

type Player = {
  id: string;
  handle_name: string;
  ranking_points: number;
  handicap: number;
  avatar_url?: string | null;
};

type PlayerAdminRow = {
  id: string;
  is_admin: boolean | null;
};

type AdminRow = { user_id: string };

type Tournament = {
  id: string;
  name: string | null;
};

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
  } catch {
    // ignore
  }
  return msg;
}

const toInt = (v: string | number, fb = 0) => {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fb;
};

export default function SinglesRegisterPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // ==== 認証確認 (/auth/whoami) ====
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/auth/whoami', {
          cache: 'no-store',
          credentials: 'include',
        });
        const j = r.ok ? await r.json() : { authenticated: false };
        if (alive) setAuthed(!!j?.authenticated);
      } catch {
        if (alive) setAuthed(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ==== 自分のプレイヤーID & 管理者判定（players + app_admins の両方を見る）====
  const [me, setMe] = useState<{ id: string; is_admin: boolean } | null>(null);
  useEffect(() => {
    if (authed !== true) return;
    let alive = true;

    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;
      if (!user) {
        if (alive) setMe(null);
        return;
      }

      const [playerResp, adminResp] = await Promise.all([
        supabase
          .from('players')
          .select('id,is_admin')
          .eq('id', user.id)
          .maybeSingle<PlayerAdminRow>(),
        supabase
          .from('app_admins')
          .select('user_id')
          .eq('user_id', user.id)
          .maybeSingle<AdminRow>(),
      ]);

      const playerRow = (playerResp?.data ?? null) as PlayerAdminRow | null;
      const adminRow = (adminResp?.data ?? null) as AdminRow | null;

      const isAdmin =
        Boolean(playerRow?.is_admin) || Boolean(adminRow?.user_id);

      if (alive) setMe({ id: user.id, is_admin: isAdmin });
    })();

    return () => {
      alive = false;
    };
  }, [authed, supabase]);

  // ==== プレイヤー一覧 ====
  const {
    players = [],
    loading: playersLoading,
    error: playersError, // 使わないが、将来のデバッグ用に保持
  } = useFetchPlayersData({ enabled: authed === true, requireAuth: true });

  // ==== 大会一覧（任意指定用） ====
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [tournamentsLoading, setTournamentsLoading] = useState(false);
  const [selectedTournamentId, setSelectedTournamentId] = useState('');

  useEffect(() => {
    if (authed !== true) return;
    let cancelled = false;

    (async () => {
      setTournamentsLoading(true);
      try {
        const { data, error } = await supabase
          .from('tournaments')
          .select('id, name, created_at')
          .order('created_at', { ascending: false });

        if (!error && !cancelled) {
          setTournaments((data ?? []) as Tournament[]);
        }
      } catch (e) {
        console.warn('[singles/register] tournaments fetch error:', e);
      } finally {
        if (!cancelled) setTournamentsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authed, supabase]);

  // ==== フォーム状態 ====
  const [matchDate, setMatchDate] = useState(
    new Date().toISOString().slice(0, 16),
  );
  const [opponentId, setOpponentId] = useState('');
  const [iWon, setIWon] = useState(true);
  const [loserScore, setLoserScore] = useState(0); // 0–14

  // 管理者モード（勝者/敗者を直接選べる UI）
  const [adminMode, setAdminMode] = useState(false);
  const [winnerIdAdmin, setWinnerIdAdmin] = useState('');
  const [loserIdAdmin, setLoserIdAdmin] = useState('');

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);

  const opponents = (players as Player[]).filter((p) => p.id !== me?.id);

  // ==== 送信処理 ====
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      if (authed !== true || !me?.id) {
        throw new Error('ログインが必要です');
      }
      if (loserScore < 0 || loserScore > 14) {
        throw new Error('敗者スコアは 0〜14 点です');
      }

      let payload: any;

      if (adminMode && me.is_admin) {
        // === 管理者モード ===
        if (!winnerIdAdmin || !loserIdAdmin || winnerIdAdmin === loserIdAdmin) {
          throw new Error('管理者モード: 勝者と敗者を正しく選択してください');
        }

        payload = {
          match_date: matchDate,
          winner_id: winnerIdAdmin,
          loser_id: loserIdAdmin,
          loser_score: loserScore,
          opponent_id:
            winnerIdAdmin === me.id ? loserIdAdmin : winnerIdAdmin,
          i_won: winnerIdAdmin === me.id,
          admin_mode: true,
        };
      } else {
        // === 一般モード（自分主体）===
        if (!opponentId) {
          throw new Error('対戦相手を選択してください');
        }

        const winner_id = iWon ? me.id : opponentId;
        const loser_id = iWon ? opponentId : me.id;

        payload = {
          match_date: matchDate,
          opponent_id: opponentId,
          i_won: iWon,
          loser_score: loserScore,
          winner_id,
          loser_id,
        };
      }

      // ★ 大会が選択されていれば tournament_id を付ける
      if (selectedTournamentId) {
        payload.tournament_id = selectedTournamentId;
      }

      const res = await fetch('/api/matches', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const msg = await parseRestError(res);
        throw new Error(`登録に失敗しました: ${msg}`);
      }

      setSuccess(true);
      setTimeout(() => {
        router.push('/matches');
      }, 700);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || '登録に失敗しました');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  // ==== 画面表示 ====

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
          <Link
            href="/login?redirect=/matches/register/singles"
            className="underline text-purple-300"
          >
            ログインへ移動
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      {/* ヘッダ */}
      <div className="text-center mb-8">
        <div className="inline-block p-4 mb-3 rounded-full bg-gradient-to-br from-purple-400/20 to-pink-600/20">
          <FaGamepad className="text-4xl text-purple-300" />
        </div>
        <h1 className="text-3xl font-bold text-yellow-100">個人試合を登録</h1>
        <p className="text-gray-400 mt-1">
          自分が出場した個人戦のみ登録できます（管理者は全試合を登録できます）。
        </p>

        <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 bg-green-500/20 rounded-full">
          <FaLock className="text-green-400 text-sm" />
          <span className="text-green-400 text-sm">ログイン済み</span>
          {me?.is_admin && (
            <span className="inline-flex items-center gap-1 ml-2 text-xs text-amber-300">
              <FaShieldAlt /> 管理者
            </span>
          )}
        </div>
      </div>

      {/* エラー/成功メッセージ */}
      {error && (
        <div className="glass-card rounded-md p-3 mb-4 border border-red-500/40 bg-red-500/10">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}
      {success && (
        <div className="glass-card rounded-md p-3 mb-4 border border-green-500/40 bg-green-500/10">
          <p className="text-green-300 text-sm">
            🎉 登録しました。まもなく一覧へ移動します…
          </p>
        </div>
      )}

      {/* フォーム本体 */}
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

        {/* ★ 大会（任意） */}
        {tournaments.length > 0 && (
          <div className="glass-card rounded-xl p-5 border border-purple-500/30">
            <label className="block text-sm font-medium mb-2 text-gray-300">
              大会（任意）
            </label>
            <select
              value={selectedTournamentId}
              onChange={(e) => setSelectedTournamentId(e.target.value)}
              className="w-full px-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100"
            >
              <option value="">
                指定しない（通常の個人戦として登録）
              </option>
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name ?? '(大会名未設定)'}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-gray-400">
              大会を指定すると、この試合はその大会の戦績としても記録されます。
              リーグ戦の場合は、同じ大会の同一ブロックに所属している 2 人の試合であれば、
              自動的にリーグブロックにも紐付きます。
            </p>
          </div>
        )}

        {/* 管理者モード */}
        {me?.is_admin && (
          <div className="glass-card rounded-xl p-5 border border-amber-500/30">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-amber-400"
                checked={adminMode}
                onChange={(e) => setAdminMode(e.target.checked)}
              />
              <span className="text-amber-300 text-sm">
                管理者モード（任意の勝者/敗者で登録）
              </span>
            </label>

            {adminMode && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">
                    勝者
                  </label>
                  <select
                    value={winnerIdAdmin}
                    onChange={(e) => setWinnerIdAdmin(e.target.value)}
                    className="w-full px-3 py-2 bg-purple-900/30 border border-amber-500/30 rounded-lg text-yellow-100"
                  >
                    <option value="">選択してください</option>
                    {players.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.handle_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">
                    敗者
                  </label>
                  <select
                    value={loserIdAdmin}
                    onChange={(e) => setLoserIdAdmin(e.target.value)}
                    className="w-full px-3 py-2 bg-purple-900/30 border border-amber-500/30 rounded-lg text-yellow-100"
                  >
                    <option value="">選択してください</option>
                    {players.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.handle_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 一般モード（自分主体の UI） */}
        {!adminMode && (
          <div className="glass-card rounded-xl p-5 border border-purple-500/30">
            <label className="block text-sm font-medium mb-2 text-gray-300">
              <FaUserFriends className="inline mr-2 text-purple-400" />
              対戦相手
            </label>
            <select
              required
              value={opponentId}
              onChange={(e) => setOpponentId(e.target.value)}
              className="w-full px-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100"
            >
              <option value="">選択してください</option>
              {opponents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.handle_name}
                </option>
              ))}
            </select>

            {/* 勝敗切り替え */}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setIWon(true)}
                className={`px-4 py-2 rounded-lg border transition-all ${
                  iWon
                    ? 'bg-green-500/20 border-green-400/60 text-green-200'
                    : 'bg-purple-900/20 border-purple-500/30 text-gray-300'
                }`}
              >
                自分の勝ち
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
                自分の負け
              </button>
            </div>
          </div>
        )}

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
                  onClick={() => setLoserScore((s) => Math.max(0, s - 1))}
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
                  onClick={() => setLoserScore((s) => Math.min(14, s + 1))}
                >
                  <FaPlus />
                </button>
              </div>
              <div className="text-[11px] text-gray-500 mt-1">0〜14点</div>
            </div>
          </div>
        </div>

        {/* 送信ボタン */}
        <div className="flex justify-center">
          <button
            type="submit"
            disabled={
              loading ||
              playersLoading ||
              tournamentsLoading ||
              (adminMode && me?.is_admin
                ? !winnerIdAdmin ||
                  !loserIdAdmin ||
                  winnerIdAdmin === loserIdAdmin
                : !opponentId)
            }
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

      {/* 注意書き */}
      <div className="mt-6 glass-card rounded-md p-4 border border-blue-500/30 bg-blue-900/20 text-sm text-blue-300">
        勝者スコアは 15 点固定、敗者スコアは 0〜14 点で登録されます。
      </div>
    </div>
  );
}
