// app/(main)/admin/bracket/archives/[id]/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FaArrowLeft, FaCrown } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

/* ========= Types ========= */
type ArchiveRow = {
  id: string;
  tournament_id: string | null;
  title: string | null;
  created_at: string | null;
  html: string | null;
};

type Tournament = {
  id: string;
  name: string;
  mode: 'singles' | 'teams' | string | null;
  start_date: string | null;
  created_at: string | null;
};

type Player = { id: string; handle_name: string | null; avatar_url?: string | null };
type Team = { id: string; name: string | null; logo_url?: string | null };

type MatchRow = {
  id: string;
  tournament_id: string | null;
  mode: 'singles' | 'teams' | string | null;
  match_date: string | null;
  created_at: string | null;
  winner_id?: string | null;
  loser_id?: string | null;
  winner_team_id?: string | null;
  loser_team_id?: string | null;
  loser_score?: number | null;
};

/* ========= Avatar ========= */
function Avatar({
  size = 42,
  url,
  name,
  isChampion = false,
}: {
  size?: number;
  url?: string | null;
  name?: string | null;
  isChampion?: boolean;
}) {
  const dim = `${size}px`;
  const frame = isChampion
    ? 'border-yellow-400 shadow-[0_0_0_6px_rgba(250,204,21,0.25)]'
    : 'border-gray-600';
  return url ? (
    <img src={url} alt={name || 'avatar'} style={{ width: dim, height: dim }} className={`rounded-full object-cover border ${frame}`} />
  ) : (
    <div style={{ width: dim, height: dim }} className={`rounded-full flex items-center justify-center bg-gradient-to-br from-gray-700 to-gray-900 text-white font-bold border ${frame}`}>
      {((name || '??').trim() || '??').slice(0, 2).toUpperCase()}
    </div>
  );
}

