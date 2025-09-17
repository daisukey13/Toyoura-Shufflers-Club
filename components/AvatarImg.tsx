'use client';
type Props = { src?: string | null; alt?: string; className?: string };
export default function AvatarImg({ src, alt = '', className = '' }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src || '/default-avatar.png'}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/default-avatar.png'; }}
    />
  );
}
