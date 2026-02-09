#!/usr/bin/env node
// scripts/restore-final-matches.mjs
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const args = process.argv.slice(2);
const file = args[0];
const dryRun = args.includes('--dry-run');

if (!file) {
  console.error('Usage: node scripts/restore-final-matches.mjs <backup.json> [--dry-run]');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing env. Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (local only).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const backupPath = path.resolve(process.cwd(), file);
const b = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

const rows = Array.isArray(b.final_matches) ? b.final_matches : [];

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
  console.log(`final_matches in backup: ${rows.length}`);

  // 念のため：DBが空かチェック
  const { count, error } = await supabase.from('final_matches').select('id', { count: 'exact', head: true });
  if (error) throw new Error(`final_matches count failed: ${error.message}`);
  if ((count ?? 0) !== 0) throw new Error(`final_matches is not empty (count=${count}). Abort.`);

  await insertChunk('final_matches', rows, 500);

  console.log('✅ final_matches restore done.');
}

main().catch((e) => {
  console.error('❌ Restore failed:', e?.message || e);
  process.exit(1);
});
