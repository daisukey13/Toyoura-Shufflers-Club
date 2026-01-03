'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FaUserCircle } from 'react-icons/fa';

type WhoamiResponse = {
  authenticated: boolean;
  via?: string;
};

export default function LoginStatusIcon() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;

    const run = async () => {
      try {
        const res = await fetch('/auth/whoami', { cache: 'no-store' });
        const json = (await res.json()) as WhoamiResponse;
        if (alive) setAuthed(!!json.authenticated);
      } catch {
        if (alive) setAuthed(false);
      }
    };

    void run();
    const id = window.setInterval(run, 60_000); // 1分に1回更新（不要なら消してOK）

    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const isAuthed = authed === true;

  const statusRing = isAuthed ? 'ring-2 ring-green-400/70' : 'ring-2 ring-purple-400/60';
  const statusDotClass =
    'absolute -right-0.5 -top-0.5 w-3.5 h-3.5 rounded-full ' +
    (isAuthed
      ? 'bg-green-400 shadow-[0_0_12px_2px_rgba(74,222,128,0.6)]'
      : 'bg-purple-400 shadow-[0_0_12px_2px_rgba(192,132,252,0.6)]');

  const href = isAuthed ? '/mypage' : '/login?redirect=/mypage';

  return (
    <Link
      href={href}
      prefetch={false}
      className={`relative p-3 sm:p-4 rounded-2xl hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30 ${statusRing}`}
      aria-label={isAuthed ? 'ログイン中' : '未ログイン'}
      title={isAuthed ? 'ログイン中' : '未ログイン'}
    >
      <FaUserCircle className="text-3xl sm:text-4xl" />
      <span className={statusDotClass} />
    </Link>
  );
}

