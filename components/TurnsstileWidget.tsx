'use client';

import { useState } from 'react';
import Turnstile from 'react-turnstile';

export default function TurnstileWidget({
  onToken,
  theme = 'auto',
}: {
  onToken: (token?: string) => void;
  theme?: 'auto' | 'light' | 'dark';
}) {
  const [ready, setReady] = useState(false);

  return (
    <div className="mt-2">
      <Turnstile
        sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
        onVerify={(token) => onToken(token)}
        onExpire={() => onToken(undefined)}
        onError={() => onToken(undefined)}
        onLoad={() => setReady(true)}
        options={{ theme }}
      />
      {!ready && (
        <div className="text-xs text-gray-400 mt-1">
          セキュリティチェックを読み込み中…
        </div>
      )}
    </div>
  );
}
