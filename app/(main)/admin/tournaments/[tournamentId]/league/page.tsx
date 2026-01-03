// app/(main)/admin/tournaments/[tournamentId]/league/page.tsx
'use client';

import type React from 'react';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();
// ✅ Supabase 型推論が "never" に崩れる環境があるので、このページ内は any 経由で安全に扱う
const db: any = supabase;

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

// ===== Helper: schema差分に強くする =====
type AnyObj = Record<string, any>;

const isMissingColumnError = (err: any) => {
  const code = err?.code;
  const msg = String(err?.message ?? '');
  return code === '42703' || msg.includes('does not exist') || msg.includes('column') || msg.includes('schema cache');
};

const isModeCheckError = (err: any) => {
  const msg = String(err?.message ?? '');
  // CHECK制約名が違う場合もあるので、"mode" と "check" をゆるく拾う
  return msg.includes('matches_mode_check') || (msg.toLowerCase().includes('mode') && msg.toLowerCase().includes('check'));
};

// ===== Helper: def ダミーを 1 回だけ取得してキャッシュ =====
type DefDummy = { id: string; handle_name: string };
let _defCache: DefDummy | null = null;

async function getDefDummy(): Promise<DefDummy> {
  if (_defCache) return _defCache;

  // players に def(is_dummy=true) がいる前提（ここは “関数内” にする：トップレベル await 禁止）
  const { data, error } = await db
    .from('players').eq('is_active', true)
    .select('id, handle_name')
    .eq('handle_name', 'def')
    .eq('is_dummy', true)
    .maybeSingle();

  // Supabase の型推論崩れ対策（never/null回避）
  const row = (data ?? null) as { id?: string | null; handle_name?: string | null } | null;

  if (error || !row?.id) {
    throw new Error(
      "ダミープレイヤー(def)が見つかりません。players に handle_name='def', is_dummy=true を用意してください。"
    );
  }

  _defCache = { id: String(row.id), handle_name: String(row.handle_name ?? 'def') };
  return _defCache;
}

// ===== Helper: safe insert for matches (schema差分・制約差分に強くする) =====
async function insertMatchesWithFallback(rows: AnyObj[]) {
  // まずは「よくある列」を全部入れて試す → ダメなら不要列を削って再試行
  const withExtras = rows.map((r) => ({
    ...r,
    is_tournament: true, // 無ければ落ちるので後でfallback
    result_type: 'normal', // 型/制約違いがあり得るので後でfallback
  }));

  const selectCols = 'id,player_a_id,player_b_id';

  // 1) extras付きトライ
  let r1 = await db.from('matches').insert(withExtras).select(selectCols);
  if (!r1.error) return { ok: true as const, data: (r1.data ?? []) as any[] };

  let error = r1.error;

  // 2) mode CHECK に当たるなら mode 候補を変えて再試行
  if (isModeCheckError(error)) {
    const modeCandidates = ['singles', 'single', 'player'];
    for (const m of modeCandidates) {
      const retryRows = withExtras.map((r) => ({ ...r, mode: m }));
      const r2 = await db.from('matches').insert(retryRows).select(selectCols);
      if (!r2.error) return { ok: true as const, data: (r2.data ?? []) as any[] };
      error = r2.error;
      if (!isModeCheckError(error)) break;
    }
  }

  // 3) 列が存在しない/型が違うっぽい場合は extras を落として再試行
  if (isMissingColumnError(error)) {
    const stripped = rows.map((r) => ({ ...r }));
    const r3 = await db.from('matches').insert(stripped).select(selectCols);
    if (!r3.error) return { ok: true as const, data: (r3.data ?? []) as any[] };

    // tournament_id が無い環境も考慮してさらに削ってみる
    const msg = String(r3.error?.message ?? '');
    if (msg.toLowerCase().includes('tournament_id')) {
      const dropTournament = rows.map(({ tournament_id, ...rest }) => ({ ...rest }));
      const r4 = await db.from('matches').insert(dropTournament).select(selectCols);
      if (!r4.error) return { ok: true as const, data: (r4.data ?? []) as any[] };
      return { ok: false as const, error: r4.error };
    }

    return { ok: false as const, error: r3.error };
  }

  // 4) result_type / is_tournament が原因の可能性があるので、それだけ落として再試行（最後の保険）
  {
    const dropSome = rows.map((r) => ({ ...r })); // extras無し
    const r4 = await db.from('matches').insert(dropSome).select(selectCols);
    if (!r4.error) return { ok: true as const, data: (r4.data ?? []) as any[] };
    return { ok: false as const, error: error ?? r4.error };
  }
}

