// lib/utils/playerVisibility.ts
export function isHiddenPlayer(p: { id?: string | null; handle_name?: string | null }) {
  const hn = (p.handle_name ?? '').trim().toLowerCase();
  const id = (p.id ?? '').trim().toLowerCase();
  // id は uuid のはずだけど、念のため両方見ておく
  return hn === 'def' || id === 'def';
}
