// app/api/tournaments/route.ts
import { NextResponse } from 'next/server'
// ※ server側ヘルパーの名前だけ alias で合わせる（他のコードは無改変）
import { createServerSupabase as createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    const supabase = createClient()

    if (id) {
      const { data, error } = await supabase
        .from('tournaments')
        .select('id,name,mode,start_date,created_at')
        .eq('id', id)
        .maybeSingle()

      if (error) throw error
      return NextResponse.json({ ok: true, tournament: data ?? null })
    }

    const { data, error } = await supabase
      .from('tournaments')
      .select('id,name,mode,start_date,created_at')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error
    return NextResponse.json({ ok: true, tournaments: data })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    )
  }
}
