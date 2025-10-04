// app/(main)/matches/register/singles/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FaGamepad, FaLock, FaTrophy, FaCalendar, FaUserFriends, FaMinus, FaPlus, FaShieldAlt,
} from 'react-icons/fa';

import { createClient } from '@/lib/supabase/client';
import { useFetchPlayersData } from '@/lib/hooks/useFetchSupabaseData';

/* ───────────────────────────── Types ───────────────────────────── */
type Player = {
  id: string;
  handle_name: string;        // ← UI はこれを参照（display_name が来ても正規化で吸収）
  ranking_points: number;
  handicap: number;
  avatar_url?: string | null;
};
type PlayerAdminRow = { id: string; is_admin: boolean | null };

type ApiSuccess = {
  ok: true;
  match_id: string;
  winner_id: string;
  loser_id: string;
  apply_rating: boolean;
  deltas: null | {
    winner: { points: number; handicap: number };
    loser:  { points: number; handicap: number };
  };
};

/* ───────────────────────────── Helpers ───────────────────────────── */
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
/** datetime-local 用：ローカルタイムの初期値（YYYY-MM-DDTHH:mm） */
function nowLocalDatetime() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
/** 正負記号つき表示（0 は ±0） */
function fmtSigned(n: number) {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${n}`;
  return '±0';
}

/* ───────────────────────────── Page ───────────────────────────── */
export default function SinglesRegisterPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // 認証状態（Supabase 直読み・/auth/whoami 依存を排除）
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (alive) setAuthed(!!data?.user);
      } catch {
        if (alive) setAuthed(false);
      }
    })();

    // auth の変化も追従
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session?.user);
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [supabase]);

  // 自分のプレイヤーID & 管理者判定
  const [me, setMe] = useState<{ id: string; is_admin: boolean } | null>(null);
  useEffect(() => {
    if (authed !== true) return;
    let alive = true;
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;
      if (!user) { if (alive) setMe(null); return; }

      const { data: row, error: rowErr } = await supabase
        .from('players')
        .select('id,is_admin')
        .eq('id', user.id)
        .single<PlayerAdminRow>();

      // 取得失敗時は is_admin=false 扱いで継続
      if (alive) setMe({ id: user.id, is_admin: !rowErr && Boolean(row?.is_admin) });
    })();
    return () => { alive = false; };
  }, [authed, supabase]);

  // プレイヤー一覧（認証後のみ）
  const { players: rawPlayers = [], loading: playersLoading, error: playersError } =
    useFetchPlayersData();

  // ★★★ 互換レイヤー：display_name / current_points 系を handle_name / ranking_points に正規化（最小追加）
  const players: Player[] = useMemo(() => {
    return (rawPlayers as any[]).map((r) => ({
      id: r.id,
      handle_name: r.handle_name ?? r.display_name ?? '',          // ← UI は常に handle_name を参照
      ranking_points: r.ranking_points ?? r.current_points ?? 0,   // 後方互換
      handicap: r.handicap ?? r.current_handicap ?? 0,             // 後方互換
      avatar_url: r.avatar_url ?? r.avatar ?? null,
    }));
  }, [rawPlayers]);

  // UI 状態
  const [matchDate, setMatchDate] = useState(nowLocalDatetime());
  const [opponentId, setOpponentId] = useState('');
  const [iWon, setIWon] = useState(true);
  const [loserScore, setLoserScore] = useState(0); // 0-14
  const [adminMode, setAdminMode] = useState(false);
  const [winnerIdAdmin, setWinnerIdAdmin] = useState('');
  const [loserIdAdmin, setLoserIdAdmin] = useState('');

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ApiSuccess | null>(null);
  const submittingRef = useRef(false);

  // 従来の変数名/ロジックを維持
  const opponents = (players as Player[]).filter(p => p.id !== me?.id);
  const nameById = (id: string) =>
    (players as Player[]).find(p => p.id === id)?.handle_name || `${id?.slice(0, 8)}…`;

  const resetForm = () => {
    setMatchDate(nowLocalDatetime());
    setOpponentId('');
    setIWon(true);
    setLoserScore(0);
    setAdminMode(false);
    setWinnerIdAdmin('');
    setLoserIdAdmin('');
    setSuccess(false);
    setError('');
    setResult(null);
  };

  // 送信
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError('');
    setSuccess(false);
    setResult(null);

    try {
      if (authed !== true || !me?.id) throw new Error('ログインが必要です');

      // HTML の datetime-local はローカル時刻で返るため、そのまま文字列で API へ
      const when = String(matchDate || '').trim();
      if (!when) throw new Error('試合日時を入力してください');

      let payload: any;

      if (adminMode && me.is_admin) {
        // 管理者はフル指定
        if (!winnerIdAdmin || !loserIdAdmin || winnerIdAdmin === loserIdAdmin) {
          throw new Error('管理者モード: 勝者と敗者を正しく選択してください');
        }
        if (loserScore < 0 || loserScore > 14) {
          throw new Error('敗者スコアは 0〜14 点です');
        }
        payload = {
          mode: 'singles',
          match_date: when,
          winner_id: winnerIdAdmin,
          loser_id: loserIdAdmin,
          loser_score: loserScore,
        };
      } else {
        // 一般ユーザー: 自分主体
        if (!opponentId) throw new Error('対戦相手を選択してください');
        if (loserScore < 0 || loserScore > 14) {
          throw new Error('敗者スコアは 0〜14 点です');
        }
        const winner_id = iWon ? me.id : opponentId;
        const loser_id  = iWon ? opponentId : me.id;

        payload = {
          mode: 'singles',
          match_date: when,
          winner_id,
          loser_id,
          loser_score: loserScore,
        };
      }

      const res = await fetch('/api/matches', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
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

      const j = (await res.json()) as ApiSuccess;
      setResult(j);
      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || '登録に失敗しました');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  /* ─────────── 画面表示 ─────────── */
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
          <Link href="/login?redirect=/matches/register/singles" className="underline text-purple-300">
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
        <p className="text-gray-400 mt-1">自分が出場した個人戦のみ登録できます（管理者は全試合可）。</p>

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

      {/* エラー/成功 */}
      {playersError && (
        <div className="glass-card rounded-md p-3 mb-4 border border-red-500/40 bg-red-500/10">
          <p className="text-red-300 text-sm">プレイヤー一覧の取得に失敗しました。時間をおいて再度お試しください。</p>
        </div>
      )}
      {error && (
        <div className="glass-card rounded-md p-3 mb-4 border border-red-500/40 bg-red-500/10" aria-live="polite">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}
      {success && result && (
        <div className="glass-card rounded-md p-4 mb-6 border border-green-500/40 bg-green-500/10" aria-live="polite">
          <p className="text-green-300 font-semibold mb-2">🎉 登録しました</p>
          <div className="text-sm text-green-100/90">
            <div className="mb-1">
              勝者 <span className="font-semibold text-green-300">{nameById(result.winner_id)}</span> ／
              敗者 <span className="font-semibold text-red-300">{nameById(result.loser_id)}</span>
            </div>
            {result.deltas ? (
              <>
                <div className="mt-2">
                  <span className="opacity-80">ランキングポイント：</span>
                  <span className="ml-1">勝者 <b>{fmtSigned(result.deltas.winner.points)}</b></span>
                  <span className="ml-3">敗者 <b>{fmtSigned(result.deltas.loser.points)}</b></span>
                </div>
                <div className="mt-1">
                  <span className="opacity-80">ハンディキャップ：</span>
                  <span className="ml-1">勝者 <b>{fmtSigned(result.deltas.winner.handicap)}</b></span>
                  <span className="ml-3">敗者 <b>{fmtSigned(result.deltas.loser.handicap)}</b></span>
                </div>
                <div className="mt-2 text-xs text-green-200/80">
                  レーティング反映: {result.apply_rating ? '適用済み' : '未適用（権限や設定により今回は反映されていません）'}
                </div>
              </>
            ) : (
              <div className="mt-2 text-xs text-green-200/80">
                今回はレーティング変動の対象外です。
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/matches"
              className="px-4 py-2 rounded-lg bg-green-600/80 hover:bg-green-600 text-white text-sm"
            >
              試合一覧へ
            </Link>
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
            >
              続けて登録する
            </button>
          </div>
        </div>
      )}

      {/* フォーム */}
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
              <span className="text-amber-300 text-sm">管理者モード（任意: 任意の勝者/敗者で登録）</span>
            </label>

            {adminMode && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">勝者</label>
                  <select
                    value={winnerIdAdmin}
                    onChange={(e) => setWinnerIdAdmin(e.target.value)}
                    className="w-full px-3 py-2 bg-purple-900/30 border border-amber-500/30 rounded-lg text-yellow-100"
                  >
                    <option value="">選択してください</option>
                    {(players as Player[]).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.handle_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">敗者</label>
                  <select
                    value={loserIdAdmin}
                    onChange={(e) => setLoserIdAdmin(e.target.value)}
                    className="w-full px-3 py-2 bg-purple-900/30 border border-amber-500/30 rounded-lg text-yellow-100"
                  >
                    <option value="">選択してください</option>
                    {(players as Player[]).map((p) => (
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

        {/* 一般モード（自分主体） */}
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

        {/* スコア（敗者スコアだけ決める方式 / ステッパー付） */}
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
            disabled={
              loading ||
              playersLoading ||
              (adminMode && me?.is_admin ? (!winnerIdAdmin || !loserIdAdmin || winnerIdAdmin === loserIdAdmin) : !opponentId)
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

      {/* 注意 */}
      <div className="mt-6 glass-card rounded-md p-4 border border-blue-500/30 bg-blue-900/20 text-sm text-blue-300">
        勝者スコアは 15 点固定、敗者スコアは 0〜14 点で登録されます。
      </div>
    </div>
  );
}
