// app/(main)/layout.tsx

import Header from '@/components/layout/Header';
import { AuthProvider } from '@/contexts/AuthContext';

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div className="min-h-screen text-gray-100">
        <Header />
        <main>{children}</main>
      </div>
    </AuthProvider>
  );
}