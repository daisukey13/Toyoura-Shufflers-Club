// app/(main)/admin/league-blocks/[blockId]/matches/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FaShieldAlt, FaTrophy } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

type MatchRow = {
  id: string;
  match_date: string | null;
  player_a_id: string | null;
  player_b_id: string | null;
  winner_id: string | null;
  loser_id: string | null;
  winner_score: number | null;
  loser_score: number | null;
  status: string | null;
};

type PlayerRow = {
  id: string;
  handle_name: string | null;
};

type BlockRow = {
  id: string;
  label: string | null;
  tournament_id: string | null;
};

type TournamentRow = {
  id: string;
  name: string | null;
};

type AdminRow = { user_id: string };
type PlayerFlagRow = { is_admin: boolean | null };

export default function AdminLeagueBlockMatchesPage() {
  const router = useRouter();
  const params = useParams();
  const blockId =
    typeof params?.blockId === 'string' ? (params.blockId as string) : '';

  const [authz, setAuthz] = useState<'checking' | 'ok' | 'no'>('checking');

  const [block, setBlock] = useState<BlockRow | null>(null);
  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [playerMap, setPlayerMap] = useState<Map<string, PlayerRow>>(new Map());

  const [loading, setLoading] = useState(true);
  const [savingMatchId, setSavingMatchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // 認証 + 管理者チェック
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/auth/whoami', { cache: 'no-store' });
        const j = r.ok ? await r.json() : { authenticated: false };
        if (!j?.authenticated) {
          router.replace('/login?redirect=/admin/dashboard');
          return;
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace('/login?redirect=/admin/dashboard');
          return;
        }

        const [adminResp, playerResp] = await Promise.all([
          (supabase.from('app_admins') as any)
            .select('user_id')
            .eq('user_id', user.id)
            .maybeSingle(),
          (supabase.from('players') as any)
            .select('is_admin')
            .eq('id', user.id)
            .maybeSingle(),
        ]);

        const adminRow = (adminResp?.data ?? null) as AdminRow | null;
        const playerRow = (playerResp?.data ?? null) as PlayerFlagRow | null;

        let isAdmin = false;
        if (adminRow?.user_id) isAdmin = true;
        if (playerRow?.is_admin === true) isAdmin = true;

        if (!isAdmin) {
          setAuthz('no');
          return;
        }

        if (!cancelled) {
          setAuthz('ok');
          void loadAll(blockId);
        }
      } catch (e) {
        console.error('[admin/league-blocks/matches] auth error:', e);
        setAuthz('no');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, blockId]);

  const loadAll = async (bId: string) => {
    if (!bId) {
      setError('ブロックIDが指定されていません');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      // 1) ブロック情報
      const { data: blockData, error: blockErr } = await supabase
        .from('league_blocks')
        .select('id, label, tournament_id')
        .eq('id', bId)
        .maybeSingle();

      if (blockErr || !blockData) {
        throw new Error('リーグブロック情報の取得に失敗しました');
      }
      setBlock(blockData as BlockRow);

      // 2) 大会情報
      if (blockData.tournament_id) {
        const { data: tData, error: tErr } = await supabase
          .from('tournaments')
          .select('id, name')
          .eq('id', blockData.tournament_id)
          .maybeSingle();

        if (!tErr && tData) {
          setTournament(tData as TournamentRow);
        }
      }

      // 3) このブロックの試合一覧
      const { data: matchesData, error: mErr } = await supabase
        .from('matches')
        .select(
          'id, match_date, player_a_id, player_b_id, winner_id, loser_id, winner_score, loser_score, status'
        )
        .eq('league_block_id', bId)
        .order('match_date', { ascending: true });

      if (mErr) {
        throw new Error('試合一覧の取得に失敗しました');
      }

      const ms = (matchesData ?? []) as MatchRow[];
      setMatches(ms);

      // 4) 関連プレーヤー一覧
      const ids = Array.from(
        new Set(
          ms
            .flatMap((m) => [
              m.player_a_id,
              m.player_b_id,
              m.winner_id,
              m.loser_id,
            ])
            .filter((x): x is string => !!x)
        )
      );

      if (ids.length > 0) {
        const { data: playersData, error: pErr } = await supabase
          .from('players')
          .select('id, handle_name')
          .in('id', ids);

        if (pErr) {
          console.warn('[admin/league-blocks/matches] players error:', pErr);
        } else {
          const map = new Map<string, PlayerRow>();
          (playersData ?? []).forEach((p: any) => {
            map.set(p.id, { id: p.id, handle_name: p.handle_name });
          });
          setPlayerMap(map);
        }
      } else {
        setPlayerMap(new Map());
      }

      setLoading(false);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'データ取得に失敗しました');
      setLoading(false);
    }
  };

  const getName = (id: string | null) => {
    if (!id) return '---';
    const p = playerMap.get(id);
    return p?.handle_name || '(名前未設定)';
  };

  // 試合1件の結果登録
  const handleReport = async (
    e: React.FormEvent<HTMLFormElement>,
    match: MatchRow
  ) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const form = e.currentTarget;
    const winnerId = (form.elements.namedItem(
      'winner_id'
    ) as HTMLSelectElement)?.value;
    const loserScoreRaw = (form.elements.namedItem(
      'loser_score'
    ) as HTMLInputElement)?.value;

    if (!winnerId) {
      setError('勝者を選択してください');
      return;
    }
    if (!match.player_a_id || !match.player_b_id) {
      setError('プレーヤー情報が不足しています');
      return;
    }

    const loserScore = (() => {
      const n = parseInt(loserScoreRaw ?? '0', 10);
      if (!Number.isFinite(n)) return 0;
      return Math.min(14, Math.max(0, n));
    })();

    const loserId =
      winnerId === match.player_a_id ? match.player_b_id : match.player_a_id;

    try {
      setSavingMatchId(match.id);

      const res = await fetch(`/api/matches/${match.id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          winner_id: winnerId,
          loser_id: loserId,
          loser_score: loserScore,
        }),
      });

      const text = await res.text();
      let j: any = null;
      try {
        j = JSON.parse(text);
      } catch {
        // ignore
      }

      if (!res.ok || (j && j.ok === false)) {
        const msg =
          j?.message ||
          j?.hint ||
          j?.details ||
          text ||
          `HTTP ${res.status}`;
        throw new Error(msg);
      }

      setMessage('試合結果を登録しました');
      await loadAll(blockId);
    } catch (e: any) {
      console.error(e);
      setError(`試合結果の登録に失敗しました: ${e?.message || 'エラー'}`);
    } finally {
      setSavingMatchId(null);
    }
  };

  // 認証中 / 権限なし表示
  if (authz === 'checking') {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">
        認証を確認しています...
      </div>
    );
  }

  if (authz === 'no') {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">
        アクセス権限がありません
      </div>
    );
  }

  if (!blockId) {
    return (
      <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">
        ブロックIDが指定されていません
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full">
              <FaShieldAlt className="text-2xl" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">
                リーグ試合結果入力
              </h1>
              <div className="text-sm text-gray-300 mt-1">
                ブロック: ブロック {block?.label ?? '-'}{' '}
                {tournament && (
                  <span className="ml-2 text-xs text-gray-400">
                    （{tournament.name ?? '大会名未設定'}）
                  </span>
                )}
              </div>
            </div>
          </div>
          <Link
            href={`/admin/tournaments/${block?.tournament_id ?? ''}/league`}
            className="text-xs md:text-sm text-blue-300 underline"
          >
            ← ブロック一覧に戻る
          </Link>
        </div>

        {/* メッセージ */}
        {error && (
          <div className="mb-4 rounded-md border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-4 rounded-md border border-green-500/50 bg-green-500/10 px-4 py-2 text-sm text-green-200">
            {message}
          </div>
        )}

        {loading ? (
          <div className="text-gray-300">読み込み中...</div>
        ) : matches.length === 0 ? (
          <div className="text-gray-300">
            このブロックにはまだ試合が登録されていません。
          </div>
        ) : (
          <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-4 md:p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <FaTrophy className="text-yellow-300" />
              試合一覧と結果入力
            </h2>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-800 text-gray-100 text-xs">
                    <th className="border px-2 py-1 text-left">試合</th>
                    <th className="border px-2 py-1 text-left">現状</th>
                    <th className="border px-2 py-1 text-left">結果入力</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => {
                    const aName = getName(m.player_a_id);
                    const bName = getName(m.player_b_id);

                    const hasResult = !!m.winner_id && !!m.loser_id;
                    let currentResult = '未入力';
                    if (hasResult) {
                      const wName = getName(m.winner_id);
                      const lName = getName(m.loser_id);
                      currentResult = `${wName} ${m.winner_score ?? 15} - ${
                        m.loser_score ?? 0
                      } ${lName}`;
                    }

                    return (
                      <tr key={m.id}>
                        <td className="border px-2 py-1 align-top">
                          <div className="flex flex-col">
                            <span>{aName}</span>
                            <span className="text-xs text-gray-400">vs</span>
                            <span>{bName}</span>
                          </div>
                        </td>
                        <td className="border px-2 py-1 align-top">
                          <span
                            className={
                              hasResult
                                ? 'text-green-300'
                                : 'text-gray-300'
                            }
                          >
                            {currentResult}
                          </span>
                        </td>
                        <td className="border px-2 py-1 align-top">
                          <form
                            onSubmit={(e) => handleReport(e, m)}
                            className="flex flex-col md:flex-row md:items-center gap-2"
                          >
                            <select
                              name="winner_id"
                              defaultValue={m.winner_id ?? ''}
                              className="min-w-[140px] px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-xs md:text-sm"
                            >
                              <option value="">勝者を選択</option>
                              {m.player_a_id && (
                                <option value={m.player_a_id}>{aName}</option>
                              )}
                              {m.player_b_id && (
                                <option value={m.player_b_id}>{bName}</option>
                              )}
                            </select>
                            <div className="flex items-center gap-1 text-xs md:text-sm">
                              <span className="text-gray-300">敗者スコア</span>
                              <input
                                name="loser_score"
                                type="number"
                                min={0}
                                max={14}
                                defaultValue={m.loser_score ?? 0}
                                className="w-16 px-2 py-1 rounded border border-purple-500/40 bg-gray-900/80 text-center"
                              />
                              <span className="text-gray-500 text-[11px]">
                                (0〜14)
                              </span>
                            </div>
                            <button
                              type="submit"
                              disabled={savingMatchId === m.id}
                              className="mt-1 md:mt-0 px-3 py-1 rounded bg-purple-600 text-white text-xs md:text-sm disabled:opacity-50"
                            >
                              {savingMatchId === m.id
                                ? '保存中...'
                                : hasResult
                                ? '更新'
                                : '登録'}
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-xs text-gray-400">
              ※ スコアは「勝者 15点固定、敗者 0〜14点」で登録されます。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
