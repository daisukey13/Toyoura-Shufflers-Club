// components/AvatarSelector.tsx
"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";

type AvatarItem = { name: string; url: string };

type Props = {
  value?: string | null;
  onChange: (url: string) => void;
  pageSize?: number; // 既定: 20
  bucket?: string; // 既定: 'avatars'
  prefix?: string; // 既定: 'preset'
  className?: string;
};

export default function AvatarSelector({
  value,
  onChange,
  pageSize = 20,
  bucket = "avatars",
  prefix = "preset",
  className,
}: Props) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AvatarItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hasPrev = page > 1;
  const hasNext = items.length === pageSize; // 次ページがある可能性が高い

  // 表示サイズ（next/image の sizes）
  const tileSizes = "(min-width:640px) 80px, 64px";

  async function fetchPage(p: number) {
    setLoading(true);
    setErrorMsg(null);
    try {
      const offset = (p - 1) * pageSize;
      const { data, error } = await supabase.storage.from(bucket).list(prefix, {
        limit: pageSize,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw error;

      type FileLike = { name?: string };
      const files = (data ?? []).filter(
        (f: FileLike) => !!f?.name && !f.name!.startsWith("."),
      );
      const mapped: AvatarItem[] = files.map((f: Required<FileLike>) => {
        const pub = supabase.storage
          .from(bucket)
          .getPublicUrl(`${prefix}/${f.name}`);
        return { name: f.name, url: pub.data.publicUrl };
      });
      setItems(mapped);
    } catch (e: any) {
      console.error("[AvatarSelector] fetch error:", e?.message || e);
      setItems([]);
      setErrorMsg(
        "アバター画像の取得に失敗しました（後でプロフィールから設定できます）",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, bucket, prefix, pageSize]);

  const gridCols = "grid-cols-5 sm:grid-cols-10";
  const tileBox = "w-16 h-16 sm:w-20 sm:h-20";

  return (
    <div className={clsx("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">
          アバターを選択（任意）
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!hasPrev || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className={clsx(
              "rounded-md px-2 py-1 text-sm border border-white/10",
              hasPrev && !loading
                ? "hover:bg-white/5"
                : "opacity-40 cursor-not-allowed",
            )}
          >
            ← 前へ
          </button>
          <button
            type="button"
            disabled={!hasNext || loading}
            onClick={() => setPage((p) => p + 1)}
            className={clsx(
              "rounded-md px-2 py-1 text-sm border border-white/10",
              hasNext && !loading
                ? "hover:bg-white/5"
                : "opacity-40 cursor-not-allowed",
            )}
          >
            次へ →
          </button>
        </div>
      </div>

      {errorMsg && <div className="text-xs text-yellow-400">{errorMsg}</div>}

      <div className={clsx("grid gap-3", gridCols)}>
        {loading
          ? Array.from({ length: pageSize }).map((_, i) => (
              <div
                key={i}
                className={clsx("rounded-xl bg-white/5 animate-pulse", tileBox)}
              />
            ))
          : items.map((item) => {
              const selected = value === item.url;
              return (
                <button
                  key={item.url}
                  type="button"
                  onClick={() => onChange(item.url)}
                  className={clsx(
                    "relative rounded-xl overflow-hidden focus:outline-none",
                    selected
                      ? "ring-2 ring-sky-400"
                      : "ring-1 ring-white/10 hover:ring-white/30",
                    tileBox,
                  )}
                  title={item.name}
                >
                  <Image
                    src={item.url}
                    alt={item.name}
                    fill
                    sizes={tileSizes}
                    className="object-cover"
                  />
                  {selected && (
                    <div className="absolute inset-0 bg-sky-500/20">
                      <svg
                        className="absolute inset-0 m-auto w-6 h-6 text-sky-400 drop-shadow"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
      </div>

      {/* 現在の選択プレビュー + クリア */}
      <div className="flex items-center gap-2 text-xs text-gray-300">
        <span>選択中:</span>
        <div className="relative w-10 h-10">
          <Image
            src={value || "/default-avatar.png"}
            alt="selected avatar"
            fill
            sizes="40px"
            className="rounded-lg object-cover ring-1 ring-white/10"
          />
        </div>
        <button
          type="button"
          className="ml-2 text-[11px] px-2 py-1 rounded-md bg-white/10 hover:bg-white/20"
          onClick={() => onChange("")}
        >
          クリア
        </button>
      </div>
    </div>
  );
}
