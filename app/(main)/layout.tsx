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
    <div className="min-h-screen bg-[#2a2a3e]">
      
      <main className="lg:ml-64">
        <div className="min-h-screen">
          {children}
        </div>
      </main>
    </div>
  );
}