import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getUser();
  return NextResponse.json({
    ok: !error && !!data?.user,
    email: data?.user?.email ?? null,
    uid: data?.user?.id ?? null,
    error: error?.message ?? null,
  });
}
