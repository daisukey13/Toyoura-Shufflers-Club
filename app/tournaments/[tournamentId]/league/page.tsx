import { redirect } from 'next/navigation';

export default function TournamentLeagueEntryPage({
  params,
}: {
  params: { tournamentId: string };
}) {
  redirect(`/tournaments/${params.tournamentId}/league/results`);
}
