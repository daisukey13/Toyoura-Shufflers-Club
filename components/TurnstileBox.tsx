'use client';

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: any) => void;
      reset?: (id?: string) => void;
    };
  }
}

export default function TurnstileBox({
  siteKey,
  onVerify,
}: {
  siteKey: string;
  onVerify?: (token: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = () => {
      if (window.turnstile && ref.current) {
        window.turnstile.render(ref.current, {
          sitekey: siteKey,
          theme: 'auto',
          action: 'register',
          callback: (token: string) => onVerify?.(token),
          'error-callback': () => onVerify?.(''),
          'expired-callback': () => onVerify?.(''),
        });
      }
    };

    if (!document.querySelector('script[data-turnstile]')) {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true;
      s.defer = true;
      s.setAttribute('data-turnstile', '1');
      s.onload = mount;
      document.head.appendChild(s);
    } else {
      mount();
    }
  }, [siteKey, onVerify]);

  return <div ref={ref} className="cf-turnstile" />;
}
