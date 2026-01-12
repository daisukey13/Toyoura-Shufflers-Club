// app/(main)/players/[id]/edit/page.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Player } from '@/types/player';
import AvatarUploaderRaw from '@/components/ui/AvatarUploader';

type AvatarUploaderProps = {
  userId: string;
  initialUrl: string | null;
  onSelected: (publicUrl: string) => void;
  showGallery?: boolean;
  galleryBucket?: string;
  galleryPrefix?: string;
  galleryLimit?: number;
};
const AvatarUploader = AvatarUploaderRaw as unknown as ComponentType<AvatarUploaderProps>;

const ADDRESS_OPTIONS: string[] = ['未選択', '豊浦町', '洞爺湖町', '伊達市', '室蘭市', '登別市', '札幌市', 'その他'];

type PrivateBaseRow = {
  full_name: string | null;
  phone: string | null;
  email: string | null;
  is_admin?: boolean | null;
};

type PrivateOptRow = {
  admin_note: string | null;
};

type TeamRow = { id: string; name: string };
type TeamMemberRow = { team_id: string };

export default function EditPlayerPage() {
  const params = useParams<{ id: string }>();
  const playerId = params?.id;

  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // ✅ write系を確実に型エラー回避するためのヘルパー（UI/UX変更なし）
  const fromAny = useCallback((table: string) => (supabase.from(table as any) as any), [supabase]);

  const [authChecked, setAuthChecked] = useState(false);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schemaWarn, setSchemaWarn] = useState<string | null>(null);

  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [originalTeamId, setOriginalTeamId] = useState<string>(''); // 既存所属
  const [selectedTeamId, setSelectedTeamId] = useState<string>(''); // 画面選択

  // ★表示制御カラムが存在するか（無い場合はUIも保存もスキップ）
  const [visibilityColsOk, setVisibilityColsOk] = useState<boolean>(true);

  const [formData, setFormData] = useState({
    full_name: '',
    handle_name: '',
    email: '',
    phone: '',
    address: '未選択',
    admin_note: '',
    avatar_url: '',

    // ★管理者用: 表示/非表示
    is_active_ui: true, // UI上「表示する」= true
    is_deleted_ui: false, // UI上「削除扱い」= true
  });

  // 認証 & 管理者判定（players_private.is_admin は player_id で引く）
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data.user?.id ?? null;
        if (cancelled) return;

        setAuthUserId(uid);

        if (!uid) {
          setIsAdmin(false);
          return;
        }

        const { data: priv, error: privErr } = await supabase
          .from('players_private')
          .select('is_admin')
          .eq('player_id', uid)
          .maybeSingle();

        if (cancelled) return;
        setIsAdmin(!privErr && !!(priv as any)?.is_admin);
      } catch {
        if (!cancelled) setIsAdmin(false);
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const fetchPlayer = useCallback(async () => {
    // ★authChecked が終わってから取得（“一瞬not found”を防ぐ）
    if (!authChecked) return;

    try {
      setLoading(true);
      setError(null);
      setSchemaWarn(null);
      setVisibilityColsOk(true);

      if (!playerId) throw new Error('Invalid player id');
      if (!authUserId) throw new Error('ログインが必要です');
      if (!isAdmin && authUserId !== playerId) throw new Error('Unauthorized');

      // ✅ players（公開）: まずは安全な基本列だけ
      const { data: pBase, error: pErr } = await supabase
        .from('players')
        .select('id, handle_name, avatar_url, address')
        .eq('id', playerId)
        .maybeSingle();

      if (pErr) throw pErr;
      if (!pBase) throw new Error('Player not found');

      // ★表示制御列は「ある前提で読みに行き、無ければ警告してスキップ」
      let pVis: { is_active?: boolean | null; is_deleted?: boolean | null } | null = null;
      try {
        const { data: v, error: vErr } = await supabase
          .from('players')
          .select('is_active, is_deleted')
          .eq('id', playerId)
          .maybeSingle();
        if (vErr) throw vErr;
        pVis = (v ?? null) as any;
      } catch {
        setVisibilityColsOk(false);
        setSchemaWarn('players に is_active / is_deleted カラムが無い可能性があります（DBに追加してください）');
      }

      // ✅ players_private（非公開）: player_id で引く
      const { data: privBase, error: privBaseErr } = await supabase
        .from('players_private')
        .select('full_name, phone, email')
        .eq('player_id', playerId)
        .maybeSingle();

      // admin_note は DB に無い可能性があるので分けて try
      let privOpt: PrivateOptRow | null = null;
      try {
        const { data: o, error: oErr } = await supabase
          .from('players_private')
          .select('admin_note')
          .eq('player_id', playerId)
          .maybeSingle();
        if (!oErr && o) privOpt = o as any;
        if (oErr) setSchemaWarn((prev) => prev ?? 'players_private に admin_note が無い可能性があります（SQLで追加してください）');
      } catch {
        setSchemaWarn((prev) => prev ?? 'players_private に admin_note が無い可能性があります（SQLで追加してください）');
      }

      // 所属チーム（1人1チーム想定）
      let currentTeamId = '';
      try {
        const { data: tm, error: tmErr } = await supabase
          .from('team_members')
          .select('team_id')
          .eq('player_id', playerId)
          .maybeSingle<TeamMemberRow>();
        if (!tmErr && tm?.team_id) currentTeamId = String(tm.team_id);
      } catch {
        currentTeamId = '';
      }

      // チーム一覧
      try {
        const { data: t, error: tErr } = await supabase.from('teams').select('id, name').order('name', { ascending: true });
        if (!tErr && t) setTeams(t as any);
        else setTeams([]);
      } catch {
        setTeams([]);
      }

      setPlayer(pBase as any);

      const base = (!privBaseErr && privBase ? ((privBase as any) as PrivateBaseRow) : null);

      const addr = ((pBase as any).address ?? '') as string;
      const addressVal = addr && String(addr).trim() ? String(addr) : '未選択';

      // ★is_active: false のときだけ非表示なので、UIは “表示する” = true/false にする
      const uiActive = pVis?.is_active !== false; // null/true => 表示
      const uiDeleted = pVis?.is_deleted === true;

      setFormData({
        full_name: (base?.full_name ?? '') || '',
        handle_name: (pBase as any).handle_name ?? '',
        email: (base?.email ?? '') || '',
        phone: (base?.phone ?? '') || '',
        address: addressVal,
        admin_note: (privOpt?.admin_note ?? '') || '',
        avatar_url: (pBase as any).avatar_url ?? '',

        is_active_ui: uiActive,
        is_deleted_ui: uiDeleted,
      });

      setOriginalTeamId(currentTeamId);
      setSelectedTeamId(currentTeamId || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setPlayer(null);
    } finally {
      setLoading(false);
    }
  }, [supabase, playerId, authChecked, authUserId, isAdmin]);

  useEffect(() => {
    fetchPlayer();
  }, [fetchPlayer]);

  const selectedTeamName = useMemo(() => {
    const hit = teams.find((t) => t.id === selectedTeamId);
    return hit?.name ?? '';
  }, [teams, selectedTeamId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCheck = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;

    setFormData((prev) => {
      // ★削除扱いにしたら、表示チェックもOFFに寄せておく（衝突回避・最小）
      if (name === 'is_deleted_ui' && checked) {
        return { ...prev, is_deleted_ui: true, is_active_ui: false };
      }
      return { ...prev, [name]: checked } as any;
    });
  };

  const saveTeamIfChanged = async () => {
    const nextTeam = selectedTeamId || '';
    const prevTeam = originalTeamId || '';
    if (nextTeam === prevTeam) return;

    if (!playerId) throw new Error('Invalid player id');

    if (!nextTeam && prevTeam) {
      const { error: delErr } = await fromAny('team_members').delete().eq('player_id', playerId).eq('team_id', prevTeam);
      if (delErr) throw delErr;
      setOriginalTeamId('');
      return;
    }

    if (prevTeam) {
      const { error: delErr } = await fromAny('team_members').delete().eq('player_id', playerId).eq('team_id', prevTeam);
      if (delErr) throw delErr;
    }

    const { error: insErr } = await fromAny('team_members').insert({
      team_id: nextTeam,
      player_id: playerId,
    });

    if (insErr) throw insErr;

    setOriginalTeamId(nextTeam);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (!playerId) throw new Error('Invalid player id');

      if (!formData.handle_name.trim()) throw new Error('Handle Name は必須です');
      if (!formData.phone.trim()) throw new Error('電話番号は必須です');

      if (!authUserId) throw new Error('ログインが必要です');
      if (!isAdmin && authUserId !== playerId) throw new Error('Unauthorized');

      // ✅ players 更新（handle_name / avatar_url / address）
      const playerPayload = {
        handle_name: formData.handle_name.trim(),
        avatar_url: formData.avatar_url || null,
        address: formData.address || null,
        // ...この下も同様に元のまま（必要ならここに追記）
      };

      const { error: upPlayerErr } = await fromAny('players').update(playerPayload).eq('id', playerId);
      if (upPlayerErr) throw upPlayerErr;

      // ★管理者のみ：表示/非表示を保存（列が無ければスキップ）
      if (isAdmin && visibilityColsOk) {
        try {
          const visPayload = {
            // “表示する”チェック = true/false を is_active に反映
            is_active: formData.is_active_ui,
            is_deleted: formData.is_deleted_ui,
          };

          const { error: visErr } = await fromAny('players').update(visPayload).eq('id', playerId);

          if (visErr) {
            setSchemaWarn('is_active / is_deleted の保存に失敗しました。DBカラムやRLSを確認してください。');
          }
        } catch {
          setSchemaWarn('is_active / is_deleted の保存に失敗しました。DBカラムやRLSを確認してください。');
        }
      }

      // players_private 更新
      const basePayload = {
        player_id: playerId,
        full_name: formData.full_name || null,
        phone: formData.phone.trim(),
        email: formData.email || null,
        updated_at: new Date().toISOString(),
      };

      const { error: upPrivBaseErr } = await fromAny('players_private').upsert(basePayload, { onConflict: 'player_id' });
      if (upPrivBaseErr) throw upPrivBaseErr;

      // admin_note は try
      try {
        const optPayload = {
          player_id: playerId,
          admin_note: formData.admin_note || null,
          updated_at: new Date().toISOString(),
        };
        const { error: upPrivOptErr } = await fromAny('players_private').upsert(optPayload, { onConflict: 'player_id' });
        if (upPrivOptErr) {
          setSchemaWarn('admin_note の保存に失敗しました。DBにカラムがあるか確認してください。');
        }
      } catch {
        setSchemaWarn('admin_note の保存に失敗しました。DBにカラムがあるか確認してください。');
      }

      await saveTeamIfChanged();

      router.push(`/players/${playerId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update player');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !authChecked) {
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
        <button onClick={() => router.back()} className="mt-4 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">
          Go Back
        </button>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p>Player not found</p>
        <button onClick={() => router.back()} className="mt-4 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Edit Player</h1>

        {schemaWarn && (
          <div className="mb-4 bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">{schemaWarn}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* ★管理者用：表示/非表示 */}
          {isAdmin && visibilityColsOk && (
            <div className="p-4 rounded-md border border-gray-200 bg-gray-50">
              <div className="font-semibold text-gray-800 mb-2">表示設定（管理者のみ）</div>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" name="is_active_ui" checked={!!formData.is_active_ui} onChange={handleCheck} />
                表示する（OFFで非表示）
              </label>

              <label className="flex items-center gap-2 text-sm text-gray-700 mt-2">
                <input type="checkbox" name="is_deleted_ui" checked={!!formData.is_deleted_ui} onChange={handleCheck} />
                削除扱い（一覧・ランキングから除外）
              </label>

              <div className="text-xs text-gray-500 mt-2">※ 削除扱いが優先されます（削除扱いONの場合、表示チェックはOFFになります）</div>
            </div>
          )}

          {/* Full Name */}
          <div>
            <label htmlFor="full_name" className="block text-sm font-medium text-gray-700 mb-2">
              Full Name（任意）
            </label>
            <input
              type="text"
              id="full_name"
              name="full_name"
              value={formData.full_name}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black placeholder:text-gray-500"
              placeholder="例）山田 太郎"
            />
          </div>

          {/* Handle Name */}
          <div>
            <label htmlFor="handle_name" className="block text-sm font-medium text-gray-700 mb-2">
              Handle Name（必須）
            </label>
            <input
              type="text"
              id="handle_name"
              name="handle_name"
              value={formData.handle_name}
              onChange={handleChange}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black placeholder:text-gray-500"
            />
          </div>

          {/* Email */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email（任意）
            </label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black placeholder:text-gray-500"
              placeholder="example@example.com"
            />
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
              Phone（必須）
            </label>
            <input
              type="tel"
              id="phone"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black placeholder:text-gray-500"
              placeholder="090-1234-5678"
            />
          </div>

          {/* Address */}
          <div>
            <label htmlFor="address" className="block text-sm font-medium text-gray-700 mb-2">
              Address（登録時と同じプルダウン）
            </label>
            <select
              id="address"
              name="address"
              value={formData.address || '未選択'}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
            >
              {ADDRESS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          {/* 登録チーム */}
          <div>
            <label htmlFor="team" className="block text-sm font-medium text-gray-700 mb-2">
              登録チーム
            </label>

            {originalTeamId ? (
              <p className="text-sm text-gray-600 mb-2">
                現在：<b>{teams.find((t) => t.id === originalTeamId)?.name ?? originalTeamId}</b>
              </p>
            ) : null}

            <select
              id="team"
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
            >
              <option value="">未所属（選択してください）</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            {selectedTeamId && selectedTeamName ? (
              <p className="text-xs text-gray-500 mt-1">選択中：{selectedTeamName}</p>
            ) : (
              <p className="text-xs text-gray-500 mt-1">所属していない場合はプルダウンから選択できます。</p>
            )}
          </div>

          {/* 備考 */}
          <div>
            <label htmlFor="admin_note" className="block text-sm font-medium text-gray-700 mb-2">
              備考（管理者メモ）
            </label>
            <textarea
              id="admin_note"
              name="admin_note"
              value={formData.admin_note}
              onChange={handleChange}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black placeholder:text-gray-500"
              placeholder="例）入会経緯、注意事項、ハンディ調整理由など"
            />
          </div>

          {/* Avatar */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Avatar</label>
            {authUserId ? (
              <AvatarUploader
                userId={authUserId}
                initialUrl={formData.avatar_url || null}
                onSelected={(publicUrl) => setFormData((prev) => ({ ...prev, avatar_url: publicUrl }))}
                showGallery={true}
                galleryBucket="avatars"
                galleryPrefix="preset"
                galleryLimit={100}
              />
            ) : (
              <input
                type="url"
                name="avatar_url"
                value={formData.avatar_url}
                onChange={handleChange}
                placeholder="https://..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black placeholder:text-gray-500"
              />
            )}
          </div>

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
