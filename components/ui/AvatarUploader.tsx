'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Props = {
  userId: string;
  initialUrl: string | null;
  onSelected: (publicUrl: string) => void;
  showGallery?: boolean;

  // オプション（未指定でも動く）
  galleryBucket?: string; // 例: "avatars"
  galleryPrefix?: string; // 例: "preset" や userId
  galleryLimit?: number;  // 例: 100
};

type GalleryItem = {
  name: string;
  path: string;
  url: string;
};

export default function AvatarUploader({
  userId,
  initialUrl,
  onSelected,
  showGallery = false,
  galleryBucket = 'avatars',
  galleryPrefix = 'preset',
  galleryLimit = 100,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [currentUrl, setCurrentUrl] = useState<string>(initialUrl ?? '');
  const [uploading, setUploading] = useState(false);

  const [loadingGallery, setLoadingGallery] = useState(false);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [galleryError, setGalleryError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentUrl(initialUrl ?? '');
  }, [initialUrl]);

  const toPublicUrl = useCallback(
    (path: string) => {
      const { data } = supabase.storage.from(galleryBucket).getPublicUrl(path);
      return data.publicUrl;
    },
    [supabase, galleryBucket]
  );

  const refreshGallery = useCallback(async () => {
    if (!showGallery) return;

    setLoadingGallery(true);
    setGalleryError(null);

    try {
      const { data, error } = await supabase.storage
        .from(galleryBucket)
        .list(galleryPrefix, {
          limit: galleryLimit,
          offset: 0,
          sortBy: { column: 'name', order: 'asc' },
        });

      if (error) throw error;

      const items: GalleryItem[] = [];
      const list = data ?? [];

      for (let i = 0; i < list.length; i++) {
        const obj = list[i];
        if (!obj?.name) continue;

        // フォルダっぽいのは除外
        if ((obj as any).id == null && (obj as any).metadata == null && obj.name.includes('/')) continue;

        const path = `${galleryPrefix}/${obj.name}`;
        const url = toPublicUrl(path);
        items.push({ name: obj.name, path, url });
      }

      setGallery(items);
    } catch (e) {
      setGallery([]);
      setGalleryError(e instanceof Error ? e.message : 'Failed to load gallery');
    } finally {
      setLoadingGallery(false);
    }
  }, [showGallery, supabase, galleryBucket, galleryPrefix, galleryLimit, toPublicUrl]);

  useEffect(() => {
    refreshGallery();
  }, [refreshGallery]);

  const openPicker = () => {
    inputRef.current?.click();
  };

  const onPickFile = async (file: File | null) => {
    if (!file) return;

    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const filename = `${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;
      const uploadPath = `${userId}/${filename}`;

      const { error: upErr } = await supabase.storage
        .from(galleryBucket)
        .upload(uploadPath, file, {
          upsert: false,
          contentType: file.type || 'image/jpeg',
        });

      if (upErr) throw upErr;

      const url = toPublicUrl(uploadPath);

      setCurrentUrl(url);
      onSelected(url);

      // 自分フォルダのギャラリーも見たい場合は prefix を userId にして使ってください
      // ここでは preset を壊さないため refresh は任意
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-200 shrink-0">
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentUrl} alt="avatar" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full" />
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openPicker}
            disabled={uploading}
            className={`px-3 py-2 rounded-md text-white ${
              uploading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {uploading ? 'Uploading...' : 'Upload / Camera'}
          </button>

          <button
            type="button"
            onClick={refreshGallery}
            disabled={loadingGallery}
            className="px-3 py-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300"
          >
            Refresh
          </button>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
      />

      <p className="text-xs text-gray-500">ログイン中ユーザーのフォルダ（{userId}）に保存されます。</p>

      {showGallery && (
        <div className="space-y-2">
          <div className="text-sm text-gray-600">
            choose from gallery ({gallery.length})
            {loadingGallery ? ' ...' : ''}
          </div>

          {galleryError && (
            <div className="text-sm text-red-600">{galleryError}</div>
          )}

          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {gallery.map((g) => (
              <button
                key={g.path}
                type="button"
                className="rounded-lg overflow-hidden border border-gray-300 hover:border-blue-500"
                onClick={() => {
                  setCurrentUrl(g.url);
                  onSelected(g.url);
                }}
                title={g.name}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.url} alt={g.name} className="w-full aspect-square object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
