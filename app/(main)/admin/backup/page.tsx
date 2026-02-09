// app/(main)/admin/backup/page.tsx
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FaArrowLeft, FaDatabase, FaDownload, FaUpload, FaExclamationTriangle } from 'react-icons/fa';
import { createClient } from '@/lib/supabase/client';

export default function AdminBackupPage() {
  const router = useRouter();
  const [busy, setBusy] = useState<'none' | 'downloading' | 'restoring'>('none');
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string>('');
  const [err, setErr] = useState<string>('');

  const fileInfo = useMemo(() => {
    if (!file) return 'なし';
    const mb = (file.size / (1024 * 1024)).toFixed(2);
    return `${file.name} (${mb} MB)`;
  }, [file]);

  // ✅ 追加：ファイル名生成
  const makeFilename = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    return `backup-${y}${m}${day}-${hh}${mm}.json`;
  };

  // ✅ 変更：Bearer 付きでバックアップを fetch してダウンロードする
  const downloadBackup = async () => {
    setErr('');
    setMsg('');
    setBusy('downloading');

    try {
      const supabase = createClient();
      const { data: ses } = await supabase.auth.getSession();
      const token = ses.session?.access_token || '';

      if (!token) {
        throw new Error('ログインセッションが取得できません。いったんログインし直してください。');
      }

      const res = await fetch('/api/admin/backup', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
      });

      if (!res.ok) {
        const out = (await res.json().catch(() => null)) as any;
        const m = out?.message ? String(out.message) : `backup failed: ${res.status} ${res.statusText}`;
        throw new Error(m);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = makeFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);

      setMsg('✅ バックアップをダウンロードしました（ブラウザのダウンロードをご確認ください）。');
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy('none');
    }
  };

  const restoreBackup = async () => {
    setErr('');
    setMsg('');

    if (!file) {
      setErr('復元するJSONファイルを選択してください。');
      return;
    }

    setBusy('restoring');

    try {
      const text = await file.text();
      const json = JSON.parse(text);

      // ✅ Bearer を付ける（Cookieにセッションが無い構成でも restore が通る）
      const supabase = createClient();
      const { data: ses } = await supabase.auth.getSession();
      const token = ses.session?.access_token || '';

      if (!token) {
        throw new Error('ログインセッションが取得できません。いったんログインし直してください。');
      }

      const res = await fetch('/api/admin/restore', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify(json),
      });

      const out = (await res.json().catch(() => null)) as any;

      if (!res.ok) {
        const m = out?.message ? String(out.message) : `restore failed: ${res.status} ${res.statusText}`;
        throw new Error(m);
      }

      if (!out?.ok) {
        setErr(out?.message || '復元に失敗しました。');
      } else {
        const inserted = out?.inserted && typeof out.inserted === 'object' ? out.inserted : null;
        const sum = inserted ? Object.values(inserted).reduce((a: number, b: any) => a + (Number(b) || 0), 0) : null;

        setMsg(
          sum != null
            ? `✅ 復元が完了しました（投入 ${sum} 行）。ページを更新して反映をご確認ください。`
            : '✅ 復元が完了しました。ページを更新して反映をご確認ください。'
        );
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy('none');
    }
  };

  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => router.push('/admin/dashboard')}
            className="text-sm text-purple-300 hover:text-purple-200 inline-flex items-center gap-2"
          >
            <FaArrowLeft />
            ダッシュボードへ戻る
          </button>

          <Link href="/" className="text-sm text-gray-300 hover:text-gray-200">
            公開トップへ
          </Link>
        </div>

        <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-3 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full">
              <FaDatabase className="text-xl" />
            </div>
            <h1 className="text-2xl font-bold">バックアップ / 復元</h1>
          </div>

          <p className="text-sm text-gray-300 mb-5">
            ボタン1つでバックアップJSONをダウンロード（通常はDownloads）できます。復元はJSONを選択して実行します。<br />
            <span className="text-yellow-200/90">※ 復元は「管理者1人だけ」の状態で実行してください（事故防止）</span>
          </p>

          {msg && (
            <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-200">
              {msg}
            </div>
          )}
          {err && (
            <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-900/25 px-4 py-3 text-sm text-rose-200">
              <div className="flex items-start gap-2">
                <FaExclamationTriangle className="mt-0.5 shrink-0" />
                <div className="min-w-0">{err}</div>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-purple-500/20 bg-gray-800/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-yellow-100">バックアップを作成</div>
                <div className="text-xs text-gray-400 mt-1">players / teams / tournaments / matches / finals をまとめて取得</div>
              </div>
              <button
                onClick={downloadBackup}
                disabled={busy !== 'none'}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 transition-colors text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
              >
                <FaDownload />
                バックアップ
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-purple-500/20 bg-gray-800/40 p-4">
            <div className="font-semibold text-yellow-100 mb-2">バックアップから復元</div>

            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <input
                type="file"
                accept="application/json,.json"
                className="block w-full text-sm text-gray-200 file:mr-4 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-gray-900/60 file:text-gray-100 hover:file:bg-gray-900"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={busy !== 'none'}
              />

              <button
                onClick={restoreBackup}
                disabled={busy !== 'none'}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 transition-colors text-white text-sm font-semibold inline-flex items-center gap-2 justify-center disabled:opacity-50"
              >
                <FaUpload />
                復元
              </button>
            </div>

            <div className="mt-2 text-xs text-gray-300">
              選択中: <span className="text-gray-100">{fileInfo}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
