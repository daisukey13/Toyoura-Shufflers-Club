'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export default function InteractionRecovery() {
  const pathname = usePathname();

  useEffect(() => {
    // クリック不能の保険（念のため）
    document.body.style.pointerEvents = 'auto';
    document.documentElement.style.pointerEvents = 'auto';
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';

    // inert が残っていたら解除（今回は0だけど保険）
    document.querySelectorAll('[inert]').forEach((el) => el.removeAttribute('inert'));

    // ✅ これが本命：ネイティブ dialog の backdrop 残りを潰す
    document.querySelectorAll('dialog[open]').forEach((d) => {
      try {
        (d as HTMLDialogElement).close();
      } catch {}
      d.removeAttribute('open');
    });

    // :modal が使えるブラウザなら念のため
    try {
      const modal = document.querySelector(':modal');
      if (modal && modal.tagName === 'DIALOG') {
        try {
          (modal as HTMLDialogElement).close();
        } catch {}
        modal.removeAttribute('open');
      }
    } catch {}
  }, [pathname]);

  return null;
}
