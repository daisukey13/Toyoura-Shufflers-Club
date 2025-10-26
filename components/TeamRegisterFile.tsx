// components/TeamRegisterFile.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FaSave, FaSpinner, FaUsers } from "react-icons/fa";

type TeamLite = { id: string; name: string };

const supabase = createClient();

export default function TeamRegisterFile() {
  const [teams, setTeams] = useState<TeamLite[]>([]);
  const [loading, setLoading] = useState(true);

  const [winnerId, setWinnerId] = useState("");
  const [loserId, setLoserId] = useState("");
  const [loserScore, setLoserScore] = useState<number>(0);
  const [venue, setVenue] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [date, setDate] = useState<string>(() => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10); // YYYY-MM-DD
  });

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("teams")
          .select("id, name")
          .order("name", { ascending: true });
        if (error) throw error;
        setTeams((data ?? []) as TeamLite[]);
      } catch (e: any) {
        console.warn("[TeamRegisterFile] load teams error:", e?.message || e);
        setTeams([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const canSubmit = useMemo(
    () =>
      !busy &&
      !!winnerId &&
      !!loserId &&
      winnerId !== loserId &&
      Number.isFinite(loserScore) &&
      loserScore >= 0 &&
      loserScore <= 14 &&
      /^\d{4}-\d{2}-\d{2}$/.test(date),
    [busy, winnerId, loserId, loserScore, date],
  );

  const onSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/matches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "teams",
          match_date: date,
          winner_team_id: winnerId,
          loser_team_id: loserId,
          winner_score: 15,
          loser_score: loserScore,
          venue: venue || null,
          notes: notes || null,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);

      setMsg("チーム戦を登録しました。");
      setLoserScore(0);
      setVenue("");
      setNotes("");
    } catch (e: any) {
      setMsg(e?.message || "登録に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-card rounded-xl p-5 border border-purple-500/30 bg-gray-900/50">
      <h3 className="text-lg font-semibold text-purple-200 mb-3 flex items-center gap-2">
        <FaUsers /> チーム試合登録
      </h3>

      {loading ? (
        <div className="text-gray-400">
          <FaSpinner className="inline animate-spin mr-2" />
          読み込み中…
        </div>
      ) : teams.length === 0 ? (
        <div className="text-sm text-gray-400">
          チームが見つかりません。先にチームを作成してください。
        </div>
      ) : (
        <div className="space-y-3">
          {/* 日付 */}
          <div>
            <label className="block text-sm text-gray-300 mb-1">試合日</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 outline-none"
            />
          </div>

          {/* 勝者 / 敗者 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-300 mb-1">
                勝利チーム
              </label>
              <select
                value={winnerId}
                onChange={(e) => setWinnerId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30"
              >
                <option value="">選択してください</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1">
                敗北チーム
              </label>
              <select
                value={loserId}
                onChange={(e) => setLoserId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30"
              >
                <option value="">選択してください</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* スコア・会場・メモ */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-gray-300 mb-1">
                敗者の得点 (0–14)
              </label>
              <input
                type="number"
                min={0}
                max={14}
                value={loserScore}
                onChange={(e) =>
                  setLoserScore(
                    Math.max(
                      0,
                      Math.min(14, parseInt(e.target.value || "0", 10)),
                    ),
                  )
                }
                className="w-full px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 outline-none"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm text-gray-300 mb-1">
                会場（任意）
              </label>
              <input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="例: 体育館A"
                className="w-full px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">
              メモ（任意）
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 outline-none"
            />
          </div>

          {/* 送信 */}
          <div className="pt-2 text-right">
            <button
              onClick={onSubmit}
              disabled={!canSubmit}
              className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 inline-flex items-center gap-2 disabled:opacity-60"
            >
              {busy ? <FaSpinner className="animate-spin" /> : <FaSave />} 登録
            </button>
          </div>

          {msg && <p className="text-sm text-gray-300">{msg}</p>}
        </div>
      )}
    </div>
  );
}
