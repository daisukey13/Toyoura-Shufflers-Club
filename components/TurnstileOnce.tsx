// components/TurnstileOnce.tsx
'use client';

import { useEffect, useRef } from 'react';

type Props = {
  siteKey: string;
  onVerify: (token: string) => void;
  action?: string;
  cData?: string;
  theme?: 'light' | 'dark' | 'auto';
  className?: string;
};

/**
 * Cloudflare Turnstile（1回だけ描画）
 * - グローバル型は再宣言しない（既存の型と衝突するため）
 * - 実体は any 経由で安全に呼び出す
 */
export default function TurnstileOnce({
  siteKey,
  onVerify,
  action,
  cData,
  theme = 'auto',
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const renderedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // スクリプトを一度だけ挿入
    const SCRIPT_ID = 'cf-turnstile-api';
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    // API 出現をポーリングして 1 回だけ render
    const poll = setInterval(() => {
      const t: any = (window as any).turnstile;
      if (!t || !containerRef.current || renderedRef.current) return;

      renderedRef.current = true;
      const maybeId = t.render(containerRef.current, {
        sitekey: siteKey,
        theme,
        action,
        cData,
        callback: (token: string) => onVerify(token),
        'error-callback': () => {},
        'expired-callback': () => {},
      });

      // 型定義によっては render の戻り値が void になっている場合があるので安全に格納
      widgetIdRef.current = typeof maybeId === 'string' ? maybeId : null;

      clearInterval(poll);
    }, 50);

    return () => {
      clearInterval(poll);
      const t: any = (window as any).turnstile;
      const id = widgetIdRef.current;

      if (!t) return;
      // どちらが存在してもクリーンアップできるように分岐
      if (id && typeof t.remove === 'function') {
        try { t.remove(id); } catch {}
      } else if (typeof t.reset === 'function') {
        try { t.reset(id); } catch {}
      }
    };
  }, [siteKey, onVerify, action, cData, theme]);

  return <div ref={containerRef} className={className} />;
}
