'use client';
import { useEffect, useState } from 'react';

export function usePlayerOptions() {
  const [items, setItems] = useState<{id:string; handle_name:string; avatar_url?:string|null}[]>([]);
  useEffect(()=> {
    (async () => {
      const res = await fetch('/api/players/options', { cache: 'no-store' });
      const json = await res.json();
      setItems(json.items ?? []);
    })();
  }, []);
  return items;
}

export function useTeamOptions() {
  const [items, setItems] = useState<{id:string; name:string}[]>([]);
  useEffect(()=> {
    (async () => {
      const res = await fetch('/api/teams/options', { cache: 'no-store' });
      const json = await res.json();
      setItems(json.items ?? []);
    })();
  }, []);
  return items;
}
