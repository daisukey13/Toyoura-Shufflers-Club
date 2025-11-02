// app/api/tournaments/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('tournaments')
      .select('id, name, start_date, mode, size, best_of, point_cap, apply_handicap')
      .order('start_date', { ascending: false });

    if (error) {
      return NextResponse.json({ error: 'select failed', detail: error.message }, { status: 500 });
    }
    return NextResponse.json({ items: data ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'unexpected', detail: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
