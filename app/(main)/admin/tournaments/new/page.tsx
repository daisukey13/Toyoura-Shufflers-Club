'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();
// ✅ Supabase型推論が never に崩れて next build が落ちる環境向けの最小回避（このファイル内だけ any 経由）
const db: any = supabase;

export default function AdminTournamentNewPage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); // yyyy-mm-dd
  const [description, setDescription] = useState('');
  const [bonus, setBonus] = useState('1.0'); // ランキング係数
  const [mode, setMode] = useState<'singles' | 'teams'>('singles');
  const [applyHC, setApplyHC] = useState(true);
  const [size, setSize] = useState('4'); // 参加人数（NOT NULL）

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('大会名を入力してください');
      return;
    }

    const sizeNum = Number(size);
    if (!Number.isInteger(sizeNum) || sizeNum <= 0) {
      setError('参加人数は1以上の整数で入力してください');
      return;
    }

    setSaving(true);
    setError(null);

    const bonusNum = Number(bonus);
    const bonusValue = Number.isFinite(bonusNum) && bonusNum > 0 ? bonusNum : 1.0;

    try {
      const { data, error: insertErr } = await db
        .from('tournaments')
        .insert({
          name: name.trim(),
          tournament_date: date,
          start_date: date,
          end_date: date,
          description: description || null,
          bonus_coefficient: bonusValue,
          mode,
          is_active: true,
          is_bracket: false, // とりあえずリーグ中心。決勝トーナメントはあとで
          is_archived: false,
          apply_handicap: applyHC,
          size: sizeNum, // NOT NULL: 参加人数
          best_of: 3, // NOT NULL: 基本は best of 3
          point_cap: 15, // NOT NULL: 得点上限（これまでの仕様に合わせて 15）
          time_limit_minutes: 0, // NOT NULL: 制限時間なし扱いで 0
          // bracket_size はリーグ中心大会なので設定しない（NULL のまま）
        })
        .select('id')
        .single();

      if (insertErr) {
        console.error(insertErr);
        setError(`大会の作成に失敗しました: ${insertErr.message ?? ''}`.trim());
        setSaving(false);
        return;
      }

      const newId = String(data?.id ?? '');
      if (!newId) {
        setError('大会IDの取得に失敗しました');
        setSaving(false);
        return;
      }

      // 作成した直後に、この大会のリーグ管理ページへ
      router.push(`/admin/tournaments/${newId}/league`);
    } catch (err) {
      console.error(err);
      setError('大会の作成に失敗しました');
      setSaving(false);
    }
  };

  return (
    <div className="p-4 max-w-xl mx-auto space-y-4">
      <h1 className="text-xl font-bold">大会の新規登録</h1>

      {error && <div className="text-sm text-red-500">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-semibold">大会名</label>
          <input
            type="text"
            className="w-full rounded border border-gray-600 bg-black/40 px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例）2025 テストリーグ大会"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-semibold">開催日</label>
          <input
            type="date"
            className="w-full rounded border border-gray-600 bg-black/40 px-3 py-2 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-semibold">形式</label>
          <select
            className="w-full rounded border border-gray-600 bg-black/40 px-3 py-2 text-sm"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'singles' | 'teams')}
          >
            <option value="singles">シングルス</option>
            <option value="teams">チーム戦</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-semibold">参加人数（目安）</label>
          <input
            type="number"
            min="1"
            className="w-full rounded border border-gray-600 bg-black/40 px-3 py-2 text-sm"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            placeholder="例）12"
          />
          <p className="text-xs text-gray-400">
            大会に参加するプレーヤー数の目安です。後から多少前後しても構いません。
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-semibold">ランキング係数（大会の重み）</label>
          <input
            type="number"
            step="0.1"
            min="0.1"
            className="w-full rounded border border-gray-600 bg-black/40 px-3 py-2 text-sm"
            value={bonus}
            onChange={(e) => setBonus(e.target.value)}
          />
          <p className="text-xs text-gray-400">
            通常は 1.0。重要な大会は 1.5 や 2.0 など大きめにすると、ランキングへの影響が増えます。
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-semibold">大会説明（任意）</label>
          <textarea
            className="w-full rounded border border-gray-600 bg-black/40 px-3 py-2 text-sm"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={applyHC} onChange={(e) => setApplyHC(e.target.checked)} />
          ハンディキャップを適用する
        </label>

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? '保存中…' : '大会を作成する'}
          </button>
        </div>
      </form>
    </div>
  );
}
