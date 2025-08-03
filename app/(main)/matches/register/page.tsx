// app/(main)/matches/register/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Player } from '@/types/player';
import { Tournament, MatchFormData } from '@/types/matches';
import { FaTrophy, FaCalendar, FaMapMarkerAlt, FaStickyNote, FaMedal, FaGamepad, FaUsers, FaDice } from 'react-icons/fa';
import { useRouter } from 'next/navigation';

// Supabaseクライアントをコンポーネント外で作成
const supabase = createClient();

export default function MatchRegisterPage() {
  const router = useRouter();
  const [players, setPlayers] = useState<Player[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [matchType, setMatchType] = useState<'normal' | 'tournament'>('normal');
  const [previewMode, setPreviewMode] = useState(false);
  const [formData, setFormData] = useState<MatchFormData>({
    match_date: new Date().toISOString().slice(0, 16),
    winner_id: '',
    loser_id: '',
    loser_score: 0,
    tournament_id: '',
    venue: '',
    notes: '',
  });

  useEffect(() => {
    fetchPlayers();
    fetchTournaments();
    // Supabase接続テスト
    testSupabaseConnection();
  }, []);

  const testSupabaseConnection = async () => {
    try {
      const { data, error } = await supabase
        .from('players')
        .select('count')
        .single();
      
      if (error) {
        console.error('Supabase connection error:', error);
      } else {
        console.log('Supabase connection successful');
      }
    } catch (err) {
      console.error('Supabase connection failed:', err);
    }
  };

  const fetchPlayers = async () => {
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('is_active', true)
      .order('handle_name');
    
    if (!error && data) {
      setPlayers(data);
    }
  };

  const fetchTournaments = async () => {
    const { data, error } = await supabase
      .from('tournaments')
      .select('*')
      .eq('is_active', true)
      .order('tournament_date', { ascending: false });
    
    if (!error && data) {
      setTournaments(data);
    }
  };

  const calculatePointsAndHandicapChange = (
    winnerPoints: number,
    loserPoints: number,
    winnerHandicap: number,
    loserHandicap: number,
    scoreDifference: number,
    tournamentBonus: number = 1.0
  ): {
    winnerPointsChange: number;
    loserPointsChange: number;
    winnerHandicapChange: number;
    loserHandicapChange: number;
  } => {
    // 基本ポイント計算（ELOレーティングベース）
    const K = 32; // K係数
    const expectedWinner = 1 / (1 + Math.pow(10, (loserPoints - winnerPoints) / 400));
    
    // スコア差による調整（15-0で勝利した場合は1.5倍、15-14の場合は0.8倍など）
    const scoreDiffMultiplier = 1 + (scoreDifference / 30);
    
    // ハンディキャップ差による調整
    const handicapDiff = winnerHandicap - loserHandicap;
    const handicapMultiplier = 1 + (handicapDiff / 50); // ハンディキャップが高い方が勝った場合はポイント増加
    
    // 最終的なポイント変動
    const baseWinnerChange = K * (1 - expectedWinner) * scoreDiffMultiplier * handicapMultiplier * tournamentBonus;
    const baseLoserChange = -K * expectedWinner * scoreDiffMultiplier * tournamentBonus;
    
    // ハンディキャップの変更（勝者は減少、敗者は増加の可能性）
    const winnerHandicapChange = scoreDifference >= 10 ? -1 : 0; // 大差で勝った場合はハンディキャップ減少
    const loserHandicapChange = scoreDifference >= 10 ? 1 : 0; // 大差で負けた場合はハンディキャップ増加
    
    return {
      winnerPointsChange: Math.round(baseWinnerChange),
      loserPointsChange: Math.round(baseLoserChange),
      winnerHandicapChange,
      loserHandicapChange,
    };
  };

  const getSelectedPlayer = (playerId: string) => {
    return players.find(p => p.id === playerId);
  };

  const handlePreview = () => {
    if (formData.winner_id && formData.loser_id) {
      setPreviewMode(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      // デバッグ用：フォームデータを確認
      console.log('Form data before submission:', formData);
      console.log('Match type:', matchType);
      console.log('Selected players:', {
        winner: players.find(p => p.id === formData.winner_id),
        loser: players.find(p => p.id === formData.loser_id)
      });
      
      // バリデーション
      if (!formData.winner_id || !formData.loser_id) {
        throw new Error('勝者と敗者を選択してください');
      }
      
      if (formData.winner_id === formData.loser_id) {
        throw new Error('同じプレイヤーを選択することはできません');
      }

      if (formData.loser_score >= 15) {
        throw new Error('敗者のスコアは15点未満である必要があります');
      }

      if (matchType === 'tournament' && !formData.tournament_id) {
        throw new Error('大会を選択してください');
      }

      // プレイヤー情報取得
      const { data: playersData } = await supabase
        .from('players')
        .select('id, ranking_points, handicap, matches_played, wins, losses')
        .in('id', [formData.winner_id, formData.loser_id]);

      if (!playersData || playersData.length !== 2) {
        throw new Error('プレイヤー情報の取得に失敗しました');
      }

      const winner = playersData.find(p => p.id === formData.winner_id)!;
      const loser = playersData.find(p => p.id === formData.loser_id)!;

      // 大会情報取得（大会の場合）
      let tournamentBonus = 1.0;
      if (matchType === 'tournament' && formData.tournament_id) {
        const { data: tournamentData } = await supabase
          .from('tournaments')
          .select('bonus_coefficient')
          .eq('id', formData.tournament_id)
          .single();
        
        if (tournamentData) {
          tournamentBonus = tournamentData.bonus_coefficient;
        }
      }

      // ポイントとハンディキャップ変動計算
      const scoreDifference = 15 - formData.loser_score;
      const changes = calculatePointsAndHandicapChange(
        winner.ranking_points,
        loser.ranking_points,
        winner.handicap,
        loser.handicap,
        scoreDifference,
        tournamentBonus
      );

      // 試合結果登録（最小限のデータでテスト）
      const matchData = {
        winner_id: formData.winner_id,
        loser_id: formData.loser_id,
        winner_score: 15,
        loser_score: parseInt(formData.loser_score.toString()), // 確実に数値として送信
        winner_points_change: changes.winnerPointsChange,
        loser_points_change: changes.loserPointsChange,
        winner_handicap_change: changes.winnerHandicapChange,
        loser_handicap_change: changes.loserHandicapChange,
      };

      // オプショナルフィールドを追加
      const optionalFields: any = {};
      
      if (formData.match_date) {
        optionalFields.match_date = formData.match_date;
      }
      
      if (matchType === 'tournament' && formData.tournament_id) {
        optionalFields.tournament_id = formData.tournament_id;
        optionalFields.is_tournament = true;
      } else {
        optionalFields.is_tournament = false;
      }
      
      // venueフィールドを再度有効化（キャッシュが更新されたら）
      if (formData.venue && formData.venue.trim() !== '') {
        optionalFields.venue = formData.venue.trim();
      }
      
      if (formData.notes && formData.notes.trim() !== '') {
        optionalFields.notes = formData.notes.trim();
      }

      const fullMatchData = { ...matchData, ...optionalFields };

      console.log('Inserting match data:', fullMatchData); // デバッグ用
      console.log('Match data JSON:', JSON.stringify(fullMatchData, null, 2)); // JSON形式で確認

      const { data: insertedMatch, error: matchError } = await supabase
        .from('matches')
        .insert([fullMatchData]) // 配列として渡す
        .select()
        .single();

      if (matchError) {
        console.error('Match insert error details:', {
          error: matchError,
          code: matchError.code,
          message: matchError.message,
          details: matchError.details,
          hint: matchError.hint,
        });
        
        // Supabaseのエラーレスポンス全体も確認
        console.error('Full error object:', JSON.stringify(matchError, null, 2));
        
        // リクエストの詳細も確認
        console.error('Failed request data:', fullMatchData);
        
        throw new Error(`試合登録エラー: ${matchError.message} ${matchError.hint ? `(${matchError.hint})` : ''}`);
      }

      console.log('Successfully inserted match:', insertedMatch);

      // プレイヤー情報更新
      const updatePromises = [
        supabase
          .from('players')
          .update({
            ranking_points: winner.ranking_points + changes.winnerPointsChange,
            handicap: Math.max(0, winner.handicap + changes.winnerHandicapChange),
            matches_played: winner.matches_played + 1,
            wins: winner.wins + 1,
          })
          .eq('id', formData.winner_id),
        supabase
          .from('players')
          .update({
            ranking_points: Math.max(0, loser.ranking_points + changes.loserPointsChange),
            handicap: Math.min(50, loser.handicap + changes.loserHandicapChange),
            matches_played: loser.matches_played + 1,
            losses: loser.losses + 1,
          })
          .eq('id', formData.loser_id),
      ];

      await Promise.all(updatePromises);

      setSuccess(true);
      // 成功アニメーション後にリダイレクト
      setTimeout(() => {
        router.push('/matches');
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const winner = getSelectedPlayer(formData.winner_id);
  const loser = getSelectedPlayer(formData.loser_id);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* ヘッダー */}
      <div className="text-center mb-12">
        <div className="inline-block p-4 mb-4 rounded-full bg-gradient-to-br from-purple-400/20 to-pink-600/20">
          <FaGamepad className="text-5xl text-purple-400" />
        </div>
        <h1 className="text-4xl font-bold mb-4 text-yellow-100">
          試合結果登録
        </h1>
        <p className="text-gray-400">
          熱戦の記録を残そう
        </p>
      </div>

      {error && (
        <div className="glass-card rounded-lg p-4 mb-6 border border-red-500/50 bg-red-500/10">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {success && (
        <div className="glass-card rounded-lg p-4 mb-6 border border-green-500/50 bg-green-500/10">
          <p className="text-green-400 text-center text-xl font-bold animate-pulse">
            🎉 試合結果を登録しました！
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="max-w-4xl mx-auto space-y-6">
        {/* 試合タイプ選択 */}
        <div className="glass-card rounded-xl p-6 border border-purple-500/30">
          <label className="block text-sm font-medium mb-4 text-gray-300">試合タイプ</label>
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setMatchType('normal')}
              className={`p-4 rounded-lg border transition-all ${
                matchType === 'normal'
                  ? 'bg-gradient-to-r from-blue-500/20 to-purple-500/20 border-blue-500/50'
                  : 'bg-purple-900/20 border-purple-500/20 hover:border-purple-400/40'
              }`}
            >
              <FaDice className="text-2xl mb-2 mx-auto text-blue-400" />
              <p className="font-medium text-yellow-100">通常試合</p>
            </button>
            
            <button
              type="button"
              onClick={() => setMatchType('tournament')}
              className={`p-4 rounded-lg border transition-all ${
                matchType === 'tournament'
                  ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-500/50'
                  : 'bg-purple-900/20 border-purple-500/20 hover:border-purple-400/40'
              }`}
            >
              <FaMedal className="text-2xl mb-2 mx-auto text-yellow-400" />
              <p className="font-medium text-yellow-100">大会</p>
            </button>
          </div>
        </div>

        {/* 大会選択（大会の場合のみ） */}
        {matchType === 'tournament' && (
          <div className="glass-card rounded-xl p-6 border border-yellow-500/30 animate-fadeIn">
            <label className="block text-sm font-medium mb-2 text-gray-300">
              <FaMedal className="inline mr-2 text-yellow-400" />
              大会選択
            </label>
            <select
              required={matchType === 'tournament'}
              value={formData.tournament_id}
              onChange={(e) => setFormData({ ...formData, tournament_id: e.target.value })}
              className="w-full px-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100 focus:outline-none focus:border-purple-400"
            >
              <option value="">大会を選択してください</option>
              {tournaments.map((tournament) => (
                <option key={tournament.id} value={tournament.id}>
                  {tournament.name} (ボーナス: {tournament.bonus_coefficient}倍)
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 日時 */}
        <div className="glass-card rounded-xl p-6 border border-purple-500/30">
          <label className="block text-sm font-medium mb-2 text-gray-300">
            <FaCalendar className="inline mr-2 text-purple-400" />
            試合日時
          </label>
          <input
            type="datetime-local"
            required
            value={formData.match_date}
            onChange={(e) => setFormData({ ...formData, match_date: e.target.value })}
            className="w-full px-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100 focus:outline-none focus:border-purple-400"
          />
        </div>

        {/* プレイヤー選択 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="glass-card rounded-xl p-6 border border-green-500/30">
            <label className="block text-sm font-medium mb-2 text-gray-300">
              <FaTrophy className="inline mr-2 text-green-400" />
              勝者
            </label>
            <select
              required
              value={formData.winner_id}
              onChange={(e) => setFormData({ ...formData, winner_id: e.target.value })}
              className="w-full px-4 py-3 bg-purple-900/30 border border-green-500/30 rounded-lg text-yellow-100 focus:outline-none focus:border-green-400"
            >
              <option value="">選択してください</option>
              {players.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.handle_name} (RP: {player.ranking_points}, HC: {player.handicap})
                </option>
              ))}
            </select>
            
            {winner && (
              <div className="mt-4 p-3 bg-green-500/10 rounded-lg flex items-center gap-3">
                <img
                  src={winner.avatar_url || '/default-avatar.png'}
                  alt={winner.handle_name}
                  className="w-12 h-12 rounded-full border-2 border-green-500"
                />
                <div>
                  <p className="font-bold text-yellow-100">{winner.handle_name}</p>
                  <p className="text-sm text-gray-400">
                    RP: {winner.ranking_points} | HC: {winner.handicap}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="glass-card rounded-xl p-6 border border-red-500/30">
            <label className="block text-sm font-medium mb-2 text-gray-300">
              敗者
            </label>
            <select
              required
              value={formData.loser_id}
              onChange={(e) => setFormData({ ...formData, loser_id: e.target.value })}
              className="w-full px-4 py-3 bg-purple-900/30 border border-red-500/30 rounded-lg text-yellow-100 focus:outline-none focus:border-red-400"
            >
              <option value="">選択してください</option>
              {players.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.handle_name} (RP: {player.ranking_points}, HC: {player.handicap})
                </option>
              ))}
            </select>
            
            {loser && (
              <div className="mt-4 p-3 bg-red-500/10 rounded-lg flex items-center gap-3">
                <img
                  src={loser.avatar_url || '/default-avatar.png'}
                  alt={loser.handle_name}
                  className="w-12 h-12 rounded-full border-2 border-red-500"
                />
                <div>
                  <p className="font-bold text-yellow-100">{loser.handle_name}</p>
                  <p className="text-sm text-gray-400">
                    RP: {loser.ranking_points} | HC: {loser.handicap}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* スコア */}
        <div className="glass-card rounded-xl p-6 border border-purple-500/30">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
            <div className="text-center">
              <label className="block text-sm font-medium mb-2 text-gray-300">勝者スコア</label>
              <div className="text-4xl font-bold text-green-400">15</div>
            </div>

            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 shadow-lg">
                <span className="text-white font-bold text-lg">VS</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-gray-300">敗者スコア</label>
              <input
                type="number"
                required
                min="0"
                max="14"
                value={formData.loser_score}
                onChange={(e) => setFormData({ ...formData, loser_score: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100 text-center text-2xl font-bold focus:outline-none focus:border-purple-400"
              />
              <p className="text-xs text-gray-500 mt-1 text-center">0〜14点</p>
            </div>
          </div>
        </div>

        {/* 会場・備考 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="glass-card rounded-xl p-6 border border-purple-500/30">
            <label className="block text-sm font-medium mb-2 text-gray-300">
              <FaMapMarkerAlt className="inline mr-2 text-purple-400" />
              会場（任意）
            </label>
            <input
              type="text"
              value={formData.venue}
              onChange={(e) => setFormData({ ...formData, venue: e.target.value })}
              className="w-full px-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100 focus:outline-none focus:border-purple-400"
              placeholder="例: 〇〇体育館"
            />
          </div>

          <div className="glass-card rounded-xl p-6 border border-purple-500/30">
            <label className="block text-sm font-medium mb-2 text-gray-300">
              <FaStickyNote className="inline mr-2 text-purple-400" />
              備考（任意）
            </label>
            <input
              type="text"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-lg text-yellow-100 focus:outline-none focus:border-purple-400"
              placeholder="試合に関するメモ"
            />
          </div>
        </div>

        {/* プレビュー */}
        {winner && loser && (
          <div className="glass-card rounded-xl p-6 border border-purple-500/30">
            <h3 className="text-lg font-bold mb-4 text-yellow-100">ポイント変動予測</h3>
            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="p-4 bg-green-500/10 rounded-lg">
                <p className="text-sm text-gray-400">勝者</p>
                <p className="font-bold text-yellow-100">{winner.handle_name}</p>
                <p className="text-2xl font-bold text-green-400">
                  +{calculatePointsAndHandicapChange(
                    winner.ranking_points,
                    loser.ranking_points,
                    winner.handicap,
                    loser.handicap,
                    15 - formData.loser_score,
                    matchType === 'tournament' && formData.tournament_id 
                      ? tournaments.find(t => t.id === formData.tournament_id)?.bonus_coefficient || 1
                      : 1
                  ).winnerPointsChange}pt
                </p>
              </div>
              <div className="p-4 bg-red-500/10 rounded-lg">
                <p className="text-sm text-gray-400">敗者</p>
                <p className="font-bold text-yellow-100">{loser.handle_name}</p>
                <p className="text-2xl font-bold text-red-400">
                  {calculatePointsAndHandicapChange(
                    winner.ranking_points,
                    loser.ranking_points,
                    winner.handicap,
                    loser.handicap,
                    15 - formData.loser_score,
                    matchType === 'tournament' && formData.tournament_id 
                      ? tournaments.find(t => t.id === formData.tournament_id)?.bonus_coefficient || 1
                      : 1
                  ).loserPointsChange}pt
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 送信ボタン */}
        <div className="flex justify-center">
          <button
            type="submit"
            disabled={loading || !formData.winner_id || !formData.loser_id}
            className="gradient-button px-12 py-4 rounded-full text-white font-medium text-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                登録中...
              </>
            ) : (
              <>
                <FaTrophy />
                試合結果を登録
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}