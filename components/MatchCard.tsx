// components/MatchCard.tsx

import { FaTrophy, FaUser } from "react-icons/fa";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import Image from "next/image";

interface Player {
  id: string;
  handle_name: string;
  avatar_url: string | null;
  is_deleted: boolean;
}

interface MatchCardProps {
  match: {
    id: string;
    created_at: string;
    winner_score: number;
    loser_score: number;
    winner: Player;
    loser: Player;
  };
}

// 退会者用のデフォルトアバター
const DELETED_USER_AVATAR = "/images/deleted-user-avatar.png";
const DEFAULT_AVATAR = "/images/default-avatar.png";

export default function MatchCard({ match }: MatchCardProps) {
  const formatPlayerName = (player: Player) => {
    return player.is_deleted ? "退会済" : player.handle_name;
  };

  const getPlayerAvatar = (player: Player) => {
    if (player.is_deleted) {
      return DELETED_USER_AVATAR;
    }
    return player.avatar_url || DEFAULT_AVATAR;
  };

  const PlayerDisplay = ({
    player,
    score,
    isWinner,
  }: {
    player: Player;
    score: number;
    isWinner: boolean;
  }) => (
    <div
      className={`flex items-center gap-3 p-4 rounded-lg ${
        isWinner ? "bg-green-900/30" : "bg-gray-800/50"
      }`}
    >
      <div className="relative">
        {player.is_deleted ? (
          <div className="w-12 h-12 bg-gray-700 rounded-full flex items-center justify-center">
            <FaUser className="text-gray-500" />
          </div>
        ) : (
          <Image
            src={getPlayerAvatar(player)}
            alt={formatPlayerName(player)}
            width={40}
            height={40}
            className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex-shrink-0 object-cover"
            unoptimized
          />
        )}
        {isWinner && (
          <FaTrophy className="absolute -top-1 -right-1 text-yellow-400 text-sm" />
        )}
      </div>
      <div className="flex-1">
        <p
          className={`font-medium ${
            player.is_deleted ? "text-gray-500" : "text-white"
          }`}
        >
          {formatPlayerName(player)}
        </p>
        <p className="text-2xl font-bold">{score}</p>
      </div>
    </div>
  );

  return (
    <div className="bg-gray-900/60 backdrop-blur-md rounded-xl border border-purple-500/30 p-6">
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-400">
          {formatDistanceToNow(new Date(match.created_at), {
            addSuffix: true,
            locale: ja,
          })}
        </p>
      </div>

      <div className="space-y-3">
        <PlayerDisplay
          player={match.winner}
          score={match.winner_score}
          isWinner={true}
        />
        <PlayerDisplay
          player={match.loser}
          score={match.loser_score}
          isWinner={false}
        />
      </div>
    </div>
  );
}
