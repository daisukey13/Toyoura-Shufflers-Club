"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function EditNoticePage() {
  const { isAdmin } = useAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [pinned, setPinned] = useState(false);
  const [publishedAt, setPublishedAt] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin || !id) return;
    (async () => {
      const { data, error } = await supabase
        .from("notices")
        .select("title,body,status,pinned,published_at")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) {
        router.push("/admin/notices");
        return;
      }
      setTitle(data.title);
      setBody(data.body);
      setStatus(data.status);
      setPinned(!!data.pinned);
      if (data.published_at) {
        const d = new Date(data.published_at);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        setPublishedAt(d.toISOString().slice(0, 16));
      } else {
        const dn = new Date();
        dn.setMinutes(dn.getMinutes() - dn.getTimezoneOffset());
        setPublishedAt(dn.toISOString().slice(0, 16));
      }
      setLoading(false);
    })();
  }, [isAdmin, id, router]);

  if (!isAdmin)
    return <div className="p-6 text-red-300">権限がありません。</div>;
  if (loading) return <div className="p-6 text-gray-300">読み込み中…</div>;

  const onSave = async () => {
    setSaving(true);
    try {
      const published_at =
        status === "published" ? new Date(publishedAt).toISOString() : null;

      const { error } = await supabase
        .from("notices")
        .update({ title, body, status, pinned, published_at })
        .eq("id", id);
      if (error) throw error;
      alert("更新しました");
      router.push("/admin/notices");
    } catch (e: any) {
      alert(`更新に失敗しました: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!confirm("削除しますか？")) return;
    const { error } = await supabase.from("notices").delete().eq("id", id);
    if (error) {
      alert(`削除に失敗しました: ${error.message}`);
      return;
    }
    alert("削除しました");
    router.push("/admin/notices");
  };

  return (
    <div className="container mx-auto px-4 py-6">
      <h1 className="text-xl font-semibold text-white mb-4">お知らせ編集</h1>
      <div className="space-y-4 max-w-3xl">
        <div>
          <label className="block text-sm text-gray-300 mb-1">タイトル</label>
          <input
            className="w-full rounded border border-purple-500/30 bg-gray-800/50 px-3 py-2 text-white"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">
            本文（Markdown可）
          </label>
          <textarea
            className="w-full rounded border border-purple-500/30 bg-gray-800/50 px-3 py-2 text-white min-h-[220px]"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        <div className="flex gap-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">
              ステータス
            </label>
            <select
              className="rounded border border-purple-500/30 bg-gray-800/50 px-3 py-2 text-white"
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
            >
              <option value="draft">下書き</option>
              <option value="published">公開</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">公開日時</label>
            <input
              type="datetime-local"
              className="rounded border border-purple-500/30 bg-gray-800/50 px-3 py-2 text-white"
              value={publishedAt}
              onChange={(e) => setPublishedAt(e.target.value)}
              disabled={status !== "published"}
            />
          </div>

          <label className="flex items-end gap-2">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
            />
            <span className="text-gray-300">重要（上部固定）</span>
          </label>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onSave}
            disabled={saving || !title || !body}
            className="rounded bg-purple-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {saving ? "保存中…" : "更新"}
          </button>

          <button
            onClick={onDelete}
            className="rounded bg-red-600 px-4 py-2 text-white"
          >
            削除
          </button>

          <button
            onClick={() => router.push("/admin/notices")}
            className="rounded bg-gray-700 px-4 py-2 text-white"
          >
            戻る
          </button>
        </div>
      </div>
    </div>
  );
}