// ===== def絡み試合を「不戦勝で確定」する（schema差分に強い update）=====
async function finalizeDefMatches(blockId: string, tournamentId: string, defId: string) {
  // まずは tournament_id + league_block_id で拾う。tournament_id 列が無いなら league_block_id のみに退避。
  let msResp = await db
    .from('matches')
    .select('id,player_a_id,player_b_id')
    .eq('tournament_id', tournamentId)
    .eq('league_block_id', blockId)
    .or(`player_a_id.eq.${defId},player_b_id.eq.${defId}`);

  if (msResp.error && isMissingColumnError(msResp.error)) {
    msResp = await db
      .from('matches')
      .select('id,player_a_id,player_b_id')
      .eq('league_block_id', blockId)
      .or(`player_a_id.eq.${defId},player_b_id.eq.${defId}`);
  }

  if (msResp.error) throw msResp.error;

  const list = (msResp.data ?? []) as any[];

  // def vs def を許容（安全側）
  const compute = (a: string, b: string) => {
    const aIsDef = a === defId;
    const bIsDef = b === defId;

    if (aIsDef && bIsDef) {
      return { winner_id: defId, loser_id: defId, winner_score: 0, loser_score: 0 };
    }

    const winner_id = aIsDef ? b : a;
    const loser_id = aIsDef ? a : b;

    return { winner_id, loser_id, winner_score: 15, loser_score: 0 };
  };

  // update fallback（列が無い可能性に備えて段階的に落とす）
  const updateOne = async (matchId: string, payload: AnyObj) => {
    const candidates: AnyObj[] = [
      {
        ...payload,
        status: 'finalized',
        end_reason: 'forfeit',
        finish_reason: 'forfeit',
        affects_rating: false,

        // ✅ 環境差分（delta / change）両方を一旦入れる → 無い列は fallback で落ちる
        winner_points_delta: 0,
        loser_points_delta: 0,
        winner_handicap_delta: 0,
        loser_handicap_delta: 0,
        winner_points_change: 0,
        loser_points_change: 0,
        winner_handicap_change: 0,
        loser_handicap_change: 0,
      },
      { ...payload, status: 'finalized', end_reason: 'forfeit', finish_reason: 'forfeit', affects_rating: false },
      { ...payload, status: 'finalized', end_reason: 'forfeit', finish_reason: 'forfeit' },
      { ...payload, status: 'finalized', end_reason: 'forfeit' },
      { ...payload, status: 'finalized' },
      { ...payload },
    ];

    let lastErr: any = null;

    for (const c of candidates) {
      const { error } = await db.from('matches').update(c).eq('id', matchId);
      if (!error) return;
      lastErr = error;
      if (isMissingColumnError(error)) continue;
      break;
    }

    throw new Error(String(lastErr?.message || 'def match update failed'));
  };

  for (const row of list) {
    const a = String(row.player_a_id ?? '');
    const b = String(row.player_b_id ?? '');
    if (!a || !b) continue;
    const base = compute(a, b);
    await updateOne(String(row.id), base);
  }
}

