// app/layout.tsx
import type { Metadata, Viewport } from 'next';
import './globals.css';
import AuthCookieSync from './AuthCookieSync';

export const metadata: Metadata = {
  title: 'Toyoura Shufflers Club',
  description: 'Toyoura Shufflers Club – ランキング・試合・メンバー情報',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#111827',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body className="min-h-screen bg-[#2a2a3e] text-gray-100 antialiased">
        <AuthCookieSync />
        {children}
        <div id="modal-root" />
        <div id="mobile-menu-portal" />
      </body>
    </html>
  );
}
