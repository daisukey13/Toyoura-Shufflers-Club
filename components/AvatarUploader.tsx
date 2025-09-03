'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

type Props = {
  /** 認証ユーザーの uid（必須） */
  userId: string;
  /** 保存先バケット名（既定: avatars） */
  bucket?: string;
  /** プレイヤーごとの先頭プレフィックス（既定: players）→ 実際の保存は `${bucket}/${prefix}/${userId}/...` */
  prefix?: string;
  /** 初期表示用URL（DBに既存があれば） */
  initialUrl?: string | null;
  /** アップロード/選択で決まった画像URLとストレージパスを返す */
  onSelected?: (publicUrl: string, path: string) => void;
  /** ギャラリー（本人のフォルダ内のみ）を表示するか */
  showGallery?: boolean;
};

type MyFile = { name: string; path: string; publicUrl: string };

export default function AvatarUploader({
  userId,
  bucket = 'avatars',
  prefix = 'players',
  initialUrl = null,
  onSelected,
  showGallery = true,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const basePath = `${prefix}/${userId}`;
  const [preview, setPreview] = useState<string | null>(initialUrl ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [myFiles, setMyFiles] = useState<MyFile[]>([]);
  const [listing, setListing] = useState(false);

  const pick = () => inputRef.current?.click();

  useEffect(() => {
    if (!showGallery) return;
    let cancel = false;
    (async () => {
      setListing(true);
      setErr('');
      try {
        // 自分のフォルダだけリストする
        const { data, error } = await supabase.storage.from(bucket).list(basePath, {
          sortBy: { column: 'created_at', order: 'desc' },
          limit: 50,
        });
        if (error) throw error;
        const rows = (data || [])
          .filter((o) => !o.name.endsWith('/')) // フォルダ除外
          .map((o) => {
            const path = `${basePath}/${o.name}`;
            const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
            return { name: o.name, path, publicUrl: pub?.publicUrl || '' };
          });
        if (!cancel) setMyFiles(rows);
      } catch (e: any) {
        if (!cancel) setErr(e?.message || '画像一覧の取得に失敗しました。');
      } finally {
        if (!cancel) setListing(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [supabase, bucket, basePath, showGallery]);

  async function prepareImage(file: File): Promise<Blob> {
    // 非画像や小さい画像はそのまま
    if (!file.type?.startsWith('image/')) return file;

    try {
      const bmp = await createImageBitmap(file).catch(() => null);
      if (!bmp) return file; // HEIC で失敗など → 元のまま

      // 最大 1024px に縮小
      const max = 1024;
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale);
      const h = Math.round(bmp.height * scale);

      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(bmp, 0, 0, w, h);

      const blob = await new Promise<Blob | null>((resolve) =>
        cv.toBlob((b) => resolve(b), 'image/webp', 0.9)
      );
      return blob || file;
    } catch {
      return file;
    }
  }

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setErr('');
    const f = e.target.files?.[0];
    if (!f) return;

    const tmpUrl = URL.createObjectURL(f);
    setPreview(tmpUrl);

    setBusy(true);
    try {
      const blob = await prepareImage(f);
      const ext = blob.type === 'image/webp' ? 'webp' : (f.name.split('.').pop() || 'bin');
      const filename = `${crypto.randomUUID()}.${ext}`;
      const path = `${basePath}/${filename}`;

      const { error: upErr } = await supabase.storage.from(bucket).upload(path, blob, {
        cacheControl: '3600',
        upsert: true,
        contentType: blob.type || 'application/octet-stream',
      });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
      const publicUrl = pub?.publicUrl || '';

      setPreview(publicUrl || tmpUrl);
      // ギャラリーにも即反映
      setMyFiles((prev) => [{ name: filename, path, publicUrl }, ...prev]);
      onSelected?.(publicUrl, path);
    } catch (e: any) {
      setErr(e?.message || 'アップロードに失敗しました。通信環境や権限をご確認ください。');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-3">
      {/* プレビュー + ボタン */}
      <div className="flex items-center gap-4">
        <div className="relative w-20 h-20 rounded-full overflow-hidden border border-purple-500/40 bg-gray-800">
          <Image
            src={preview || '/default-avatar.png'}
            alt="avatar"
            fill
            className="object-cover"
            unoptimized
          />
        </div>

        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleChange}
          />
          <button
            type="button"
            onClick={pick}
            disabled={busy}
            className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50"
          >
            {busy ? 'アップロード中…' : '写真を撮る / 画像を選ぶ'}
          </button>
          {err && <div className="text-sm text-red-400 mt-2">{err}</div>}
          <p className="text-xs text-gray-400 mt-1">
            カメラ撮影可。大きい画像やHEICは自動で縮小・WebP変換します。
          </p>
        </div>
      </div>

      {/* 本人専用ギャラリー */}
      {showGallery && (
        <div>
          <div className="text-xs text-gray-400 mb-2">
            自分がアップロードした画像のみ表示されます（他の人の選択には出ません）
            {listing ? ' …読み込み中' : ''}
          </div>
          {myFiles.length === 0 ? (
            <div className="text-xs text-gray-500">まだ画像がありません。</div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {myFiles.map((f) => (
                <button
                  type="button"
                  key={f.path}
                  onClick={() => {
                    setPreview(f.publicUrl);
                    onSelected?.(f.publicUrl, f.path);
                  }}
                  className="relative w-full aspect-square rounded-lg overflow-hidden border border-purple-500/30 hover:border-purple-400/60"
                  title={f.name}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.publicUrl}
                    alt={f.name}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
