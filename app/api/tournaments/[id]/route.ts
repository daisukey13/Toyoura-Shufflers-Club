import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data, error } = await supabase.from('tournaments').select('*').eq('id', params.id).single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'not found' }, { status: 404 });
  return NextResponse.json({ item: data });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const patch = await req.json().catch(() => ({}));
  const { data, error } = await supabase.from('tournaments').update(patch).eq('id', params.id).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ item: data });
}
