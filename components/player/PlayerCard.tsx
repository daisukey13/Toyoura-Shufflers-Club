// components/player/PlayerCard.tsx
import React from 'react';
import { Player } from '@/types/player';
import { FaTrophy, FaGamepad, FaMapMarkerAlt } from 'react-icons/fa';

interface PlayerCardProps {
  player: Player;
  rank: number;
}

export const PlayerCard: React.FC<PlayerCardProps> = ({ player, rank }) => {
  // ランク順位に応じた色を決定
  const getRankColor = (rank: number) => {
    if (rank === 1) return 'text-yellow-500';
    if (rank === 2) return 'text-gray-400';
    if (rank === 3) return 'text-orange-600';
    return 'text-gray-600';
  };

  const getRankBgColor = (rank: number) => {
    if (rank === 1) return 'bg-yellow-50 border-yellow-200';
    if (rank === 2) return 'bg-gray-50 border-gray-200';
    if (rank === 3) return 'bg-orange-50 border-orange-200';
    return 'bg-white border-gray-200';
  };

  // 住所から市区町村を抽出（プライバシー保護）
  const getDisplayAddress = (address?: string) => {
    if (!address) return '未登録';
    // 簡易的な処理：実際にはより詳細な処理が必要
    const parts = address.split(/[市区町村]/);
    if (parts.length > 0) {
      const match = address.match(/(.+?[市区町村])/);
      return match ? match[1] : address.substring(0, 10) + '...';
    }
    return address.substring(0, 10) + '...';
  };

  return (
    <div className={`rounded-lg border-2 p-6 transition-all hover:shadow-lg ${getRankBgColor(rank)}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-4">
          {/* アバター */}
          <div className="relative">
            <img
              src={player.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(player.handle_name)}&background=random`}
              alt={player.handle_name}
              className="w-16 h-16 rounded-full object-cover border-2 border-white shadow-md"
            />
            {/* ランクバッジ */}
            {rank <= 3 && (
              <div className={`absolute -top-2 -right-2 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center ${getRankColor(rank)}`}>
                <FaTrophy className="w-4 h-4" />
              </div>
            )}
          </div>
          
          {/* プレイヤー情報 */}
          <div>
            <h3 className="text-xl font-bold text-gray-800">{player.handle_name}</h3>
            <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
              <FaMapMarkerAlt className="w-3 h-3" />
              <span>{getDisplayAddress(player.address)}</span>
            </div>
          </div>
        </div>
        
        {/* 順位表示 */}
        <div className={`text-3xl font-bold ${getRankColor(rank)}`}>
          #{rank}
        </div>
      </div>
      
      {/* スタッツ */}
      <div className="grid grid-cols-3 gap-4 mt-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-800">{player.ranking_points || 1000}</div>
          <div className="text-xs text-gray-600">ポイント</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-600">{player.handicap || 30}</div>
          <div className="text-xs text-gray-600">ハンディキャップ</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-600">{player.matches_played || 0}</div>
          <div className="text-xs text-gray-600">試合数</div>
        </div>
      </div>
      
      {/* 試合参加状況 */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <FaGamepad className="text-gray-400" />
            <span className="text-gray-600">勝敗</span>
          </div>
          <span className="text-gray-800 font-medium">
            {player.wins || 0}勝 {player.losses || 0}敗
          </span>
        </div>
      </div>
    </div>
  );
};