// app/(main)/layout.tsx
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-64px)]">{children}</main>
      <Footer />
    </>
  );
}
