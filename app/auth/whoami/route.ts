// app/auth/whoami/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const runtime = 'nodejs';

export async function GET() {
  // 1) Clerk を最優先で判定
  try {
    const { userId } = await auth(); // ✅ ここが修正点（await）
    if (userId) {
      return NextResponse.json({ authenticated: true, via: 'clerk', userId });
    }
  } catch (e) {
    // Clerk 未設定/無効などでも落とさず次へ
  }

  // 2) （もしここに Supabase 判定などがあるなら従来通りこの下に続ける）
  return NextResponse.json({ authenticated: false, via: null, userId: null });
}
