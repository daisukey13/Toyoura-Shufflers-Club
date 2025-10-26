"use client";

import Link from "next/link";

type Props = { className?: string };

export default function LoginButton({ className = "" }: Props) {
  return (
    <Link
      href="/login"
      prefetch
      className={`px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white inline-flex items-center justify-center ${className}`}
    >
      ログイン
    </Link>
  );
}
