// components/MatchRowMobileSafe.tsx
"use client";
import { FaTrophy } from "react-icons/fa";

type Side = {
  name: string;
  score: number;
  avatarUrl?: string | null;
  rpDelta?: number | null;
  hc?: number | null;
  winner?: boolean; // 任意。省略時は score 比較で判定
};

export default function MatchRowMobileSafe({
  a,
  b,
  mode,
  at, // ISO string or date-like
}: {
  a: Side;
  b: Side;
  mode: "singles" | "teams" | string;
  at: string | Date;
}) {
  const atStr =
    typeof at === "string"
      ? new Date(at).toLocaleString()
      : new Date(at).toLocaleString();

  const aWin = typeof a.winner === "boolean" ? a.winner : a.score > b.score;
  const bWin = typeof b.winner === "boolean" ? b.winner : b.score > a.score;

  return (
    <div className="rounded-2xl border border-purple-500/30 bg-gray-900/50 p-3 sm:p-4">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
        <span className="rounded-md px-2 py-0.5 bg-purple-600/30">{mode}</span>
        <time className="truncate">{atStr}</time>
      </div>

      {/* モバイルは縦並び、sm以上で横並び */}
      <div className="flex flex-col sm:flex-row items-stretch gap-3">
        <Participant side={a} win={aWin} />
        <div className="self-center shrink-0 px-3 py-2 rounded-full bg-orange-500 text-white font-bold select-none">
          VS
        </div>
        <Participant side={b} win={bWin} />
      </div>
    </div>
  );
}

function Participant({ side, win }: { side: Side; win: boolean }) {
  return (
    <div
      className={[
        "flex items-center gap-3 flex-1 min-w-0 rounded-xl border p-3",
        win
          ? "border-emerald-500/40 bg-emerald-500/10"
          : "border-gray-600/40 bg-gray-800/30",
      ].join(" ")}
    >
      {/* 画像 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={side.avatarUrl || "/default-avatar.png"}
        alt=""
        className="w-9 h-9 rounded-full object-cover shrink-0"
      />

      {/* テキストは min-w-0 を付与してはみ出しを抑制 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate text-yellow-100 font-semibold">
            {side.name}
          </div>
          {win && <FaTrophy className="text-emerald-400 shrink-0" />}
        </div>
        <div className="text-xs text-gray-400">
          RP: {side.rpDelta ?? 0} / HC: {side.hc ?? 0}
        </div>
      </div>

      <div
        className={`text-2xl font-bold shrink-0 ${win ? "text-white" : "text-gray-300"}`}
      >
        {side.score}
      </div>
    </div>
  );
}
