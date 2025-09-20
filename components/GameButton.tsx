// components/GameButton.tsx
'use client';
import Link from 'next/link';
import { ReactNode } from 'react';

type Variant = 'green' | 'blue' | 'gold' | 'magenta';

export default function GameButton({
  href,
  onClick,
  icon,
  label,
  subLabel,
  variant = 'green',
  className = '',
}: {
  href?: string;
  onClick?: () => void;
  icon?: ReactNode;
  label: string;
  subLabel?: string;
  variant?: Variant;
  className?: string;
}) {
  const core = (
    <div
      className={[
        'btn-arcade px-5 py-4 sm:px-6 sm:py-5 text-lg sm:text-xl gap-3 w-full',
        variant === 'green' ? 'btn-arcade--green' :
        variant === 'blue'  ? 'btn-arcade--blue'  :
        variant === 'gold'  ? 'btn-arcade--gold'  : 'btn-arcade--magenta',
        className,
      ].join(' ')}
    >
      {icon && <span className="text-2xl sm:text-3xl drop-shadow">{icon}</span>}
      <div className="leading-tight">
        <div className="font-extrabold tracking-wide">{label}</div>
        {subLabel && <div className="text-xs sm:text-sm opacity-90 tnum">{subLabel}</div>}
      </div>
    </div>
  );

  if (href) return <Link href={href}>{core}</Link>;
  return <button onClick={onClick}>{core}</button>;
}
