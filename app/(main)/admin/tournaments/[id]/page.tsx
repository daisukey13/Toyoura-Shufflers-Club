'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

type Tournament = {
  id: string;
  name: string;
  mode: 'singles' | 'teams';
  size: 4 | 8 | 16 | 32;
  best_of: 1 | 3;
  point_cap: number;
  apply_handicap: boolean;
  start_date: string | null;
};

type Option = { id: string; handle_name?: string | null; name?: string | null };

export default function TournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<Tournament | null>(null);
  const [players, setPlayers] = useState<Option[]>([]);
  const [teams, setTeams] = useState<Option[]>([]);
  const [seedRows, setSeedRows] = useState<{ seed: number; player_id?: string; team_id?: string }[]>([]);
  const [rounds, setRounds] = useState<Record<string, any[]>>({});
  const [busy, setBusy] = useState(false);

  const isSingles = t?.mode !== 'teams';

  useEffect(() => {
    (async () => {
      const [tr, pr, trm] = await Promise.all([
        fetch(`/api/tournaments/${id}`).then(r => r.json()),
        fetch('/api/players/options').then(r => r.json()),
        fetch('/api/teams/options').then(r => r.json()),
      ]);
      setT(tr.item);
      setPlayers(pr.items ?? []);
      setTeams(trm.items ?? []);
    })();
  }, [id]);

  const loadBracket = async () => {
    const r = await fetch(`/api/tournaments/${id}/bracket`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      setRounds(j.rounds ?? {});
    } else {
      setRounds({});
    }
  };

  useEffect(() => { loadBracket(); }, [id]);

  const addRow = () =>
    setSeedRows(s => [...s, { seed: (s.at(-1)?.seed ?? 0) + 1 }]);

  const removeRow = (i: number) =>
    setSeedRows(s => s.filter((_, idx) => idx !== i));

  const submitParticipants = async () => {
    const entries = seedRows
      .map(r => (isSingles ? { seed: r.seed, player_id: r.player_id } : { seed: r.seed, team_id: r.team_id }))
      .filter(e => (e as any).player_id || (e as any).team_id);
    if (!entries.length) return alert('参加者がありません');
    setBusy(true);
    const res = await fetch(`/api/tournaments/${id}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    setBusy(false);
    if (!res.ok) return alert('参加者登録に失敗');
    setSeedRows([]);
    alert('登録しました');
  };

  const generateBracket = async () => {
    setBusy(true);
    const r = await fetch(`/api/tournaments/${id}/generate-bracket`, { method: 'POST' });
    setBusy(false);
    if (!r.ok) return alert('ブラケット生成に失敗');
    await loadBracket();
    alert('R1 を生成しました');
  };

  const report = async (m: any, winner: 'A' | 'B', loserScore: number) => {
    // a_id / b_id は bracket API が返すのでそれを使う
    const aId = m.a_id;
    const bId = m.b_id;
    const winner_id = winner === 'A' ? aId : bId;
    const loser_id  = winner === 'A' ? bId : aId;

    const r = await fetch(`/api/matches/${m.id}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winner_id, loser_id, loser_score: Number(loserScore), a_id: aId, b_id: bId }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      alert(`報告失敗: ${e.error ?? r.statusText}`);
      return;
    }
    await loadBracket();
    alert('報告しました');
  };

  const flatMatches = useMemo(() => {
    return Object.keys(rounds)
      .flatMap(k => (rounds[k] ?? []).map((m: any) => ({ ...m, round: Number(k) })));
  }, [rounds]);

  if (!t) return <div className="p-6 text-white">Loading…</div>;

  return (
    <div className="p-6 space-y-8 text-white">
      <h1 className="text-xl font-bold">{t.name} — 管理</h1>

      {/* 参加者登録 */}
      <section className="space-y-3">
        <h2 className="font-semibold">参加者登録（{isSingles ? 'プレーヤー' : 'チーム'}＋シード）</h2>
        <div className="space-y-2">
          {seedRows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              {isSingles ? (
                <select
                  className="border rounded p-2 flex-1 text-black"
                  value={row.player_id ?? ''}
                  onChange={e => {
                    const v = e.target.value || undefined;
                    setSeedRows(s => s.map((r, idx) => idx === i ? { ...r, player_id: v, team_id: undefined } : r));
                  }}
                >
                  <option value="">プレーヤーを選択</option>
                  {players.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.handle_name || p.name || '(no name)'}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className="border rounded p-2 flex-1 text-black"
                  value={row.team_id ?? ''}
                  onChange={e => {
                    const v = e.target.value || undefined;
                    setSeedRows(s => s.map((r, idx) => idx === i ? { ...r, team_id: v, player_id: undefined } : r));
                  }}
                >
                  <option value="">チームを選択</option>
                  {teams.map(tm => (
                    <option key={tm.id} value={tm.id}>
                      {tm.name || '(no name)'}
                    </option>
                  ))}
                </select>
              )}

              <input
                className="border rounded p-2 w-24 text-black"
                type="number"
                min={1}
                value={row.seed}
                onChange={e => {
                  const v = Number(e.target.value);
                  setSeedRows(s => s.map((r, idx) => idx === i ? { ...r, seed: v } : r));
                }}
              />
              <button className="px-2 py-1 rounded bg-gray-200 text-black" onClick={() => removeRow(i)}>削除</button>
            </div>
          ))}
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded bg-gray-100 text-black" onClick={addRow}>行を追加</button>
            <button disabled={busy} className="px-3 py-2 rounded bg-blue-600 disabled:opacity-50" onClick={submitParticipants}>登録</button>
            <button disabled={busy} className="px-3 py-2 rounded bg-emerald-600 disabled:opacity-50" onClick={generateBracket}>R1生成</button>
          </div>
        </div>
      </section>

      {/* 試合一覧（報告） */}
      <section className="space-y-2">
        <h2 className="font-semibold">試合一覧（報告）</h2>
        {flatMatches.length === 0 ? (
          <div className="opacity-80">まだカードがありません。</div>
        ) : (
          <div className="space-y-2">
            {flatMatches.map((m: any) => (
              <div key={m.id} className="rounded border border-white/10 bg-white/5 p-3">
                <div className="mb-1 text-xs opacity-75">R{m.round} / No.{m.match_no} / {m.status}</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">{m.a?.name ?? '未定'}</div>
                  <span>vs</span>
                  <div className="flex-1">{m.b?.name ?? '未定'}</div>
                  <select id={`w-${m.id}`} className="rounded border p-1 text-black">
                    <option value="A">A勝ち</option>
                    <option value="B">B勝ち</option>
                  </select>
                  <input id={`ls-${m.id}`} type="number" min={0} defaultValue={0} className="w-20 rounded border p-1 text-black" />
                  <button
                    className="rounded bg-emerald-600 px-3 py-1"
                    onClick={() => {
                      const sel = (document.getElementById(`w-${m.id}`) as HTMLSelectElement).value as 'A'|'B';
                      const ls = Number((document.getElementById(`ls-${m.id}`) as HTMLInputElement).value || 0);
                      report(m, sel, ls);
                    }}
                  >
                    報告
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {busy ? <div className="text-sm opacity-80">通信中…</div> : null}
    </div>
  );
}
