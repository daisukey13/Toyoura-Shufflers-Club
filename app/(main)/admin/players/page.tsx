// app/(main)/admin/players/page.tsx
import { redirect } from 'next/navigation';

export default function AdminPlayersRedirectPage() {
  redirect('/admin/dashboard');
}
