import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

type Body = {
  handle_name?: string | null;
  avatar_url?: string | null;
  ranking_points?: number | null;
  handicap?: number | null;
  is_active?: boolean | null;
  is_dummy?: boolean | null;
  memo?: string | null;
};

function getUserClient() {
  const cookieStore = cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function isAdminUser(userClient: ReturnType<typeof getUserClient>) {
  // セッション確認（推奨：getClaims を使う）
  const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims();
  if (claimsErr || !claimsData?.claims) return { ok: false as const };

  // players の紐付けカラム名が環境で違う可能性があるので順番に試す
  const uid = claimsData.claims.sub;

  // 1) user_id
  let r = await userClient.from('players').select('id,is_admin').eq('user_id', uid).maybeSingle();
  if (r.error && r.error.code === '42703') {
    // 2) auth_user_id
    r = await userClient.from('players').select('id,is_admin').eq('auth_user_id', uid).maybeSingle();
  }
  if (r.error) return { ok: false as const };

  return { ok: !!r.data?.is_admin, playerId: r.data?.id as string | undefined };
}

export async function POST(req: NextRequest) {
  const userClient = getUserClient();
  const adminClient = getAdminClient();

  const admin = await isAdminUser(userClient);
  if (!admin.ok) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const payloadBase: any = {
    handle_name: (body.handle_name ?? '').trim() || null,
    avatar_url: (body.avatar_url ?? '').trim() || null,
    ranking_points: Number.isFinite(body.ranking_points as any) ? body.ranking_points : 1000,
    handicap: Number.isFinite(body.handicap as any) ? body.handicap : 30,
    is_active: body.is_active ?? true,
    is_admin: false,
  };

  // is_dummy/memo が無い環境に備えてフォールバック
  const tryInsert = async (p: any) =>
    adminClient.from('players').insert([p]).select('id').maybeSingle();

  let ins = await tryInsert({ ...payloadBase, is_dummy: body.is_dummy ?? false, memo: body.memo ?? null });
  if (ins.error) {
    ins = await tryInsert(payloadBase);
  }
  if (ins.error) {
    return NextResponse.json(
      { ok: false, error: ins.error.message, code: ins.error.code },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, id: ins.data?.id });
}

export async function GET() {
  return NextResponse.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
}
