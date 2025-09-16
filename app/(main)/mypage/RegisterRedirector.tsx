// app/(main)/mypage/RegisterRedirector.tsx
'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export default function RegisterRedirector() {
  const sp = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (sp.get('open') === 'register') {
      router.replace('/matches/register/singles');
    }
  }, [sp, router]);

  return null;
}