/* ========= Page ========= */
export default function ArchiveViewPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = useMemo(() => createClient(), []);
  const [row, setRow] = useState<ArchiveRow | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [champion, setChampion] = useState<{ id: string; name: string; avatar_url?: string | null } | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);

  /* ---- 初期ロード ---- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: a1, error: e1 } = await (supabase.from('bracket_archives') as any)
          .select('id,tournament_id,title,created_at,html')
          .eq('id', id)
          .maybeSingle();
        if (e1) throw e1;
        const r = (a1 ?? null) as ArchiveRow | null;
        if (!cancelled) setRow(r);

        if (r?.tournament_id) {
          const { data } = await (supabase.from('tournaments') as any)
            .select('id,name,mode,start_date,created_at')
            .eq('id', r.tournament_id)
            .maybeSingle();
          const t1 = (data ?? null) as Tournament | null;
          if (!cancelled && t1) setTournament(t1);
        }

        const [pRes, tmRes] = await Promise.all([
          (supabase.from('players') as any).select('id,handle_name,avatar_url'),
          (supabase.from('teams') as any).select('id,name,logo_url'),
        ]);
        if (!cancelled) {
          setPlayers((pRes?.data ?? []) as Player[]);
          setTeams((tmRes?.data ?? []) as Team[]);
        }

        if (r?.tournament_id) {
          const { data: mRes } = await (supabase.from('matches') as any)
            .select('id,tournament_id,mode,match_date,created_at,winner_id,loser_id,winner_team_id,loser_team_id,loser_score')
            .eq('tournament_id', r.tournament_id)
            .order('match_date', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: true });
          const ms = (mRes ?? []) as MatchRow[];
          if (!cancelled) setMatches(ms);

          const last = ms[ms.length - 1];
          if (last) {
            const isTeams = (last.mode || '').toLowerCase().startsWith('team');
            if (isTeams) {
              const t = (tmRes?.data as Team[] | undefined)?.find((x) => x.id === (last.winner_team_id || ''));
              if (t) setChampion({ id: t.id, name: t.name || '(チーム)', avatar_url: t.logo_url || null });
            } else {
              const p = (pRes?.data as Player[] | undefined)?.find((x) => x.id === (last.winner_id || ''));
              if (p) setChampion({ id: p.id, name: p.handle_name || '(プレイヤー)', avatar_url: p.avatar_url || null });
            }
          }
        }
      } catch {
        // noop
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, supabase]);

  /* ---- アーカイブ描画（スナップショット or ブラケット・フォールバック） ---- */
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !row?.html) return;

    // 既存スナップショットを差し込み
    root.innerHTML = row.html;

    // 指定の掃除：ラベル/入力を除去
    Array.from(root.querySelectorAll('*')).forEach((el) => {
      const txt = (el.textContent || '').trim();
      if (txt === '勝者' || txt === '候補A') el.remove();
    });
    root.querySelectorAll('select, input, textarea').forEach((el) => (el as HTMLElement).remove());
    Array.from(root.querySelectorAll('span,div,p,label')).forEach((el) => {
      const t = (el.textContent || '').trim();
      if (/プレーヤを選択|敗者スコア/i.test(t)) el.remove();
    });
    root.querySelectorAll('button,a').forEach((el) => {
      const txt = (el.textContent || '').trim();
      if (/(生成|再読込|アーカイブ|試合確定)/.test(txt)) (el as HTMLElement).style.display = 'none';
    });

    // スナップショットが自力表示できていない場合のみフォールバック
    const hasAnyScore = Array.from(root.querySelectorAll('span,div,p')).some((n) =>
      ((n.textContent || '').trim().match(/(^|[^0-9])\d{1,2}($|[^0-9])/))
    );
    if (hasAnyScore) return;

    // ===== フォールバック（厳密・ラウンド構築） =====
    root.innerHTML = '';

    const isTeams =
      (tournament?.mode || '').toLowerCase() === 'teams' ||
      (tournament?.mode || '').toLowerCase() === 'team';

    const pidWin = (m: MatchRow) => (isTeams ? (m.winner_team_id || null) : (m.winner_id || null));
    const pidLose = (m: MatchRow) => (isTeams ? (m.loser_team_id || null) : (m.loser_id || null));
    const timeOf  = (m: MatchRow) => (m.match_date || m.created_at) ? new Date((m.match_date || m.created_at) as string).getTime() : 0;

    const ms = [...matches]; // 昇順（古→新）

    // --- R1: まだ登場していない参加者同士の試合を時系列で貪欲に ---
    const rounds: number[][] = [];
    const usedInR1 = new Set<string>();
    const assigned = new Set<number>();

    ms.forEach((m, i) => {
      const a = pidWin(m); const b = pidLose(m);
      if (!a || !b) return;
      if (assigned.has(i)) return;
      if (usedInR1.has(a) || usedInR1.has(b)) return;
      (rounds[0] ||= []).push(i);
      assigned.add(i);
      usedInR1.add(a); usedInR1.add(b);
    });

    // ★ 修正ここから：R(n+1) は「前ラウンド勝者どうしの“対戦カード”を全走査して貪欲に採用」
    const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

    const buildNextRound = (prevIdxs: number[]): number[] => {
      if (!prevIdxs?.length) return [];
      // 前ラウンドの勝者と「その試合の時刻」
      const winnerFromPrev = new Map<string, { prevIdx: number; t: number }>();
      prevIdxs.forEach((k) => {
        const w = pidWin(ms[k]);
        if (w) winnerFromPrev.set(w, { prevIdx: k, t: timeOf(ms[k]) });
      });

      // 候補：勝者×勝者の対戦カード（順不同）。複数回対戦がある場合に備えて時刻順に保持
      const candidatesByPair = new Map<string, number[]>();
      ms.forEach((m, i) => {
        if (assigned.has(i)) return;
        const p1 = pidWin(m);
        const p2 = pidLose(m);
        if (!p1 || !p2) return;
        if (!winnerFromPrev.has(p1) || !winnerFromPrev.has(p2)) return; // 勝者どうし以外は不可

        const key = pairKey(p1, p2);
        const arr = candidatesByPair.get(key) || [];
        arr.push(i);
        // 候補は「両準備試合の後」に近い順で選びたいので時刻で並べる
        arr.sort((i1, i2) => timeOf(ms[i1]) - timeOf(ms[i2]));
        candidatesByPair.set(key, arr);
      });

      // 前ラウンド勝者を左→右の見た目安定のため登場順でペアリング優先付け
      const orderedWinners = prevIdxs
        .slice()
        .sort((a, b) => timeOf(ms[a]) - timeOf(ms[b]))
        .map((k) => pidWin(ms[k])!)
        .filter(Boolean);

      const usedWinner = new Set<string>();
      const takenPrev  = new Set<number>();
      const next: number[] = [];

      // （1）まず候補の中から「両準備試合の後」のものを優先採用
      const tryPick = (w1: string, w2: string) => {
        const key = pairKey(w1, w2);
        const cand = candidatesByPair.get(key) || [];
        const tReady = Math.max(winnerFromPrev.get(w1)!.t, winnerFromPrev.get(w2)!.t);

        // 1st pass: t >= tReady
        for (const i of cand) {
          if (assigned.has(i)) continue;
          const a = pidWin(ms[i])!; const b = pidLose(ms[i])!;
          const pa = winnerFromPrev.get(a)!.prevIdx;
          const pb = winnerFromPrev.get(b)!.prevIdx;
          if (takenPrev.has(pa) || takenPrev.has(pb)) continue;
          if (timeOf(ms[i]) >= tReady) {
            assigned.add(i);
            next.push(i);
            usedWinner.add(a); usedWinner.add(b);
            takenPrev.add(pa); takenPrev.add(pb);
            return true;
          }
        }
        // 2nd pass: 条件が満たせない場合、最古のカードでも採用（時刻乱れ救済）
        for (const i of cand) {
          if (assigned.has(i)) continue;
          const a = pidWin(ms[i])!; const b = pidLose(ms[i])!;
          const pa = winnerFromPrev.get(a)!.prevIdx;
          const pb = winnerFromPrev.get(b)!.prevIdx;
          if (takenPrev.has(pa) || takenPrev.has(pb)) continue;
          assigned.add(i);
          next.push(i);
          usedWinner.add(a); usedWinner.add(b);
          takenPrev.add(pa); takenPrev.add(pb);
          return true;
        }
        return false;
      };

      for (let i = 0; i < orderedWinners.length; i += 1) {
        const w1 = orderedWinners[i]!;
        if (usedWinner.has(w1)) continue;
        for (let j = i + 1; j < orderedWinners.length; j += 1) {
          const w2 = orderedWinners[j]!;
          if (usedWinner.has(w2)) continue;
          if (tryPick(w1, w2)) break; // w1 が消費されたら次へ
        }
      }
      return next;
    };

    // R2 以降を構築
    while (true) {
      const prev = rounds[rounds.length - 1] || [];
      const nxt  = buildNextRound(prev);
      if (!nxt.length) break;
      rounds.push(nxt);
    }
    // ★ 修正ここまで

    // ==== 描画 ====
    const pMap = new Map(players.map((p) => [p.id, p]));
    const tMap = new Map(teams.map((t) => [t.id, t]));
    const ent = (id: string | null | undefined) => {
      if (!id) return { name: isTeams ? '(チーム未設定)' : '(プレイヤー未設定)', avatar: null };
      if (isTeams) {
        const x = tMap.get(id);
        return { name: x?.name || '(チーム未設定)', avatar: x?.logo_url || null };
      } else {
        const x = pMap.get(id);
        return { name: x?.handle_name || '(プレイヤー未設定)', avatar: x?.avatar_url || null };
      }
    };

    const mkRow = (id: string | null | undefined, isWinner: boolean, loserScore?: number | null) => {
      const { name, avatar } = ent(id);
      const row = document.createElement('div');
      row.className = (isWinner ? 'rounded-lg border border-green-500/40 bg-green-900/10' : 'rounded-lg border border-purple-500/20 bg-purple-900/5') + ' p-2';
      const inner = document.createElement('div');
      inner.className = 'w-full flex items-center gap-3';
      const img = document.createElement('img');
      img.width = 42; img.height = 42;
      img.className = 'rounded-full border border-gray-600 object-cover';
      if (avatar) { img.src = avatar; img.alt = name || 'avatar'; }
      else {
        img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42"><rect width="100%" height="100%" fill="#333"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-size="16" font-family="sans-serif">${(name || '??').slice(0,2)}</text></svg>`);
        img.alt = 'avatar';
      }
      const nm = document.createElement('span');
      nm.className = 'arch-inline-name text-[15px] font-medium';
      nm.textContent = name;
      const scoreBadge = document.createElement('span');
      scoreBadge.className = 'ml-2 inline-flex items-center px-2 py-[2px] rounded-md border border-white/15 bg-white/5 text-sm font-semibold';
      scoreBadge.textContent = String(isWinner ? 15 : (loserScore ?? '-'));
      inner.appendChild(img); inner.appendChild(nm); inner.appendChild(scoreBadge);
      row.appendChild(inner);
      return row;
    };

    const columns: HTMLElement[] = [];
    const maxRound = Math.max(1, rounds.length);
    for (let r = 1; r <= maxRound; r++) {
      const col = document.createElement('div');
      col.className = 'flex flex-col items-stretch gap-6 min-w-[280px]';
      const head = document.createElement('div');
      head.className = 'text-center text-purple-200/90 font-bold tracking-wide';
      head.textContent = r === maxRound ? `Final (R${r})` : `R${r}`;
      col.appendChild(head);
      columns.push(col);
    }

    rounds.forEach((idxs, ri) => {
      idxs.forEach((mi) => {
        const m = ms[mi];
        const card = document.createElement('div');
        card.className = 'rounded-xl border border-purple-500/30 bg-[#0d0f1a]/60 p-4 shadow-md';
        const winRow = mkRow(isTeams ? m.winner_team_id : m.winner_id, true);
        const loseRow = mkRow(isTeams ? m.loser_team_id : m.loser_id, false, m.loser_score);
        const meta = document.createElement('div');
        meta.className = 'text-xs text-gray-400 mt-2';
        const d = m.match_date ? new Date(m.match_date).toLocaleString('ja-JP') : m.created_at ? new Date(m.created_at).toLocaleString('ja-JP') : '';
        meta.textContent = d;
        card.style.marginTop = ri === 0 ? '0px' : `${8 * ri}px`;
        card.appendChild(winRow);
        card.appendChild(loseRow);
        card.appendChild(meta);
        columns[ri].appendChild(card);
      });
    });

    const grid = document.createElement('div');
    grid.className = 'w-full overflow-x-auto';
    const track = document.createElement('div');
    track.className = 'grid gap-6 md:gap-8';
    track.style.gridTemplateColumns = `repeat(${columns.length}, minmax(280px, 1fr))`;
    columns.forEach((c) => track.appendChild(c));
    grid.appendChild(track);
    root.appendChild(grid);

    const style = document.createElement('style');
    style.textContent = `
      #archive-view * .sticky.top-0 { position: static !important; }
      #archive-view .text-purple-300 { color:#c084fc !important; }
    `;
    root.appendChild(style);
  }, [row?.html, players, teams, tournament?.mode, matches]);

  if (loading) {
    return <div className="min-h-screen bg-[#1f2032] text-white flex items-center justify-center">読み込み中...</div>;
  }

  if (!row) {
    return <div className="min-h-screen bg-[#1f2032] text-white flex items-center justify-center">アーカイブが見つかりません</div>;
  }

  const mode = (tournament?.mode || 'singles').toLowerCase();
  const isTeams = mode === 'teams' || mode === 'team';

  return (
    <div className="min-h-screen bg-[#1f2032] text-white">
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <Link href={row.tournament_id ? `/admin/bracket/archives?t=${row.tournament_id}` : '/admin/bracket'} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-purple-500/30 hover:bg-purple-900/20 transition" title="一覧へ戻る">
            <FaArrowLeft /> 一覧
          </Link>

          {champion && (
            <div className="flex items-center gap-4 px-4 py-3 rounded-2xl border border-yellow-500/40 bg-gradient-to-br from-yellow-900/10 via-amber-800/10 to-transparent">
              <FaCrown className="text-yellow-300" size={22} />
              <div className="flex items-center gap-4">
                <Avatar size={120} url={champion.avatar_url || undefined} name={champion.name} isChampion />
                <div>
                  <div className="flex items-center gap-2 text-yellow-300">
                    <FaCrown />
                    <span className="uppercase tracking-widest text-xs">Champion</span>
                  </div>
                  <div className="text-3xl md:text-5xl font-extrabold text-yellow-200 drop-shadow">{champion.name}</div>
                  <div className="text-xs text-yellow-200/80 mt-1">{isTeams ? 'チーム優勝' : 'シングルス優勝'}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mb-6">
          <h1 className="text-3xl md:text-4xl font-extrabold">{row.title || '最終対戦成績'}</h1>
          <div className="text-sm text-gray-400 mt-1">
            {row.created_at ? new Date(row.created_at).toLocaleString('ja-JP') : ''}
            {tournament?.name ? `　/　${tournament.name} (${isTeams ? 'teams' : 'singles'})` : ''}
          </div>
        </div>

        <div className="bg-[#111326]/60 rounded-2xl border border-purple-500/30 p-4 md:p-6">
          <div id="archive-view" ref={containerRef} />
        </div>
      </div>
    </div>
  );
}
