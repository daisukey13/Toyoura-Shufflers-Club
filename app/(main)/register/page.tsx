// app/(main)/register/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FaUserPlus, FaUser, FaEnvelope, FaPhone, FaMapMarkerAlt, FaGamepad, FaImage, FaCheckCircle, FaExclamationCircle, FaSpinner } from 'react-icons/fa';

const supabase = createClient();

interface FormData {
  handle_name: string;
  full_name: string;
  email: string;
  phone: string;
  address: string;
  avatar_url: string;
  agreeToTerms: boolean;
  isHighSchoolOrAbove: boolean;
}

const addressOptions = [
  '豊浦町', '洞爺湖町', '壮瞥町', '伊達市', '室蘭市', '登別市',
  '倶知安町', 'ニセコ町', '札幌市', 'その他道内', '内地', '外国（Visitor)'
];

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState<FormData>({
    handle_name: '',
    full_name: '',
    email: '',
    phone: '',
    address: '',
    avatar_url: '',
    agreeToTerms: false,
    isHighSchoolOrAbove: false,
  });
  const [avatarOptions, setAvatarOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [handleNameError, setHandleNameError] = useState('');
  const [checkingHandleName, setCheckingHandleName] = useState(false);

  useEffect(() => {
    fetchAvatarOptions();
  }, []);

  useEffect(() => {
    const checkHandleName = async () => {
      if (formData.handle_name.length < 3) {
        setHandleNameError('');
        return;
      }

      setCheckingHandleName(true);
      try {
        const { data } = await supabase
          .from('players')
          .select('id')
          .eq('handle_name', formData.handle_name)
          .single();

        if (data) {
          setHandleNameError('このハンドルネームは既に使用されています');
        } else {
          setHandleNameError('');
        }
      } catch (error) {
        setHandleNameError('');
      } finally {
        setCheckingHandleName(false);
      }
    };

    const timeoutId = setTimeout(checkHandleName, 500);
    return () => clearTimeout(timeoutId);
  }, [formData.handle_name]);

  const fetchAvatarOptions = async () => {
    try {
      const { data, error } = await supabase
        .storage
        .from('avatars')
        .list('preset', {
          limit: 100,
          offset: 0,
        });

      if (!error && data) {
        const urls = data.map(file => {
          const { data: publicData } = supabase
            .storage
            .from('avatars')
            .getPublicUrl(`preset/${file.name}`);
          return publicData.publicUrl;
        });
        setAvatarOptions(urls);
      }
    } catch (error) {
      console.error('Error fetching avatars:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.isHighSchoolOrAbove) {
      alert('高校生以上の方のみ登録可能です。');
      return;
    }
    
    if (!formData.agreeToTerms) {
      alert('利用規約に同意してください。');
      return;
    }

    if (handleNameError) {
      alert('ハンドルネームを変更してください。');
      return;
    }

    setLoading(true);

    try {
      // プレイヤー登録
      const { data, error } = await supabase
        .from('players')
        .insert({
          handle_name: formData.handle_name,
          full_name: formData.full_name,
          email: formData.email,
          phone: formData.phone,
          address: formData.address,
          avatar_url: formData.avatar_url || null,
          is_admin: false,
          is_active: true,
          ranking_points: 1000,
          handicap: 30,
          matches_played: 0,
          wins: 0,
          losses: 0,
        })
        .select()
        .single();

      if (error) throw error;

      // 成功時はプレイヤー一覧へリダイレクト
      alert('プレイヤー登録が完了しました！');
      router.push('/players');
    } catch (error) {
      console.error('Registration error:', error);
      alert('登録中にエラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#2a2a3e]">
      <div className="container mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="p-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full">
              <FaUserPlus className="text-3xl text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold text-white mb-2 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            新規プレイヤー登録
          </h1>
          <p className="text-gray-300">
            豊浦シャッフラーズクラブへようこそ
          </p>
        </div>

        {/* 登録フォーム */}
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSubmit} className="space-y-8">
            {/* 基本情報 */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-6 space-y-6">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <FaGamepad className="text-purple-400" />
                基本情報
              </h2>
              
              {/* ハンドルネーム */}
              <div>
                <label htmlFor="handle_name" className="block text-sm font-medium text-purple-300 mb-2">
                  <FaUser className="inline mr-2" />
                  ハンドルネーム（公開）
                </label>
                <div className="relative">
                  <input
                    type="text"
                    id="handle_name"
                    required
                    value={formData.handle_name}
                    onChange={(e) => setFormData({ ...formData, handle_name: e.target.value })}
                    className={`w-full px-4 py-3 bg-gray-800/50 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all ${
                      handleNameError ? 'border-red-500' : 'border-purple-500/30 focus:border-purple-400'
                    }`}
                    placeholder="例: シャッフル太郎"
                  />
                  {checkingHandleName && (
                    <div className="absolute right-3 top-3.5">
                      <FaSpinner className="animate-spin text-purple-400" />
                    </div>
                  )}
                  {!checkingHandleName && formData.handle_name && (
                    <div className="absolute right-3 top-3.5">
                      {handleNameError ? (
                        <FaExclamationCircle className="text-red-400" />
                      ) : (
                        <FaCheckCircle className="text-green-400" />
                      )}
                    </div>
                  )}
                </div>
                {handleNameError && (
                  <p className="mt-1 text-sm text-red-400">{handleNameError}</p>
                )}
              </div>

              {/* 氏名 */}
              <div>
                <label htmlFor="full_name" className="block text-sm font-medium text-purple-300 mb-2">
                  氏名（非公開）
                </label>
                <input
                  type="text"
                  id="full_name"
                  required
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400 transition-all"
                  placeholder="例: 山田太郎"
                />
              </div>
            </div>

            {/* 連絡先情報 */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-6 space-y-6">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <FaPhone className="text-purple-400" />
                連絡先情報
              </h2>
              
              {/* メールアドレス */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-purple-300 mb-2">
                  <FaEnvelope className="inline mr-2" />
                  メールアドレス（非公開）
                </label>
                <input
                  type="email"
                  id="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400 transition-all"
                  placeholder="例: example@email.com"
                />
              </div>

              {/* 電話番号 */}
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-purple-300 mb-2">
                  <FaPhone className="inline mr-2" />
                  電話番号（非公開）
                </label>
                <input
                  type="tel"
                  id="phone"
                  required
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400 transition-all"
                  placeholder="例: 090-1234-5678"
                />
              </div>

              {/* 住所 */}
              <div>
                <label htmlFor="address" className="block text-sm font-medium text-purple-300 mb-2">
                  <FaMapMarkerAlt className="inline mr-2" />
                  お住まいの地域（公開）
                </label>
                <select
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400 transition-all"
                >
                  <option value="" className="bg-gray-800">選択してください</option>
                  {addressOptions.map((address) => (
                    <option key={address} value={address} className="bg-gray-800">
                      {address}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* プロフィール */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-6 space-y-6">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <FaImage className="text-purple-400" />
                プロフィール
              </h2>
              
              {/* アバター選択 */}
              <div>
                <label className="block text-sm font-medium text-purple-300 mb-4">
                  アバター画像を選択（公開）
                </label>
                <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-3">
                  {avatarOptions.map((url, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setFormData({ ...formData, avatar_url: url })}
                      className={`relative p-2 rounded-lg border-2 transition-all transform hover:scale-110 ${
                        formData.avatar_url === url
                          ? 'border-purple-400 bg-purple-500/20 shadow-lg shadow-purple-500/30'
                          : 'border-purple-500/30 hover:border-purple-400/50 bg-gray-800/30'
                      }`}
                    >
                      <img
                        src={url}
                        alt={`Avatar ${index + 1}`}
                        className="w-full h-auto rounded"
                      />
                      {formData.avatar_url === url && (
                        <div className="absolute inset-0 flex items-center justify-center bg-purple-500/20 rounded-lg">
                          <FaCheckCircle className="text-purple-400 text-2xl" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 年齢確認・利用規約同意 */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-6 space-y-4">
              <label className="flex items-center cursor-pointer group">
                <input
                  type="checkbox"
                  checked={formData.isHighSchoolOrAbove}
                  onChange={(e) => setFormData({ ...formData, isHighSchoolOrAbove: e.target.checked })}
                  className="mr-3 w-5 h-5 bg-gray-800 border-purple-500 text-purple-600 rounded focus:ring-purple-500"
                />
                <span className="text-gray-300 group-hover:text-white transition-colors">
                  私は高校生以上です
                </span>
              </label>
              
              <label className="flex items-center cursor-pointer group">
                <input
                  type="checkbox"
                  checked={formData.agreeToTerms}
                  onChange={(e) => setFormData({ ...formData, agreeToTerms: e.target.checked })}
                  className="mr-3 w-5 h-5 bg-gray-800 border-purple-500 text-purple-600 rounded focus:ring-purple-500"
                />
                <span className="text-gray-300 group-hover:text-white transition-colors">
                  <Link href="/terms" target="_blank" className="text-purple-400 hover:text-purple-300 underline">
                    利用規約
                  </Link>
                  に同意する
                </span>
              </label>
            </div>

            {/* 送信ボタン */}
            <div className="flex justify-center gap-4">
              <button
                type="button"
                onClick={() => router.push('/players')}
                className="px-8 py-3 bg-gray-700 text-white rounded-xl hover:bg-gray-600 transition-all transform hover:scale-105 shadow-lg font-medium"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={loading || !!handleNameError || !formData.isHighSchoolOrAbove || !formData.agreeToTerms}
                className="px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 transition-all transform hover:scale-105 shadow-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <FaSpinner className="animate-spin" />
                    登録中...
                  </>
                ) : (
                  <>
                    <FaUserPlus />
                    登録する
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}