// ===== Page Component =====
export default function AdminTournamentLeaguePage() {
  const params = useParams();
  const tournamentId = typeof params?.tournamentId === 'string' ? (params.tournamentId as string) : '';

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
    const { data: t, error: tErr } = await db.from('tournaments').select('id, name').eq('id', tournamentId).maybeSingle();

    if (tErr || !t) {
      console.error(tErr);
      setError('大会情報の取得に失敗しました');
      setLoading(false);
      return;
    }
    setTournament(t as TournamentInfo);

    // 2) ブロック一覧
    const { data: blocksData, error: blocksErr } = await db
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

    const list: LeagueBlockRow[] = (blocksData ?? []) as LeagueBlockRow[];
    setBlocks(list);

    // 優勝者プレーヤー情報
    const winnerIds = list.map((b) => b.winner_player_id).filter((id): id is string => !!id);

    if (winnerIds.length > 0) {
      const { data: playersData, error: playersErr } = await db.from('players').select('id, handle_name').in('id', winnerIds);

      if (playersErr) {
        console.error(playersErr);
        setWinners(new Map());
      } else {
        const map = new Map<string, WinnerInfo>();
        (playersData ?? []).forEach((p: any) => {
          map.set(String(p.id), { id: String(p.id), handle_name: p.handle_name ?? null });
        });
        setWinners(map);
      }
    } else {
      setWinners(new Map());
    }

    // 3) リーグに使えるプレーヤー一覧（active_players）
    const { data: active, error: activeErr } = await db
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

    // def(dummy) を候補に入れる（active_players にいなくても追加）
    let def: { id: string; handle_name: string } | null = null;
    try {
      def = await getDefDummy();
    } catch (e) {
      console.warn('[admin/league] def dummy missing:', e);
      def = null;
    }

    const base = (active ?? []) as PlayerOption[];
    const appendDef: PlayerOption[] =
      def && !base.some((p) => String(p.id) === def!.id) ? [{ id: def.id, handle_name: def.handle_name }] : [];

    // 50音順ソート
    const sorted = [...base, ...appendDef].slice().sort((a, b) => (a.handle_name ?? '').localeCompare(b.handle_name ?? '', 'ja'));

    setPlayers(sorted);
    setLoading(false);
  };

  // ブロック集計
  const handleFinalize = async (blockId: string) => {
    setBusyBlock(blockId);
    setError(null);
    setMessage(null);

    const { error: rpcErr } = await db.rpc('finalize_league_block', { p_block_id: blockId });

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

  // 新しいリーグブロック＋3試合作成（2人なら def を自動補充）
  const handleCreateBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournamentId) return;

    setError(null);
    setMessage(null);

    if (!blockLabel.trim()) {
      setError('ブロック名（A/B/Cなど）を入力してください');
      return;
    }

    // 入力取得（空は許容：2人だけでもOK）
    const picked = [p1, p2, p3].map((x) => String(x || '').trim()).filter(Boolean);

    if (picked.length < 2) {
      setError('プレーヤーを最低2人選択してください（3人目は未選択でもOK：def が自動補充されます）');
      return;
    }

    // def を取得（無ければ作成不可）
    let def: { id: string; handle_name: string };
    try {
      def = await getDefDummy();
    } catch (err: any) {
      setError(err?.message || 'ダミープレイヤー(def)が取得できませんでした');
      return;
    }

    // 2人だけなら def を補充（ただし def が既に選ばれているなら補充しない）
    const hasDefAlready = picked.includes(def.id);
    let finalIds = [...picked];

    if (finalIds.length === 2) {
      if (!hasDefAlready) finalIds.push(def.id);
      else {
        // def + 実1人 になるので事故防止
        setError('def を含める場合も、実プレーヤーを最低2人選択してください');
        return;
      }
    }

    if (finalIds.length !== 3) {
      setError('プレーヤー選択が不正です（3人または2人＋自動def補充の形にしてください）');
      return;
    }

    // 重複チェック（def も含めて3人は全て異なる必要がある）
    if (new Set(finalIds).size !== 3) {
      setError('同じプレーヤーを複数選択することはできません（def も1枠までです）');
      return;
    }

    const [rp1, rp2, rp3] = finalIds;

    setCreating(true);

    try {
      // 1) league_blocks
      const { data: block, error: blockErr } = await db
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

      const blockId = String(block.id);

      // 2) league_block_members
      const membersPayload = [
        { league_block_id: blockId, player_id: rp1 },
        { league_block_id: blockId, player_id: rp2 },
        { league_block_id: blockId, player_id: rp3 },
      ];

      const { error: membersErr } = await db.from('league_block_members').insert(membersPayload);

      if (membersErr) {
        console.error(membersErr);
        setError('ブロックメンバーの登録に失敗しました');
        setCreating(false);
        return;
      }

      // 3) matches に総当たり3試合（必要最小限の列だけ）
      const pairs: [string, string][] = [
        [rp1, rp2],
        [rp1, rp3],
        [rp2, rp3],
      ];

      const nowIso = new Date().toISOString();

      const matchesPayload = pairs.map(([a, b]) => ({
        tournament_id: tournamentId,
        league_block_id: blockId,
        mode: 'singles',
        status: 'pending',
        player_a_id: a,
        player_b_id: b,
        match_date: nowIso,
      }));

      const ins = await insertMatchesWithFallback(matchesPayload);
      if (!ins.ok) {
        console.error(ins.error);
        setError('リーグ戦の試合作成に失敗しました（ブロックとメンバーは作成済み）');
        setCreating(false);
        return;
      }

      // ✅ def が絡む試合は「不戦勝で自動確定」にする
      if (finalIds.includes(def.id)) {
        try {
          await finalizeDefMatches(blockId, tournamentId, def.id);
        } catch (e) {
          console.warn('[admin/league] finalize def matches failed:', e);
          // ここは致命ではないので継続
        }
      }

      // フォームリセット & 再読込
      setBlockLabel('A');
      setP1('');
      setP2('');
      setP3('');
      await loadAll();
      setMessage(
        finalIds.includes(def.id)
          ? '新しいリーグブロック（def補充）と3試合を作成しました'
          : '新しいリーグブロックと3試合を作成しました'
      );
    } finally {
      setCreating(false);
    }
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
              <span className="ml-2 text-sm font-normal text-gray-300">（{tournament.name ?? '大会名未設定'}）</span>
            )}
          </h1>
          <div className="text-xs text-gray-400">tournament_id: {tournamentId}</div>
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
          <br />
          ※ 2人しかいない場合は、3人目を未選択のまま作成すると def（ダミー）が自動補充され、不戦勝として自動確定します。
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
              {[p1, p2, p3].map((_, idx) => (
                <div key={idx} className="space-y-1">
                  <label className="text-xs font-semibold">プレーヤー {idx + 1}</label>
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
          <div className="text-sm text-gray-400">まだリーグブロックはありません。</div>
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
                  <th className="border px-2 py-1 text-left">管理</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((b) => {
                  const winner = b.winner_player_id ? winners.get(b.winner_player_id) : undefined;

                  const statusLabel =
                    b.status === 'finished' ? '確定' : b.status === 'pending' ? '未確定' : b.status || '未設定';

                  return (
                    <tr key={b.id}>
                      <td className="border px-2 py-1">ブロック {b.label ?? '-'}</td>
                      <td className="border px-2 py-1">{statusLabel}</td>
                      <td className="border px-2 py-1">{winner?.handle_name ?? '---'}</td>
                      <td className="border px-2 py-1">
                        <Link href={`/league/${b.id}`} className="text-xs text-blue-400 underline" target="_blank" rel="noreferrer">
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
                      <td className="border px-2 py-1">
                        <Link href={`/admin/league-blocks/${b.id}/matches`} className="text-xs text-blue-400 underline">
                          試合結果入力
                        </Link>
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
