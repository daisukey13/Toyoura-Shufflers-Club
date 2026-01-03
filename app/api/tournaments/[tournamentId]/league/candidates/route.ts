import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || "";

  if (!url || !key) {
    throw new Error("Missing SUPABASE URL / SERVICE ROLE KEY env");
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

type LeagueCandidateRow = {
  block_id: string;
  block_label: string;
  player_id: string;
  rank?: number | null;
  wins?: number | null;
  losses?: number | null;
  point_diff?: number | null;
  played?: number | null;
};

type LeagueCandidateBlock = {
  block_id: string;
  block_label: string;
  rows: LeagueCandidateRow[];
};

type LeagueCandidates = {
  source: string;
  blocks: LeagueCandidateBlock[];
};

const pick = (obj: any, keys: string[]) => {
  for (const k of keys) if (obj?.[k] != null) return obj[k];
  return null;
};

const toNum = (v: any, fb: number | null = null) => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fb;
};

function normalize(source: string, rows: any[], tournamentId: string): LeagueCandidates {
  const filtered = rows.filter((r) => {
    const tid = pick(r, ["tournament_id", "tournamentId", "t_id", "tournament"]);
    // tournament_id が無いビューもあるので、その場合はフィルタしない
    return tid == null ? true : String(tid) === tournamentId;
  });

  const byBlock = new Map<string, LeagueCandidateBlock>();

  for (const r of filtered) {
    const bid = String(pick(r, ["block_id", "league_block_id", "group_id", "block"]) ?? "");
    const pid = String(pick(r, ["player_id", "player", "entrant_id"]) ?? "");
    if (!bid || !pid) continue;

    const blockNo = pick(r, ["block_no", "group_no"]);
    const name = pick(r, ["block_name", "block_label", "block_title", "name", "label"]);
    const label = String(name ?? "") || (blockNo != null ? `Block ${blockNo}` : `Block ${bid.slice(0, 6)}`);

    if (!byBlock.has(bid)) byBlock.set(bid, { block_id: bid, block_label: label, rows: [] });

    byBlock.get(bid)!.rows.push({
      block_id: bid,
      block_label: label,
      player_id: pid,
      rank: toNum(pick(r, ["rank", "position", "place"]), null),
      wins: toNum(pick(r, ["wins", "win", "w"]), null),
      losses: toNum(pick(r, ["losses", "loss", "l"]), null),
      point_diff: toNum(pick(r, ["point_diff", "diff", "score_diff", "pt_diff"]), null),
      played: toNum(pick(r, ["played", "games", "matches"]), null),
    });
  }

  const blocks = Array.from(byBlock.values());

  // standings系なら先頭が「優勝者」になりやすいようにソート
  for (const b of blocks) {
    b.rows.sort((a, c) => {
      const ar = a.rank ?? 9999;
      const cr = c.rank ?? 9999;
      if (ar !== cr) return ar - cr;

      const aw = a.wins ?? -9999;
      const cw = c.wins ?? -9999;
      if (cw !== aw) return cw - aw;

      const ad = a.point_diff ?? -9999;
      const cd = c.point_diff ?? -9999;
      if (cd !== ad) return cd - ad;

      return String(a.player_id).localeCompare(String(c.player_id));
    });
  }

  blocks.sort((a, b) => a.block_label.localeCompare(b.block_label, "ja"));
  return { source, blocks };
}

async function trySelect(
  admin: any,
  debug: any[],
  table: string,
  build: (q: any) => any
): Promise<any[] | null> {
  try {
    const { data, error } = await build(admin.from(table).select("*"));
    if (error) {
      debug.push({ table, ok: false, error: String(error.message || error) });
      return null;
    }
    debug.push({ table, ok: true, count: (data ?? []).length });
    return (data ?? []) as any[];
  } catch (e: any) {
    debug.push({ table, ok: false, error: String(e?.message || e) });
    return null;
  }
}

export async function GET(_: Request, ctx: { params: { tournamentId: string } }) {
  const tournamentId = String(ctx.params.tournamentId || "").trim();
  const debug: any[] = [];

  if (!tournamentId) return NextResponse.json({ ok: false, message: "missing tournamentId" }, { status: 400 });

  try {
    const admin = getAdmin();

    // ① standings/view/mv があるなら最優先
    const standingsTables = ["league_block_standings_mv", "league_block_standings", "league_results_by_block_mv"];

    for (const t of standingsTables) {
      const r1 = await trySelect(admin, debug, t, (q) => q.eq("tournament_id", tournamentId));
      if (r1 && r1.length) return NextResponse.json({ ok: true, data: normalize(t, r1, tournamentId), debug });

      // tournament_id が無い等の時は全取得→JSフィルタ
      const r2 = await trySelect(admin, debug, t, (q) => q.limit(3000));
      if (r2 && r2.length) {
        const n = normalize(`${t} (no tournament_id filter)`, r2, tournamentId);
        if (n.blocks.length) return NextResponse.json({ ok: true, data: n, debug });
      }
    }

    // ② standingsが無い場合：blocks + entries
    const blockTables = ["league_blocks", "tournament_league_blocks", "tournament_league_blocks_mv"];
    let blocks: any[] | null = null;
    let blockSource = "";

    for (const bt of blockTables) {
      const b = await trySelect(admin, debug, bt, (q) => q.eq("tournament_id", tournamentId).order("block_no", { ascending: true }));
      if (b && b.length) {
        blocks = b;
        blockSource = bt;
        break;
      }
    }
    if (!blocks?.length) {
      return NextResponse.json({ ok: false, message: "no blocks found", debug }, { status: 200 });
    }

    const blockIds = blocks.map((b) => String(pick(b, ["id"]) ?? "")).filter(Boolean);

    const entryTables = ["league_block_entries", "league_block_members", "league_block_players"];
    let entries: any[] | null = null;
    let entrySource = "";

    for (const et of entryTables) {
      const e1 = await trySelect(admin, debug, et, (q) => q.in("block_id", blockIds));
      if (e1 && e1.length) {
        entries = e1;
        entrySource = `${et}.block_id`;
        break;
      }
      const e2 = await trySelect(admin, debug, et, (q) => q.in("league_block_id", blockIds));
      if (e2 && e2.length) {
        entries = e2;
        entrySource = `${et}.league_block_id`;
        break;
      }
    }

    if (!entries) return NextResponse.json({ ok: false, message: "no entries found", debug }, { status: 200 });

    const byBlock = new Map<string, LeagueCandidateBlock>();
    for (const b of blocks) {
      const bid = String(pick(b, ["id"]) ?? "");
      const label =
        String(pick(b, ["name", "title", "label"]) ?? "") ||
        (pick(b, ["block_no"]) != null ? `Block ${pick(b, ["block_no"])}` : `Block ${bid.slice(0, 6)}`);
      byBlock.set(bid, { block_id: bid, block_label: label, rows: [] });
    }

    for (const e of entries) {
      const bid = String(pick(e, ["block_id", "league_block_id"]) ?? "");
      const pid = String(pick(e, ["player_id", "entrant_id"]) ?? "");
      if (!bid || !pid) continue;
      const blk = byBlock.get(bid);
      if (!blk) continue;
      blk.rows.push({ block_id: bid, block_label: blk.block_label, player_id: pid });
    }

    const blocksOut = Array.from(byBlock.values()).filter((b) => b.rows.length > 0);
    return NextResponse.json(
      { ok: true, data: { source: `${blockSource} + ${entrySource} (no standings)`, blocks: blocksOut }, debug },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: String(e?.message || e), debug }, { status: 500 });
  }
}
