// components/TurnstileBox.tsx
"use client";

import { useEffect, useRef } from "react";

/**
 * ✅ ここが重要：
 * プロジェクト内の *すべて* の window.turnstile 宣言をこの型に統一してください。
 * （render は widgetId を string で返し、reset/remove は任意）
 */
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, any>) => string;
      reset?: (id?: string) => void;
      remove?: (id: string) => void;
    };
  }
}

type Props = {
  onVerify: (token: string) => void;
  action?: string;
  cData?: string;
  theme?: "light" | "dark" | "auto";
  className?: string;
};

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export default function TurnstileBox({
  onVerify,
  action,
  cData,
  theme = "auto",
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const renderedRef = useRef(false);

  useEffect(() => {
    // サイトキー未設定なら何もしない（プレースホルダ表示のみ）
    if (!SITE_KEY) return;

    // Turnstile API を 1 回だけ読み込む
    const SCRIPT_ID = "cf-turnstile-api";
    if (!document.getElementById(SCRIPT_ID)) {
      const s = document.createElement("script");
      s.id = SCRIPT_ID;
      s.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }

    // API 到着を待って 1 回だけ render
    const tick = setInterval(() => {
      if (!window.turnstile || !containerRef.current || renderedRef.current)
        return;

      renderedRef.current = true;
      try {
        widgetIdRef.current = window.turnstile!.render(containerRef.current, {
          sitekey: SITE_KEY, // ← string 確定
          theme,
          action,
          cData,
          callback: (token: string) => onVerify(token),
          "error-callback": () => {
            // 必要に応じてトースト/ログを追加
            // console.warn('[Turnstile] error-callback');
          },
          "expired-callback": () => {
            // 期限切れ時は必要ならリセット
            try {
              window.turnstile?.reset?.(widgetIdRef.current ?? undefined);
            } catch {}
          },
        });
      } catch (e) {
        // 既に同じ container に render されている等の安全策
        // console.warn('[Turnstile] render failed:', e);
      } finally {
        clearInterval(tick);
      }
    }, 50);

    return () => {
      clearInterval(tick);
      // アンマウント時はクリーンアップ（あれば）
      try {
        if (widgetIdRef.current) {
          window.turnstile?.remove?.(widgetIdRef.current);
        }
      } catch {}
      renderedRef.current = false;
      widgetIdRef.current = null;
    };
  }, [onVerify, action, cData, theme]);

  // サイトキー未設定のときの簡易プレースホルダ
  if (!SITE_KEY) {
    return (
      <div className={className}>
        <div className="text-sm text-red-300">
          Turnstile のサイトキーが未設定です（NEXT_PUBLIC_TURNSTILE_SITE_KEY）。
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className={className} />;
}
