// app/auth/whoami/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";

export async function GET() {
  // 1) Clerk を最優先で判定
  try {
    const { userId } = auth();
    if (userId) {
      return NextResponse.json({ authenticated: true, via: "clerk", userId });
    }
  } catch {
    // Clerk未設定でも落とさない
  }

  // 2) Supabase（sb-... cookie）がある場合のみ判定
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          // Route Handler なので set/remove は使えるが、ここでは whoami 判定だけなので no-op
          set(_name: string, _value: string, _options: CookieOptions) {},
          remove(_name: string, _options: CookieOptions) {},
        },
      }
    );

    const { data } = await supabase.auth.getUser();
    if (data.user) {
      return NextResponse.json({ authenticated: true, via: "supabase", userId: data.user.id });
    }
  } catch {}

  return NextResponse.json({ authenticated: false, via: "none" });
}
