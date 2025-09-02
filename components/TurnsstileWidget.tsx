// components/TurnsstileWidget.tsx
'use client';

import { useState } from 'react';
import Turnstile, { type TurnstileProps } from 'react-turnstile';

type Props = {
  sitekey: string;
  /** 'auto' | 'light' | 'dark' */
  theme?: TurnstileProps['theme'];
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
      {/* react-turnstile は options ではなく、theme をトップレベル prop で渡します */}
      <Turnstile
        sitekey={sitekey}
        theme={theme}
        onVerify={(token) => onToken(token)}
        onExpire={() => onToken(undefined)}
        onError={() => onToken(undefined)}
        onLoad={() => setReady(true)}
      />
      {!ready && (
        <div className="text-xs text-gray-400 mt-1">
          CAPTCHA を読み込み中です...
        </div>
      )}
    </div>
  );
}
