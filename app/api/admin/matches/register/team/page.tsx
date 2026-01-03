// app/(main)/admin/matches/register/team/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FaTrophy, FaSpinner, FaCheckCircle, FaExclamationTriangle } from "react-icons/fa";

type TeamLite = { id: string; name: string };

const supabase = createClient();
const cls = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(" ");

export default function AdminTeamMatchRegisterPage() {
  const router = useRouter();

  const [booting, setBooting] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [teams, setTeams] = useState<TeamLite[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(true);

  const [winnerTeamId, setWinnerTeamId] = useState("");
  const [loserTeamId, setLoserTeamId] = useState("");
  const [winnerScore, setWinnerScore] = useState<number>(11);
  const [loserScore, setLoserScore] = useState<number>(0);

  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const canSubmit =
    isAdmin &&
    !saving &&
    winnerTeamId &&
    loserTeamId &&
    winnerTeamId !== loserTeamId &&
    Number.isFinite(winnerScore) &&
    Number.isFinite(loserScore);

  // 管理者判定
  useEffect(() => {
    (async () => {
      setBooting(true);
      setNote(null);
      setSavedMsg(null);

      const { data: ures } = await supabase.auth.getUser();
      const user = ures.user;
      if (!user) {
        router.replace("/login?redirect=/admin/matches/register/team");
        return;
      }

      const { data: p, error } = await supabase
        .from("players")
        .select("is_admin")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        setIsAdmin(false);
        setNote(error.message);
        setBooting(false);
        return;
      }

      const ok = Boolean((p as any)?.is_admin);
      setIsAdmin(ok);
      setNote(ok ? null : "管理者のみ利用できます。");
      setBooting(false);
    })();
  }, [router]);

  // チーム一覧
  useEffect(() => {
    if (!isAdmin) return;

    (async () => {
      setLoadingTeams(true);
      try {
        const { data, error } = await supabase
          .from("teams")
          .select("id, name")
          .order("name", { ascending: true })
          .limit(500);

        if (error) throw error;
        setTeams((data || []) as TeamLite[]);
      } catch (e: any) {
        setTeams([]);
        setNote(e?.message || "チーム一覧の取得に失敗しました");
      } finally {
        setLoadingTeams(false);
      }
    })();
  }, [isAdmin]);

  const options = useMemo(() => teams, [teams]);

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setSavedMsg(null);
    setNote(null);

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("セッションがありません。再ログインしてください。");

      const res = await fetch("/api/admin/matches/create-team", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          winner_team_id: winnerTeamId,
          loser_team_id: loserTeamId,
          winner_score: Number(winnerScore),
          loser_score: Number(loserScore),
          match_date: new Date().toISOString(),
        }),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || "登録に失敗しました");

      setSavedMsg(`登録しました（match_id: ${json.match_id}）`);
      setWinnerScore(11);
      setLoserScore(0);
    } catch (e: any) {
      setNote(e?.message || "登録に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (booting) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="glass-card rounded-xl p-8 text-center">
          <FaSpinner className="mx-auto mb-3 animate-spin text-purple-400" />
          <p className="text-gray-300">読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 sm:py-8">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-yellow-100 flex items-center gap-3">
          <FaTrophy /> 管理者: チーム戦を記録
        </h1>
        <p className="text-gray-400 mt-1">勝者チーム・敗者チームを選んでスコアを登録します。</p>

        <div className="mt-3 flex gap-2 flex-wrap">
          <Link href="/admin/dashboard" className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm">
            管理者ダッシュボードへ
          </Link>
          <Link href="/admin/matches/register" className="px-3 py-2 rounded-lg bg-purple-700/40 hover:bg-purple-700/60 text-sm">
            個人戦（管理者登録）
          </Link>
        </div>
      </div>

      {!isAdmin ? (
        <div className="glass-card rounded-xl p-6 border border-purple-500/30 bg-gray-900/50">
          <div className="text-yellow-300 flex items-center gap-2">
            <FaExclamationTriangle /> {note || "管理者のみ利用できます。"}
          </div>
        </div>
      ) : (
        <div className="glass-card rounded-xl p-6 border border-purple-500/30 bg-gray-900/50">
          {loadingTeams ? (
            <div className="p-6 text-center text-gray-400">
              <FaSpinner className="animate-spin inline mr-2" />
              チーム一覧を取得中…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-2">勝者チーム</label>
                  <select
                    value={winnerTeamId}
                    onChange={(e) => {
                      const v = e.target.value;
                      setWinnerTeamId(v);
                      if (v && v === loserTeamId) setLoserTeamId("");
                    }}
                    className="w-full px-4 py-2.5 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 outline-none text-yellow-100"
                  >
                    <option value="">選択してください</option>
                    {options.map((t) => (
                      <option key={t.id} value={t.id} className="bg-gray-900">
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-300 mb-2">敗者チーム</label>
                  <select
                    value={loserTeamId}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLoserTeamId(v);
                      if (v && v === winnerTeamId) setWinnerTeamId("");
                    }}
                    className="w-full px-4 py-2.5 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 outline-none text-yellow-100"
                  >
                    <option value="">選択してください</option>
                    {options.map((t) => (
                      <option key={t.id} value={t.id} className="bg-gray-900">
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-300 mb-2">勝者スコア</label>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={winnerScore}
                    onChange={(e) => setWinnerScore(Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 outline-none text-yellow-100"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-300 mb-2">敗者スコア</label>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={loserScore}
                    onChange={(e) => setLoserScore(Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-lg bg-purple-900/20 border border-purple-500/30 focus:border-purple-400 outline-none text-yellow-100"
                  />
                </div>
              </div>

              <div className="mt-5 flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={submit}
                  className={cls(
                    "px-5 py-2.5 rounded-lg inline-flex items-center gap-2",
                    "bg-green-600 hover:bg-green-700 disabled:opacity-50"
                  )}
                >
                  {saving ? <FaSpinner className="animate-spin" /> : <FaCheckCircle />}
                  記録する
                </button>

                {savedMsg && <div className="text-sm text-green-300">{savedMsg}</div>}
                {note && <div className="text-sm text-yellow-300">{note}</div>}
              </div>

              <div className="mt-4 text-xs text-gray-500">
                ※ この登録は <code>matches(mode=&quot;teams&quot;)</code> と <code>match_teams</code> に保存します。
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
