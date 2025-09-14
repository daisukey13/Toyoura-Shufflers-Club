// app/(main)/matches/register/page.tsx
import { redirect } from 'next/navigation';

// 旧URL互換: /matches/register は /matches/register/singles へ
export default function Page() {
  redirect('/matches/register/singles');
}
