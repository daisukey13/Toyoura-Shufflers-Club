// components/TurnstileOnce.tsx
'use client';

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: any) => string;
      remove: (id: string) => void;
    };
  }
}

type Props = {
  siteKey: string;                 // 例: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!
  onVerify: (token: string) => void;
  action?: string;
  cData?: string;
  theme?: 'light' | 'dark' | 'auto';
  className?: string;
};

export default function TurnstileOnce({
  siteKey,
  onVerify,
  action,
  cData,
  theme = 'auto',
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef  = useRef<string | null>(null);
  const renderedRef  = useRef(false);

  useEffect(() => {
    const SCRIPT_ID = 'cf-turnstile-api';
    if (!document.getElementById(SCRIPT_ID)) {
      const s = document.createElement('script');
      s.id = SCRIPT_ID;
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }

    const tick = setInterval(() => {
      // 既に描画済み or API未ロード or DOM無し → 何もしない
      if (renderedRef.current || !window.turnstile || !containerRef.current) return;

      renderedRef.current = true;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme,
        action,
        cData,
        callback: (token: string) => onVerify(token),
        'error-callback': () => { /* 必要ならエラー表示 */ },
        'expired-callback': () => { /* 必要なら再検証依頼 */ },
      });

      clearInterval(tick);
    }, 50);

    return () => {
      clearInterval(tick);
      // アンマウント時はウィジェット破棄（StrictModeでも安全）
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch {}
      }
    };
  }, [siteKey, onVerify, action, cData, theme]);

  return <div ref={containerRef} className={className} />;
}
