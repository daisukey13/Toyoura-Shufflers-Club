import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('tournaments')
    .select('id,name,start_date,mode,size,best_of,point_cap,apply_handicap')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const body = await req.json().catch(() => ({}));

  const payload = {
    name: body.name ?? '新しい大会',
    start_date: body.start_date ?? new Date().toISOString().slice(0, 10),
    mode: body.mode ?? 'singles',
    size: body.size ?? 4,
    best_of: body.best_of ?? 1,
    point_cap: body.point_cap ?? 15,
    apply_handicap: body.apply_handicap ?? true,
    time_limit_minutes: body.time_limit_minutes ?? 30,
  };

  const { data, error } = await supabase.from('tournaments').insert(payload).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ item: data }, { status: 201 });
}
