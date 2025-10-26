// components/TurnstileWidget.tsx
"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, any>) => string;
      reset?: (id?: string) => void;
      remove?: (id: string) => void;
    };
    __turnstileScriptPromise?: Promise<void>;
  }
}

type Props = {
  siteKey?: string;
  onVerify: (token: string) => void;
  action?: string;
  cData?: string;
  theme?: "light" | "dark" | "auto";
  className?: string;
};

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export default function TurnstileWidget({
  siteKey,
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
    const key =
      siteKey ??
      (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY as unknown as string);
    if (typeof key !== "string" || !key) {
      console.error(
        "[Turnstile] invalid siteKey. Set NEXT_PUBLIC_TURNSTILE_SITE_KEY.",
      );
      return;
    }

    if (!window.__turnstileScriptPromise) {
      window.__turnstileScriptPromise = new Promise<void>((resolve) => {
        const existed = document.querySelector<HTMLScriptElement>(
          `script[src^="${SCRIPT_SRC}"]`,
        );
        if (existed) {
          existed.addEventListener("load", () => resolve());
          if ((existed as any).readyState === "complete") resolve();
          return;
        }
        const s = document.createElement("script");
        s.src = SCRIPT_SRC;
        s.async = true;
        s.defer = true;
        s.onload = () => resolve();
        document.head.appendChild(s);
      });
    }

    let cancelled = false;

    window.__turnstileScriptPromise.then(() => {
      if (cancelled || !window.turnstile || !containerRef.current) return;
      if (renderedRef.current || widgetIdRef.current) return;
      renderedRef.current = true;

      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: key,
          theme,
          action,
          cData,
          callback: (token: string) => onVerify(token),
          "error-callback": () => {},
          "expired-callback": () => {},
        });
      } catch (e) {
        try {
          window.turnstile?.reset?.(widgetIdRef.current || undefined);
        } catch {}
        try {
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: key,
            theme,
            action,
            cData,
            callback: (token: string) => onVerify(token),
          });
        } catch (e2) {
          console.error("[Turnstile] render failed:", e2);
        }
      }
    });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile?.remove) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {}
      }
      widgetIdRef.current = null;
      renderedRef.current = false;
    };
  }, [siteKey, onVerify, action, cData, theme]);

  return <div ref={containerRef} className={className} />;
}
