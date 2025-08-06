// app/(main)/layout.tsx

'use client';

import GlobalNavigation from '@/components/GlobalNavigation';
import { useEffect } from 'react';

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    console.log('MainLayout mounted');
  }, []);

  return (
    <>
      <GlobalNavigation />
      <main className="min-h-screen bg-[#2a2a3e]">
        {children}
      </main>
    </>
  );
}