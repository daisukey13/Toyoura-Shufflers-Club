#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' }); // ✅ 明示的に .env.local を読む

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const file = args[0];
const dryRun = args.includes('--dry-run');

if (!file) {
  console.error('Usage: node scripts/restore-backup.mjs <backup.json> [--dry-run]');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing env. Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (local only).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const backupPath = path.resolve(process.cwd(), file);
const raw = fs.readFileSync(backupPath, 'utf8');
const b = JSON.parse(raw);

const ORDER = [
  // 親
  'players',
  'teams',
  'tournaments',

  // 中間
  'team_members',
  'tournament_entries',

  // 試合
  'matches',
  'match_entries',

  // 決勝
  'final_brackets',
  'final_matches',
];

function rowsOf(key) {
  const v = b[key];
  return Array.isArray(v) ? v : [];
}

function summarize() {
  console.log('=== Backup summary ===');
  for (const k of ORDER) console.log(`${k}: ${rowsOf(k).length}`);
  console.log('======================');
}

function sanitizeRows(table, rows) {
  // ✅ 今回のエラー対策：matches の league_block_id を強制的に null にする
  if (table === 'matches') {
    return rows.map((r) => {
      if (!r || typeof r !== 'object') return r;
      return { ...r, league_block_id: null };
    });
  }
  return rows;
}

async function insertChunk(table, rows, chunkSize = 500) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    if (dryRun) {
      console.log(`[dry-run] insert ${table}: ${chunk.length}`);
      continue;
    }
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
    console.log(`inserted ${table}: ${chunk.length}`);
  }
}

async function main() {
  summarize();

  // 事故防止：DBが空（admin 1人だけ）かチェック
  const { count: playersCount, error: cErr } = await supabase.from('players').select('id', { count: 'exact', head: true });
  if (cErr) throw new Error(`players count failed: ${cErr.message}`);
  if ((playersCount ?? 0) > 1) throw new Error(`DB players count is ${playersCount}. Expected 1 (admin only). Abort.`);

  console.log('DB check ok (admin only). Start restore...');

  for (const table of ORDER) {
    let rows = rowsOf(table);
    if (!rows.length) continue;

    // admin が既にDBにいるので、playersは admin をスキップして追加
    if (table === 'players') {
      rows = rows.filter((p) => p && p.is_admin !== true);
      console.log(`players filtered: ${rows.length} (skip admin)`);
      await insertChunk('players', rows, 200);
      continue;
    }

    rows = sanitizeRows(table, rows);
    await insertChunk(table, rows, 500);
  }

  console.log('✅ Restore done.');
}

main().catch((e) => {
  console.error('❌ Restore failed:', e?.message || e);
  process.exit(1);
});
