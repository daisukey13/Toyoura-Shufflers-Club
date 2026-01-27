'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function ResetFinalsButton({ tournamentId }: { tournamentId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const onClick = async () => {
    const ok = window.confirm(
      '決勝トーナメントを丸ごと削除します。\n同じ大会IDで作り直せるようになります。\n\n本当に実行しますか？',
    );
    if (!ok) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/tournaments/${tournamentId}/finals/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        alert(json?.message ?? 'リセットに失敗しました。');
        return;
      }

      alert('決勝トーナメントを削除しました。続けて「作成」操作を実行してください。');
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="glass-button px-3 py-2 rounded-lg text-sm border border-red-400/40 text-red-100 hover:bg-red-500/10 disabled:opacity-60"
    >
      {loading ? '削除中…' : '決勝トーナメントを削除して作り直す'}
    </button>
  );
}
