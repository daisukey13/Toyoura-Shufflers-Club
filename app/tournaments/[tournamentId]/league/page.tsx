// app/tournaments/[tournamentId]/league/page.tsx
import React from 'react';

type PageProps = {
  params: Promise<{ tournamentId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TournamentLeagueEntryPage({ params }: PageProps) {
  // ✅ Next.js 15: params は await が必要
  const { tournamentId } = await params;

  // ---- ここから下は、既存の処理/UIをそのまま ----
  // 例：fetch / supabase / components 等で tournamentId を使う
  return (
    <div>
      {/* 既存UI */}
      <div>tournamentId: {tournamentId}</div>
    </div>
  );
}
