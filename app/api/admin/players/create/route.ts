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

/**
 * ログインユーザー用 Supabase クライアント
 * Next.js の cookies() が Promise を返す環境に対応するため async 化
 */
async function getUserClient() {
  const cookieStore = await cookies(); // ★ ここを await に変更

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        // cookieStore は ReadonlyRequestCookies
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Edge / 一部環境で set が失敗する可能性もあるので try-catch
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // 失敗しても致命的ではないので握りつぶす
        }
      },
    },
  });
}

/**
 * 管理者権限用 Supabase クライアント（Service Role）
 */
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * ログインユーザーが管理者かどうか判定
 */
async function isAdminUser(
  userClient: Awaited<ReturnType<typeof getUserClient>> // getUserClient の戻り値に追従
) {
  // セッション確認（推奨：getClaims を使う）
  const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims();
  if (claimsErr || !claimsData?.claims) return { ok: false as const };

  const uid = claimsData.claims.sub;

  // players の紐付けカラム名が環境で違う可能性があるので順番に試す
  // 1) user_id
  let r = await userClient
    .from('players')
    .select('id,is_admin')
    .eq('user_id', uid)
    .maybeSingle();

  if (r.error && r.error.code === '42703') {
    // 2) auth_user_id
    r = await userClient
      .from('players')
      .select('id,is_admin')
      .eq('auth_user_id', uid)
      .maybeSingle();
  }

  if (r.error) return { ok: false as const };

  return { ok: !!r.data?.is_admin, playerId: r.data?.id as string | undefined };
}

/**
 * 管理画面からのプレイヤー新規作成
 */
export async function POST(req: NextRequest) {
  // ★ ここも await getUserClient() に変更
  const userClient = await getUserClient();
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
    ranking_points: Number.isFinite(body.ranking_points as any)
      ? body.ranking_points
      : 1000,
    handicap: Number.isFinite(body.handicap as any) ? body.handicap : 30,
    is_active: body.is_active ?? true,
    is_admin: false,
  };

  // is_dummy / memo カラムが存在しない環境も考慮してフォールバック
  const tryInsert = async (p: any) =>
    adminClient.from('players').insert([p]).select('id').maybeSingle();

  let ins = await tryInsert({
    ...payloadBase,
    is_dummy: body.is_dummy ?? false,
    memo: body.memo ?? null,
  });

  if (ins.error) {
    // カラムが無い等で失敗した場合は、ベースのみでもう一度試す
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
  return NextResponse.json(
    { ok: false, error: 'method_not_allowed' },
    { status: 405 }
  );
}
