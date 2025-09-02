// components/TurnsstileWidget.tsx
'use client';

import { useState } from 'react';
import Turnstile from 'react-turnstile';

type Props = {
  sitekey: string;
  /** 'auto' | 'light' | 'dark' (react-turnstile のトップレベル prop) */
  theme?: 'auto' | 'light' | 'dark';
  /** 検証成功時のトークン。期限切れ/エラー時は undefined を返す */
  onToken: (token?: string) => void;
  className?: string;
};

export default function TurnsstileWidget({
  sitekey,
  theme = 'auto',
  onToken,
  className,
}: Props) {
  const [ready, setReady] = useState(false);

  return (
    <div className={className}>
      <Turnstile
        sitekey={sitekey}
        theme={theme}                 {/* ← options ではなく theme を直指定 */}
        onVerify={(token) => onToken(token)}
        onExpire={() => onToken(undefined)}
        onError={() => onToken(undefined)}
        onLoad={() => setReady(true)}
      />
      {!ready && (
        <div className="text-xs text-gray-400 mt-1">CAPTCHA を読み込み中です…</div>
      )}
    </div>
  );
}
