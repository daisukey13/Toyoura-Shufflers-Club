'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type T = { id: string; name: string; start_date: string|null; mode: string; size: number };

export default function AdminTournamentsTop() {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/tournaments', { cache: 'no-store' });
    const json = await res.json();
    setItems(json.items ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const createOne = async () => {
    const res = await fetch('/api/tournaments', { method: 'POST' });
    const json = await res.json();
    if (!res.ok) { alert(json.error ?? '作成失敗'); return; }
    location.href = `/admin/tournaments/${json.item.id}`;
  };

  return (
    <div className="p-4 text-white">
      <h1 className="text-xl font-bold mb-4">大会管理</h1>
      <button onClick={createOne} className="px-3 py-2 rounded bg-emerald-600 text-white">新規作成</button>
      {loading ? <div className="mt-4">Loading…</div> : (
        <ul className="mt-4 space-y-2">
          {items.map(t => (
            <li key={t.id} className="border rounded p-2">
              <Link href={`/admin/tournaments/${t.id}`} className="underline">{t.name}</Link>
              <div className="text-xs text-gray-300">{t.start_date} / {t.mode} / {t.size}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
