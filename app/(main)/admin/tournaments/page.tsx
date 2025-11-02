'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type T = {
  id: string;
  name: string;
  start_date: string | null;
  mode: 'singles' | 'teams';
  size: 4 | 8 | 16 | 32;
  best_of: 1 | 3;
  point_cap: number;
  apply_handicap: boolean;
};

export default function AdminTournamentsPage() {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch('/api/tournaments', { cache: 'no-store' });
      const json = await res.json();
      setItems(json.items ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="p-6 space-y-4 text-white">
      <h1 className="text-xl font-bold">大会 管理</h1>
      {loading ? <div>Loading…</div> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {items.map(t => (
          <Link
            key={t.id}
            href={`/admin/tournaments/${t.id}`}
            className="block rounded-lg border border-white/10 bg-white/5 p-4 hover:bg-white/10"
          >
            <div className="text-lg font-semibold">{t.name}</div>
            <div className="text-sm opacity-80">
              {t.start_date ?? '—'} / {t.mode} / {t.size}枠 / BO{t.best_of} / 先取{t.point_cap}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
