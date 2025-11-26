// app/(main)/admin/tournaments/[tournamentId]/league/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

// ===== Types =====
type LeagueBlockRow = {
  id: string;
  label: string | null;
  status: string | null;
  winner_player_id: string | null;
  ranking_json: any[] | null;
};

type WinnerInfo = {
  id: string;
  handle_name: string | null;
};

type PlayerOption = {
  id: string;
  handle_name: string | null;
};

type TournamentInfo = {
  id: string;
  name: string | null;
};

// ===== Page Component =====
export default function AdminTournamentLeaguePage() {
  const params = useParams();
  const tournamentId =
    typeof params?.tournamentId === 'string'
      ? (params.tournamentId as string)
      : '';

  const [tournament, setTournament] = useState<TournamentInfo | null>(null);
  const [blocks, setBlocks] = useState<LeagueBlockRow[]>([]);
  const [winners, setWinners] = useState<Map<string, WinnerInfo>>(new Map());
  const [players, setPlayers] = useState<PlayerOption[]>([]);

  const [loading, setLoading] = useState(true);
  const [busyBlock, setBusyBlock] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // 新規ブロック作成フォーム
  const [blockLabel, setBlockLabel] = useState('A');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [p3, setP3] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!tournamentId) return;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    // 1) 大会情報
    const { data: t, error: tErr } = await supabase
      .from('tournaments')
      .select('id, name')
      .eq('id', tournamentId)
      .single();

    if (tErr) {
      console.error(tErr);
      setError('大会情報の取得に失敗しました');
      setLoading(false);
      return;
    }
    setTournament(t as TournamentInfo);

    // 2) ブロック一覧
    const { data: blocksData, error: blocksErr } = await supabase
      .from('league_blocks')
      .select('id, label, status, winner_player_id, ranking_json')
      .eq('tournament_id', tournamentId)
      .order('label', { ascending: true });

    if (blocksErr) {
      console.error(blocksErr);
      setError('リーグブロック一覧の取得に失敗しました');
      setLoading(false);
      return;
    }

    const blocks: LeagueBlockRow[] = (blocksData ?? []) as LeagueBlockRow[];
    setBlocks(blocks);

    // 優勝者プレーヤー情報
    const winnerIds = blocks
      .map((b) => b.winner_player_id)
      .filter((id): id is string => !!id);

    if (winnerIds.length > 0) {
      const { data: playersData, error: playersErr } = await supabase
        .from('players')
        .select('id, handle_name')
        .in('id', winnerIds);

      if (playersErr) {
        console.error(playersErr);
      } else {
        const map = new Map<string, WinnerInfo>();
        (playersData ?? []).forEach((p) => {
          map.set(p.id, { id: p.id, handle_name: p.handle_name });
        });
        setWinners(map);
      }
    } else {
      setWinners(new Map());
    }

    // 3) リーグに使えるプレーヤー一覧（active_players）
    const { data: active, error: activeErr } = await supabase
      .from('active_players')
      .select('id, handle_name')
      .eq('is_active', true)
      .order('ranking_points', { ascending: false });

    if (activeErr) {
      console.error(activeErr);
      setError('プレーヤー一覧の取得に失敗しました');
      setLoading(false);
      return;
    }

    // 50音順ソート
    const sorted = ((active ?? []) as PlayerOption[])
      .slice()
      .sort((a, b) =>
        (a.handle_name ?? '').localeCompare(b.handle_name ?? '', 'ja'),
      );

    setPlayers(sorted);

    setLoading(false);
  };

  // ブロック集計
  const handleFinalize = async (blockId: string) => {
    setBusyBlock(blockId);
    setError(null);
    setMessage(null);

    const { error: rpcErr } = await supabase.rpc('finalize_league_block', {
      p_block_id: blockId,
    });

    if (rpcErr) {
      console.error(rpcErr);
      setError('ブロックの集計に失敗しました');
      setBusyBlock(null);
      return;
    }

    await loadAll();
    setBusyBlock(null);
    setMessage('ブロックの順位を再計算しました');
  };

  // 新しいリーグブロック＋3試合作成
  const handleCreateBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournamentId) return;

    setError(null);
    setMessage(null);

    if (!blockLabel.trim()) {
      setError('ブロック名（A/B/Cなど）を入力してください');
      return;
    }
    if (!p1 || !p2 || !p3) {
      setError('3人すべてのプレーヤーを選択してください');
      return;
    }
    if (new Set([p1, p2, p3]).size !== 3) {
      setError('同じプレーヤーを複数選択することはできません');
      return;
    }

    setCreating(true);

    // 1) league_blocks
    const { data: block, error: blockErr } = await supabase
      .from('league_blocks')
      .insert({
        tournament_id: tournamentId,
        label: blockLabel.trim(),
        status: 'pending',
      })
      .select('id')
      .single();

    if (blockErr || !block) {
      console.error(blockErr);
      setError('リーグブロックの作成に失敗しました');
      setCreating(false);
      return;
    }

    const blockId = block.id as string;

    // 2) league_block_members
    const membersPayload = [
      { league_block_id: blockId, player_id: p1 },
      { league_block_id: blockId, player_id: p2 },
      { league_block_id: blockId, player_id: p3 },
    ];

    const { error: membersErr } = await supabase
      .from('league_block_members')
      .insert(membersPayload);

    if (membersErr) {
      console.error(membersErr);
      setError('ブロックメンバーの登録に失敗しました');
      setCreating(false);
      return;
    }

    // 3) matches に総当たり3試合
    const pairs: [string, string][] = [
      [p1, p2],
      [p1, p3],
      [p2, p3],
    ];

    const matchesPayload = pairs.map(([a, b]) => ({
      tournament_id: tournamentId,
      is_tournament: true,
      // ★ DBのチェック制約に合わせて mode を 'singles' に修正
      mode: 'singles',
      status: 'pending',
      player_a_id: a,
      player_b_id: b,
      league_block_id: blockId,
      result_type: 'normal',
    }));

    const { error: matchesErr } = await supabase
      .from('matches')
      .insert(matchesPayload);

    if (matchesErr) {
      console.error(matchesErr);
      setError(
        'リーグ戦の試合作成に失敗しました（ブロックとメンバーは作成済み）',
      );
      setCreating(false);
      return;
    }

    // フォームリセット & 再読込
    setBlockLabel('');
    setP1('');
    setP2('');
    setP3('');
    await loadAll();
    setCreating(false);
    setMessage('新しいリーグブロックと3試合を作成しました');
  };

  if (!tournamentId) {
    return <div className="p-4">大会IDが指定されていません。</div>;
  }

  if (loading) {
    return <div className="p-4">読み込み中...</div>;
  }

  return (
    <div className="p-4 space-y-6">
      {/* 見出し */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">
            リーグブロック管理
            {tournament && (
              <span className="ml-2 text-sm font-normal text-gray-300">
                （{tournament.name ?? '大会名未設定'}）
              </span>
            )}
          </h1>
          <div className="text-xs text-gray-400">
            tournament_id: {tournamentId}
          </div>
        </div>
        <Link
          href={`/tournaments/${tournamentId}/league`}
          className="text-xs text-blue-400 underline"
          target="_blank"
          rel="noreferrer"
        >
          一般公開のリーグ一覧ページを開く
        </Link>
      </div>

      {error && <div className="text-sm text-red-500">{error}</div>}
      {message && <div className="text-sm text-green-400">{message}</div>}

      {/* 新規ブロック作成フォーム */}
      <div className="rounded-lg border border-gray-700 bg-black/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold">新しいリーグブロックを作成</h2>
        <p className="text-xs text-gray-400">
          3人を選ぶと、その3人の総当たり（3試合）が自動で作成されます。
        </p>

        <form onSubmit={handleCreateBlock} className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="text-xs font-semibold">ブロック名</label>
              <input
                type="text"
                className="ml-2 w-20 rounded border border-gray-600 bg-black/60 px-2 py-1 text-sm"
                value={blockLabel}
                onChange={(e) => setBlockLabel(e.target.value)}
                placeholder="A など"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              {[p1, p2, p3].map((val, idx) => (
                <div key={idx} className="space-y-1">
                  <label className="text-xs font-semibold">
                    プレーヤー {idx + 1}
                  </label>
                  <select
                    className="min-w-[200px] rounded border border-gray-600 bg-black/60 px-3 py-2 text-base"
                    style={{ fontSize: 18, lineHeight: 1.4 }}
                    value={idx === 0 ? p1 : idx === 1 ? p2 : p3}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (idx === 0) setP1(v);
                      else if (idx === 1) setP2(v);
                      else setP3(v);
                    }}
                  >
                    <option value="">未選択</option>
                    {players.map((pl) => (
                      <option key={pl.id} value={pl.id} style={{ fontSize: 16 }}>
                        {pl.handle_name ?? '(名前未設定)'}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={creating}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {creating ? '作成中…' : 'ブロックと3試合を作成する'}
          </button>
        </form>
      </div>

      {/* 既存ブロック一覧 */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">既存リーグブロック</h2>
        {blocks.length === 0 ? (
          <div className="text-sm text-gray-400">
            まだリーグブロックはありません。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-800 text-gray-100 text-xs">
                  <th className="border px-2 py-1 text-left">ブロック</th>
                  <th className="border px-2 py-1 text-left">状態</th>
                  <th className="border px-2 py-1 text-left">優勝者</th>
                  <th className="border px-2 py-1 text-left">公開ページ</th>
                  <th className="border px-2 py-1 text-center">集計</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((b) => {
                  const winner = b.winner_player_id
                    ? winners.get(b.winner_player_id)
                    : undefined;

                  const statusLabel =
                    b.status === 'finished'
                      ? '確定'
                      : b.status === 'pending'
                      ? '未確定'
                      : b.status || '未設定';

                  return (
                    <tr key={b.id}>
                      <td className="border px-2 py-1">
                        ブロック {b.label ?? '-'}
                      </td>
                      <td className="border px-2 py-1">{statusLabel}</td>
                      <td className="border px-2 py-1">
                        {winner?.handle_name ?? '---'}
                      </td>
                      <td className="border px-2 py-1">
                        <Link
                          href={`/league/${b.id}`}
                          className="text-xs text-blue-400 underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          公開ページを開く
                        </Link>
                      </td>
                      <td className="border px-2 py-1 text-center">
                        <button
                          type="button"
                          onClick={() => handleFinalize(b.id)}
                          disabled={!!busyBlock}
                          className="px-3 py-1 text-xs rounded bg-purple-600 text-white disabled:opacity-50"
                        >
                          {busyBlock === b.id ? '集計中…' : '順位を集計する'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
