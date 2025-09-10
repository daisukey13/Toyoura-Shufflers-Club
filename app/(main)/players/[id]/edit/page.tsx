'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { SupabaseAPI } from '@/lib/api/supabase-api';
import type { Player } from '@/types/player';
import { supabaseConfig, supabaseHeaders } from '@/lib/config/supabase';
import AvatarUploader from '@/components/ui/AvatarUploader';

export default function EditPlayerPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [authUserId, setAuthUserId] = useState<string | null>(null);

  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    full_name: '',
    handle_name: '',
    email: '',
    avatar_url: '',
  });

  // 認証ユーザーID取得（本人用の専用フォルダにアップロードするため）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!cancelled) setAuthUserId(data.user?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const fetchPlayer = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `${supabaseConfig.url}/rest/v1/players?id=eq.${params.id}&select=*`,
        { headers: supabaseHeaders, cache: 'no-store' }
      );

      if (!response.ok) throw new Error('Failed to fetch player data');

      const data: Player[] = await response.json();
      if (!data?.length) throw new Error('Player not found');

      const p = data[0];
      setPlayer(p);
      setFormData({
        full_name: p.full_name || '',
        handle_name: p.handle_name || '',
        // players に email フィールドが無ければ無視されます
        email: (p as any).email || '',
        avatar_url: p.avatar_url || '',
      });
    } catch (err: any) {
      setError(err?.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchPlayer();
  }, [fetchPlayer]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const updateData: Partial<Player> = {
        full_name: formData.full_name,
        handle_name: formData.handle_name,
        // players に email が無い場合は Supabase 側で無視されます
        ...(formData.email ? { email: formData.email } : {}),
        avatar_url: formData.avatar_url || null,
        updated_at: new Date().toISOString(),
      } as any;

      const { error: updateError } = await SupabaseAPI.updatePlayer(params.id, updateData);
      if (updateError) throw updateError;

      router.push(`/players/${params.id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to update player');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto" />
          <p className="mt-4 text-gray-600">Loading player data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          <p className="font-bold">Error</p>
          <p>{error}</p>
        </div>
        <button
          onClick={() => router.back()}
          className="mt-4 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
        >
          Go Back
        </button>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p>Player not found</p>
        <button
          onClick={() => router.back()}
          className="mt-4 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Edit Player</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Full Name */}
          <div>
            <label htmlFor="full_name" className="block text-sm font-medium text-gray-700 mb-2">
              Full Name
            </label>
            <input
              type="text"
              id="full_name"
              name="full_name"
              value={formData.full_name}
              onChange={handleChange}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Handle Name */}
          <div>
            <label htmlFor="handle_name" className="block text-sm font-medium text-gray-700 mb-2">
              Handle Name
            </label>
            <input
              type="text"
              id="handle_name"
              name="handle_name"
              value={formData.handle_name}
              onChange={handleChange}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Email（players に無い場合は無視） */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email
            </label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Avatar：本人専用アップロード + 自分のフォルダのみギャラリー表示 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Avatar</label>

            {authUserId ? (
              <AvatarUploader
                userId={authUserId}
                initialUrl={formData.avatar_url || null}
                onSelected={(publicUrl) =>
                  setFormData((prev) => ({ ...prev, avatar_url: publicUrl }))
                }
                showGallery={true}
              />
            ) : (
              <>
                {/* 認証が取れない場合は URL 入力のフォールバック */}
                <input
                  type="url"
                  id="avatar_url"
                  name="avatar_url"
                  value={formData.avatar_url}
                  onChange={handleChange}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {formData.avatar_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={formData.avatar_url}
                    alt="Avatar preview"
                    className="w-20 h-20 rounded-full object-cover mt-2"
                    onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                  />
                )}
                <p className="text-xs text-gray-500 mt-1">
                  ログイン状態ではカメラ撮影／本人用ギャラリーから選べます。
                </p>
              </>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              <p>{error}</p>
            </div>
          )}

          <div className="flex gap-4">
            <button
              type="submit"
              disabled={saving}
              className={`px-6 py-2 text-white rounded-md ${
                saving ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="px-6 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
