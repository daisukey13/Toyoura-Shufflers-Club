// app/(main)/admin/notices/[id]/page.tsx
'use client';

import { useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';

const paramToString = (v: any) => {
  if (Array.isArray(v)) return String(v[0] ?? '').trim();
  return String(v ?? '').trim();
};

export default function AdminNoticeRedirectPage() {
  const router = useRouter();
  const params = useParams();

  const noticeId = useMemo(() => {
    const p = params as any;
    return paramToString(p?.id ?? '');
  }, [params]);

  useEffect(() => {
    if (!noticeId) return;
    router.replace(`/admin/notices/${noticeId}/edit`);
  }, [router, noticeId]);

  return (
    <div className="min-h-screen bg-[#2a2a3e] flex justify-center items-center text-white">
      移動中...
    </div>
  );
}
