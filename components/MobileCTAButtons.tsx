'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { FaUserPlus, FaGamepad, FaUsers, FaSignInAlt, FaCheck } from 'react-icons/fa';
import { useAuth } from '@/contexts/AuthContext';

type Variant = 'primary' | 'pink' | 'orange' | 'teal' | 'success' | 'disabled';

function baseClasses(variant: Variant) {
  const common =
    'w-full h-14 px-4 rounded-2xl flex items-center justify-between gap-3 shadow-lg ring-1 transition active:scale-[0.99]';
  const left =
    'shrink-0 w-10 h-10 rounded-xl grid place-items-center text-white/90 shadow-inner';
  const right =
    'ml-auto text-sm font-semibold tracking-wide';
  const label = 'text-[15px] font-semibold';

  const skin: Record<Variant, string> = {
    primary:
      'bg-gradient-to-r from-violet-600 to-fuchsia-600 ring-violet-400/40 hover:brightness-[1.05]',
    pink:
      'bg-gradient-to-r from-pink-600 to-rose-600 ring-rose-400/40 hover:brightness-[1.05]',
    orange:
      'bg-gradient-to-r from-orange-500 to-amber-500 ring-amber-300/40 hover:brightness-[1.05]',
    teal:
      'bg-gradient-to-r from-cyan-600 to-teal-600 ring-teal-300/40 hover:brightness-[1.05]',
    success:
      'bg-gradient-to-r from-emerald-600 to-green-600 ring-emerald-300/40',
    disabled:
      'bg-gradient-to-r from-slate-600 to-slate-700 ring-slate-400/30 opacity-70 cursor-not-allowed',
  };

  const leftSkin: Record<Variant, string> = {
    primary: 'bg-white/20',
    pink: 'bg-white/20',
    orange: 'bg-white/20',
    teal: 'bg-white/20',
    success: 'bg-white/15',
    disabled: 'bg-white/10',
  };

  return { common: `${common} ${skin[variant]}`, left, leftSkin: leftSkin[variant], right, label };
}

function CTAButton({
  href,
  icon,
  text,
  variant,
  disabled = false,
}: {
  href?: string;
  icon: React.ReactNode;
  text: string;
  variant: Variant;
  disabled?: boolean;
}) {
  const c = baseClasses(disabled ? 'disabled' : variant);
  const Inner = (
    <div className={c.common} aria-disabled={disabled}>
      <div className={`${c.left} ${c.leftSkin}`}>{icon}</div>
      <span className={`text-white ${c.label}`}>{text}</span>
      <span className={`${c.right} text-white/90`}>→</span>
    </div>
  );
  if (disabled || !href) return <div>{Inner}</div>;
  return (
    <Link href={href} className="block">
      {Inner}
    </Link>
  );
}

export default function MobileCTAButtons() {
  const { user, player, loading } = useAuth();

  const isLoggedIn = !!user;
  const loginLabel = useMemo(() => {
    if (loading) return '読み込み中…';
    if (isLoggedIn) return 'ログイン中';
    return 'ログイン';
  }, [loading, isLoggedIn]);

  const loginHref = useMemo(() => {
    if (loading) return undefined;
    if (isLoggedIn) {
      // 管理者はダッシュボード、一般はマイページへ
      return player?.is_admin ? '/admin/dashboard' : '/mypage';
    }
    return '/login';
  }, [loading, isLoggedIn, player?.is_admin]);

  const loginVariant: Variant = loading ? 'disabled' : isLoggedIn ? 'success' : 'teal';

  return (
    <div className="mx-auto w-full max-w-xs sm:max-w-none sm:w-[28rem] space-y-3">
      <CTAButton
        href="/register"
        icon={<FaUserPlus className="text-xl" />}
        text="新規登録"
        variant="primary"
      />
      <CTAButton
        href="/matches/register/singles"
        icon={<FaGamepad className="text-xl" />}
        text="個人試合を登録"
        variant="pink"
      />
      <CTAButton
        href="/matches/register/teams"
        icon={<FaUsers className="text-xl" />}
        text="チーム試合を登録"
        variant="orange"
      />
      <CTAButton
        href={loginHref}
        icon={isLoggedIn ? <FaCheck className="text-xl" /> : <FaSignInAlt className="text-xl" />}
        text={loginLabel}
        variant={loginVariant}
        disabled={loading}
      />
    </div>
  );
}
