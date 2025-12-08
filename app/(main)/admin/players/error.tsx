'use client';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white flex items-center justify-center p-6">
      <div className="glass-card rounded-xl p-6 max-w-xl w-full border border-red-500/30 bg-red-500/10">
        <div className="text-lg font-bold text-red-200">/admin/players でエラーが発生しました</div>
        <pre className="mt-3 text-xs whitespace-pre-wrap text-red-100/90">
          {String(error?.message || error)}
        </pre>
        <button
          className="mt-4 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700"
          onClick={() => reset()}
        >
          再試行
        </button>
      </div>
    </div>
  );
}
