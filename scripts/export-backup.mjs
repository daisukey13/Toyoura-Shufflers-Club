#!/usr/bin/env node
/**
 * export-backup.mjs
 *
 * Usage:
 *   node scripts/export-backup.mjs backup.json
 *
 * Exports players / teams / matches / tournaments etc into one JSON.
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// .env.local 読み込み（node直実行用）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  const envRaw = fs.readFileSync(envPath, "utf8");
  for (const line of envRaw.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const i = s.indexOf("=");
    if (i === -1) continue;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

const url =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  (() => {
    throw new Error("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  })();

const key = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

async function fetchAll(table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Failed to fetch ${table}: ${t}`);
  }
  return res.json();
}

const TABLES = [
  "players",
  "teams",
  "team_members",
  "tournaments",
  "tournament_entries",
  "matches",
  "match_details",
  "match_entries",
  "final_brackets",
  "final_matches",
];

async function main() {
  const out = process.argv[2];
  if (!out) {
    console.error("Usage: node scripts/export-backup.mjs backup.json");
    process.exit(1);
  }

  const backup = {};
  for (const t of TABLES) {
    console.log(`Exporting ${t}...`);
    backup[t] = await fetchAll(t);
    console.log(`  ${backup[t].length} rows`);
  }

  fs.writeFileSync(out, JSON.stringify(backup, null, 2), "utf8");
  console.log(`\n✅ Backup written to ${out}`);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
