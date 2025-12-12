// app/api/register/provision/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function str(v: any) {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));

    // ✅ snake/camel/legacy どれでも拾う
    const user_id = str(body?.user_id ?? body?.userId ?? body?.id);
    if (!user_id) {
      return NextResponse.json({ ok: false, error: 'user_id is required' }, { status: 400 });
    }

    const handle_name = str(body?.handle_name);
    if (!handle_name) {
      return NextResponse.json({ ok: false, error: 'handle_name is required' }, { status: 400 });
    }

    const full_name = str(body?.full_name);
    const email = str(body?.email);
    const phone = str(body?.phone);
    const address = str(body?.address) || '未設定';
    const avatar_url = str(body?.avatar_url) || '/default-avatar.png';

    const rating_default = Number(process.env.NEXT_PUBLIC_RATING_DEFAULT ?? 1000);
    const handicap_default = Number(process.env.NEXT_PUBLIC_HANDICAP_DEFAULT ?? 30);

    // 1) players（公開）
    {
      const payload: any = {
        id: user_id,
        handle_name,
        avatar_url,
        address,
        is_admin: false,
        is_active: true,
        ranking_points: Number.isFinite(rating_default) ? rating_default : 1000,
        handicap: Number.isFinite(handicap_default) ? handicap_default : 30,
        matches_played: 0,
        wins: 0,
        losses: 0,
      };

      const { error } = await supabaseAdmin
        .from('players')
        .upsert(payload, { onConflict: 'id' });

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
      }
    }

    // 2) players_private（非公開）※主キー/ユニークが環境差ある前提で複数候補を試す
    {
      const tryKeys: Array<'player_id' | 'id' | 'user_id' | 'auth_user_id'> = [
        'player_id',
        'id',
        'user_id',
        'auth_user_id',
      ];

      let saved = false;
      let lastErr: any = null;

      for (const key of tryKeys) {
        const base: Record<string, any> = {
          [key]: user_id,
          full_name: full_name || null,
          email: email || null,
          phone: phone || null,
        };

        const { error } = await supabaseAdmin
          .from('players_private')
          .upsert(base as any, { onConflict: key } as any);

        if (!error) {
          saved = true;
          break;
        }

        lastErr = error;

        // “そのキーがない/ユニークじゃない” 系は次の候補へ
        const msg = String(error?.message || '');
        if (/does not exist|no unique|exclusion|schema cache/i.test(msg)) continue;

        // それ以外は即終了
        break;
      }

      // players_private が無い運用もあり得るので、無ければ警告で通す（落とすならここを throw に）
      if (!saved && lastErr) {
        const msg = String(lastErr?.message || '');
        if (/relation .* does not exist|42P01/i.test(msg)) {
          // テーブル未作成なら“登録自体はOK”として通す（最小影響）
        } else {
          return NextResponse.json({ ok: false, error: msg }, { status: 400 });
        }
      }
    }

    return NextResponse.json({ ok: true, user_id }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
