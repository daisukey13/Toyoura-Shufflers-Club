// app/api/admin/f2f-register/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const DEFAULT_AVATAR = '/default-avatar.png';

function randBase36(len: number) {
  let s = '';
  while (s.length < len) s += Math.random().toString(36).slice(2);
  return s.slice(0, len);
}

/** players_private の upsert を堅牢化（409や列差分に耐える） */
async function upsertPlayersPrivateSafe(admin: any, payload: Record<string, any>) {
  // まずは “merge upsert” を正攻法で試す
  const tryUpsert = async (p: Record<string, any>) =>
    admin.from('players_private').upsert(p, { onConflict: 'player_id' }).select('player_id');

  // 列が無い環境差に備えて、段階的に削る
  const candidates: Record<string, any>[] = [
    { ...payload }, // full
    (() => {
      const x = { ...payload };
      delete x.email;
      return x;
    })(),
    (() => {
      const x = { ...payload };
      delete x.email;
      delete x.phone;
      return x;
    })(),
    { player_id: payload.player_id }, // 最小
  ];

  let lastErr: any = null;

  for (const cand of candidates) {
    const { error } = await tryUpsert(cand);
    if (!error) return { ok: true };

    lastErr = error;

    // 409/23505系は “merge upsert” が効かない環境があるので update fallback を試す
    const msg = String(error?.message ?? '');
    const code = String((error as any)?.code ?? '');
    const maybeConflict =
      msg.includes('409') ||
      msg.toLowerCase().includes('conflict') ||
      msg.toLowerCase().includes('duplicate') ||
      code === '23505';

    if (maybeConflict) {
      // 既存行がある前提で update
      const { error: uErr } = await admin
        .from('players_private')
        .update(cand)
        .eq('player_id', payload.player_id);

      if (!uErr) return { ok: true };

      lastErr = uErr;
      // update でもダメなら次の候補へ
      continue;
    }

    // “column does not exist”等であれば次候補へ
    if (/does not exist|column .* does not exist|schema cache/i.test(msg)) continue;

    // それ以外は致命的として打ち切り
    break;
  }

  return { ok: false, error: lastErr };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const handle_name = String(body?.handle_name ?? '').trim();
    const full_name = String(body?.full_name ?? '').trim();
    const phone = String(body?.phone ?? '').trim();
    const address = String(body?.address ?? '未設定').trim() || '未設定';
    const avatar_url = String(body?.avatar_url ?? '').trim() || DEFAULT_AVATAR;

    if (!handle_name) {
      return NextResponse.json({ ok: false, message: 'ハンドルネームを入力してください。' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const RATING_DEFAULT = Number(process.env.NEXT_PUBLIC_RATING_DEFAULT ?? 1000);
    const HANDICAP_DEFAULT = Number(process.env.NEXT_PUBLIC_HANDICAP_DEFAULT ?? 30);

    if (!url || !anon || !service) {
      return NextResponse.json(
        { ok: false, message: '環境変数が不足しています（SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY）。' },
        { status: 500 }
      );
    }

    // cookieセッションで「ログイン中ユーザー」を取得
    const cookieStore = await cookies();
    const supa = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {}
        },
      },
    });

    const { data: ures, error: uerr } = await supa.auth.getUser();
    if (uerr) return NextResponse.json({ ok: false, message: uerr.message }, { status: 401 });
    const me = ures.user;
    if (!me) return NextResponse.json({ ok: false, message: '管理者としてログインしてください。' }, { status: 401 });

    // service role（RLS無視）
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

    // 管理者判定：players.is_admin
    const { data: meRow, error: meErr } = await admin
      .from('players')
      .select('id, is_admin')
      .eq('id', me.id)
      .maybeSingle();

    if (meErr) {
      return NextResponse.json({ ok: false, message: `管理者確認に失敗しました: ${meErr.message}` }, { status: 500 });
    }
    if (!meRow || !(meRow as any).is_admin) {
      return NextResponse.json({ ok: false, message: '管理者権限がありません。' }, { status: 403 });
    }

    // ✅ 追加：handle_name 重複を “先に” 判定（Authユーザーだけ作ってしまう事故防止）
    {
      const { data: exist, error: existErr } = await admin
        .from('players')
        .select('id')
        .eq('handle_name', handle_name)
        .maybeSingle();

      if (existErr) {
        return NextResponse.json({ ok: false, message: `重複チェックに失敗しました: ${existErr.message}` }, { status: 500 });
      }
      if (exist?.id) {
        return NextResponse.json({ ok: false, message: 'そのハンドルネームは既に登録されています。' }, { status: 409 });
      }
    }

    // ダミーメール＋パスワード生成
    const prefix = `${Date.now()}-${randBase36(6)}`;
    const dummyEmail = `${prefix}@toyoura.online`;
    const dummyPassword = `A${randBase36(18)}!`;

    // Authユーザー作成（確認メール不要）
    const created = await admin.auth.admin.createUser({
      email: dummyEmail,
      password: dummyPassword,
      email_confirm: true,
      user_metadata: {
        f2f: true,
        created_by: me.id,
      },
    });

    if (created.error || !created.data?.user) {
      return NextResponse.json(
        { ok: false, message: created.error?.message ?? 'ユーザー作成に失敗しました。' },
        { status: 500 }
      );
    }

    const newUserId = created.data.user.id;

    // players 作成
    const publicRow = {
      id: newUserId,
      handle_name,
      avatar_url,
      address,
      is_admin: false,
      is_active: true,
      ranking_points: RATING_DEFAULT,
      handicap: HANDICAP_DEFAULT,
      matches_played: 0,
      wins: 0,
      losses: 0,
    };

    const insP = await admin.from('players').insert([publicRow] as any);
    if (insP.error) {
      // ✅ 追加：失敗時は Auth ユーザーを掃除（孤児化防止）
      try {
        await admin.auth.admin.deleteUser(newUserId);
      } catch {}
      return NextResponse.json(
        { ok: false, message: `players 作成に失敗しました: ${insP.error.message}`, created_user_id: newUserId },
        { status: 500 }
      );
    }

    // ✅ 修正：players_private は “player_id で固定” して upsert（PKが player_id のため）
    const privatePayload: Record<string, any> = {
      player_id: newUserId,
      full_name: full_name || handle_name,
      phone: phone || null,
      // email 列が無い環境もあるので safe upsert 内で段階的に落とす
      email: dummyEmail,
    };

    const pp = await upsertPlayersPrivateSafe(admin, privatePayload);
    if (!pp.ok) {
      // ✅ 追加：private が作れない場合はロールバック（players と auth を掃除）
      try {
        await admin.from('players').delete().eq('id', newUserId);
      } catch {}
      try {
        await admin.auth.admin.deleteUser(newUserId);
      } catch {}

      return NextResponse.json(
        { ok: false, message: `players_private 作成に失敗しました: ${String((pp as any).error?.message ?? '')}`, created_user_id: newUserId },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, player_id: newUserId, handle_name });
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: e?.message ?? 'エラーが発生しました' }, { status: 500 });
  }
}
