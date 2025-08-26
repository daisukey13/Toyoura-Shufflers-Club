// components/AuthStatusDot.tsx
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Props = {
  className?: string;
  showEmail?: boolean; // true にするとメールも横に表示
};

export default function AuthStatusDot({ className = '', showEmail = false }: Props) {
  const supabase = createClient();
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!mounted) return;
      setEmail(user?.email ?? null);
      setReady(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });

    return () => {
      sub.subscription.unsubscribe();
      mounted = false;
    };
  }, [supabase]);

  const loggedIn = !!email;
  const color = loggedIn ? 'bg-blue-500' : 'bg-gray-400';
  const label = loggedIn ? `ログイン中${email ? `: ${email}` : ''}` : '未ログイン';

  return (
    <div className={`inline-flex items-center gap-2 ${className}`} title={label} aria-label={label}>
      {/* 青点 / グレー点 */}
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${color} shadow`} />
      {showEmail && ready && (
        <span className="text-xs text-gray-300">{email ?? 'ゲスト'}</span>
      )}
    </div>
  );
}
