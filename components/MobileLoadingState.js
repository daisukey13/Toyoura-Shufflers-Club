// components/MobileLoadingState.js

import { FaSync } from 'react-icons/fa';

export function MobileLoadingState({
  loading,
  error,
  retrying,
  onRetry,
  emptyMessage = 'データがありません',
  dataLength = 0
}) {
  if (loading && !retrying) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-purple-400 mb-4"></div>
          <p className="text-gray-300 text-sm">データを読み込んでいます...</p>
        </div>
      </div>
    );
  }

  if (retrying) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-pulse mb-4">
            <FaSync className="text-4xl text-yellow-400" />
          </div>
          <p className="text-gray-300 text-sm">接続を再試行しています...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="text-center max-w-sm mx-auto">
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6">
            <p className="text-red-400 mb-4 text-sm">{error}</p>
            <button
              onClick={onRetry}
              className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-2 mx-auto text-sm font-medium"
            >
              <FaSync className="text-sm" />
              再読み込み
            </button>
          </div>
          <p className="text-gray-400 text-xs mt-4">
            モバイル回線が不安定な場合は、Wi-Fiに接続してお試しください
          </p>
        </div>
      </div>
    );
  }

  if (!loading && dataLength === 0) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  return null;
}