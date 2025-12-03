'use client';

import Script from 'next/script';
import { useCallback, useEffect, useMemo, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          'error-callback'?: () => void;
          'expired-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
          size?: 'normal' | 'compact';
        }
      ) => string;
      reset?: (widgetId?: string) => void;
    };
  }
}

export default function TestTurnstilePage() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
  const [token, setToken] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [widgetId, setWidgetId] = useState<string>('');
  const [scriptReady, setScriptReady] = useState(false);

  const canRender = useMemo(() => !!siteKey && scriptReady, [siteKey, scriptReady]);

  const renderWidget = useCallback(() => {
    if (!canRender) return;
    const mount = document.getElementById('turnstile-mount');
    if (!mount) return;

    // 二重レンダー防止
    mount.innerHTML = '';

    const id = window.turnstile?.render(mount, {
      sitekey: siteKey,
      theme: 'auto',
      callback: (t) => {
        setToken(t);
        setStatus('token取得OK');
      },
      'error-callback': () => setStatus('widget error'),
      'expired-callback': () => {
        setStatus('token expired');
        setToken('');
      },
    });

    if (id) setWidgetId(id);
  }, [canRender, siteKey]);

  useEffect(() => {
    renderWidget();
  }, [renderWidget]);

  const verify = async () => {
    setStatus('verifying...');
    try {
      const resp = await fetch('/api/turnstile/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = await resp.json().catch(() => ({}));
      setStatus(`verify result: ${resp.status} ${JSON.stringify(json)}`);
    } catch (e: any) {
      setStatus(`verify error: ${e?.message || String(e)}`);
    }
  };

  const reset = () => {
    setToken('');
    setStatus('reset');
    try {
      window.turnstile?.reset?.(widgetId || undefined);
    } catch {}
    renderWidget();
  };

  return (
    <div className="min-h-screen p-6 text-white bg-[#111]">
      <h1 className="text-xl font-bold mb-4">Turnstile test</h1>

      <div className="mb-3 text-sm text-gray-300">
        SiteKey: {siteKey ? 'OK' : '未設定（NEXT_PUBLIC_TURNSTILE_SITE_KEY）'}
      </div>

      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />

      <div className="rounded-lg border border-white/10 p-4 bg-black/30 space-y-3 max-w-xl">
        <div id="turnstile-mount" />

        <div className="text-xs break-all text-gray-200">
          token: {token ? token : '(まだ)'}
        </div>

        <div className="flex gap-2">
          <button
            className="px-3 py-2 rounded bg-blue-600 disabled:opacity-50"
            onClick={verify}
            disabled={!token}
          >
            verify に送る
          </button>
          <button className="px-3 py-2 rounded bg-gray-700" onClick={reset}>
            reset / 再表示
          </button>
        </div>

        <div className="text-sm text-amber-300">{status}</div>
      </div>
    </div>
  );
}
