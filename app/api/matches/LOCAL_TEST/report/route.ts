// app/api/matches/LOCAL_TEST/report/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const diagnostics: any = {
    ok: true,
    message: 'LOCAL_TEST from production',
    supabaseUrl,
    hasAnonKey: !!supabaseAnonKey,
    anonKeyLength: supabaseAnonKey?.length ?? 0,
    timestamp: new Date().toISOString(),
  };

  try {
    if (supabaseUrl && supabaseAnonKey) {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      const { data, error } = await supabase
        .from('matches')
        .select('id')
        .limit(1);

      diagnostics.supabaseQueryOk = !error;
      diagnostics.supabaseQueryError = error
        ? { message: error.message, code: error.code }
        : null;
      diagnostics.sampleMatchId = data?.[0]?.id ?? null;
    } else {
      diagnostics.supabaseQueryOk = false;
      diagnostics.supabaseQueryError = {
        message: 'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY',
      };
    }
  } catch (e: any) {
    diagnostics.supabaseQueryOk = false;
    diagnostics.supabaseQueryError = { message: e?.message ?? String(e) };
  }

  return NextResponse.json(diagnostics);
}
