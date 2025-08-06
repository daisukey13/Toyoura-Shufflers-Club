'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FaUserPlus, FaUser, FaEnvelope, FaPhone, FaMapMarkerAlt, FaGamepad, FaImage, FaCheckCircle, FaExclamationCircle, FaSpinner, FaLock } from 'react-icons/fa';

const supabase = createClient();

interface FormData {
  handle_name: string;
  full_name: string;
  email: string;
  password: string;
  passwordConfirm: string;
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
    password: '',
    passwordConfirm: '',
    phone: '',
    address: '',
    avatar_url: '',
    agreeToTerms: false,
    isHighSchoolOrAbove: false,
  });
  const [avatarOptions, setAvatarOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [handleNameError, setHandleNameError] = useState('');
  const [passwordError, setPasswordError] = useState('');
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

  useEffect(() => {
    // パスワードの検証
    if (formData.password && formData.password.length < 6) {
      setPasswordError('パスワードは6文字以上で設定してください');
    } else if (formData.password && formData.passwordConfirm && formData.password !== formData.passwordConfirm) {
      setPasswordError('パスワードが一致しません');
    } else {
      setPasswordError('');
    }
  }, [formData.password, formData.passwordConfirm]);

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
      // アバター取得に失敗してもフォームは使えるようにする
      setAvatarOptions([]);
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

    if (passwordError) {
      alert('パスワードを確認してください。');
      return;
    }

    setLoading(true);

    try {
      console.log('Registration starting...');
      
      // 1. Supabase Authでユーザーを作成
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            handle_name: formData.handle_name,
            full_name: formData.full_name,
          }
        }
      });

      if (authError) {
        console.error('Auth error:', authError);
        throw authError;
      }

      if (!authData.user) {
        throw new Error('ユーザー作成に失敗しました');
      }

      console.log('User created:', authData.user.id);

      // 2. プレイヤー情報を登録
      const playerData = {
        id: authData.user.id,
        handle_name: formData.handle_name,
        full_name: formData.full_name,
        email: formData.email,
        phone: formData.phone,
        address: formData.address || '未設定',
        avatar_url: formData.avatar_url || null,
        is_admin: false,
        is_active: true,
        ranking_points: 1000,
        handicap: 30,
        matches_played: 0,
        wins: 0,
        losses: 0,
      };

      console.log('Inserting player data:', playerData);

      const { data, error } = await supabase
        .from('players')
        .insert(playerData)
        .select()
        .single();

      if (error) {
        console.error('Player insert error:', error);
        throw error;
      }

      console.log('Player created:', data);

      // 3. 成功メッセージ
      alert('プレイヤー登録が完了しました！メールアドレスに確認メールを送信しました。');
      
      // ログインページへリダイレクト
      router.push('/login');
    } catch (error: any) {
      console.error('Registration error:', error);
      
      let errorMessage = '登録中にエラーが発生しました。';
      
      if (error.message?.includes('already registered')) {
        errorMessage = 'このメールアドレスは既に登録されています。';
      } else if (error.message?.includes('Invalid email')) {
        errorMessage = '有効なメールアドレスを入力してください。';
      } else if (error.message?.includes('Password')) {
        errorMessage = 'パスワードは6文字以上で設定してください。';
      } else if (error.message) {
        errorMessage += '\n詳細: ' + error.message;
      }
      
      alert(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#2a2a3e] pb-20 lg:pb-8">
      <div className="container mx-auto px-4 py-4 sm:py-8">
        {/* ヘッダー */}
        <div className="mb-6 sm:mb-8 text-center">
          <div className="flex items-center justify-center gap-3 mb-3 sm:mb-4">
            <div className="p-2.5 sm:p-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full">
              <FaUserPlus className="text-2xl sm:text-3xl text-white" />
            </div>
          </div>
          <h1 className="text-2xl sm:text-4xl font-bold text-white mb-2 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            新規プレイヤー登録
          </h1>
          <p className="text-sm sm:text-base text-gray-300">
            豊浦シャッフラーズクラブへようこそ
          </p>
        </div>

        {/* 登録フォーム */}
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-8">
            {/* 基本情報 */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-xl sm:rounded-2xl border border-purple-500/30 p-4 sm:p-6 space-y-4 sm:space-y-6">
              <h2 className="text-lg sm:text-xl font-semibold text-white flex items-center gap-2">
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
                    className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-gray-800/50 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all ${
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
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400 transition-all"
                  placeholder="例: 山田太郎"
                />
              </div>
            </div>

            {/* アカウント情報 */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-xl sm:rounded-2xl border border-purple-500/30 p-4 sm:p-6 space-y-4 sm:space-y-6">
              <h2 className="text-lg sm:text-xl font-semibold text-white flex items-center gap-2">
                <FaLock className="text-purple-400" />
                アカウント情報
              </h2>
              
              {/* メールアドレス */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-purple-300 mb-2">
                  <FaEnvelope className="inline mr-2" />
                  メールアドレス（ログインに使用）
                </label>
                <input
                  type="email"
                  id="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400 transition-all"
                  placeholder="例: example@email.com"
                />
              </div>

              {/* パスワード */}
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-purple-300 mb-2">
                  <FaLock className="inline mr-2" />
                  パスワード（6文字以上）
                </label>
                <input
                  type="password"
                  id="password"
                  required
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-gray-800/50 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all ${
                    passwordError && formData.password ? 'border-red-500' : 'border-purple-500/30 focus:border-purple-400'
                  }`}
                  placeholder="パスワードを入力"
                />
              </div>

              {/* パスワード確認 */}
              <div>
                <label htmlFor="passwordConfirm" className="block text-sm font-medium text-purple-300 mb-2">
                  <FaLock className="inline mr-2" />
                  パスワード（確認）
                </label>
                <input
                  type="password"
                  id="passwordConfirm"
                  required
                  value={formData.passwordConfirm}
                  onChange={(e) => setFormData({ ...formData, passwordConfirm: e.target.value })}
                  className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-gray-800/50 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all ${
                    passwordError && formData.passwordConfirm ? 'border-red-500' : 'border-purple-500/30 focus:border-purple-400'
                  }`}
                  placeholder="パスワードを再入力"
                />
                {passwordError && (
                  <p className="mt-1 text-sm text-red-400">{passwordError}</p>
                )}
              </div>
            </div>

            {/* 連絡先情報 */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-xl sm:rounded-2xl border border-purple-500/30 p-4 sm:p-6 space-y-4 sm:space-y-6">
              <h2 className="text-lg sm:text-xl font-semibold text-white flex items-center gap-2">
                <FaPhone className="text-purple-400" />
                連絡先情報
              </h2>

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
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400 transition-all"
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
                  required
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400 transition-all"
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

            {/* プロフィール - アバター選択を簡略化 */}
            {avatarOptions.length > 0 && (
              <div className="bg-gray-900/60 backdrop-blur-md rounded-xl sm:rounded-2xl border border-purple-500/30 p-4 sm:p-6 space-y-4 sm:space-y-6">
                <h2 className="text-lg sm:text-xl font-semibold text-white flex items-center gap-2">
                  <FaImage className="text-purple-400" />
                  プロフィール
                </h2>
                
                {/* アバター選択 */}
                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-4">
                    アバター画像を選択（公開・任意）
                  </label>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 sm:gap-3">
                    {avatarOptions.slice(0, 12).map((url, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setFormData({ ...formData, avatar_url: url })}
                        className={`relative p-1.5 sm:p-2 rounded-lg border-2 transition-all transform hover:scale-110 ${
                          formData.avatar_url === url
                            ? 'border-purple-400 bg-purple-500/20 shadow-lg shadow-purple-500/30'
                            : 'border-purple-500/30 hover:border-purple-400/50 bg-gray-800/30'
                        }`}
                      >
                        <img
                          src={url}
                          alt={`Avatar ${index + 1}`}
                          className="w-full h-auto rounded"
                          loading="lazy"
                        />
                        {formData.avatar_url === url && (
                          <div className="absolute inset-0 flex items-center justify-center bg-purple-500/20 rounded-lg">
                            <FaCheckCircle className="text-purple-400 text-lg sm:text-2xl" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 年齢確認・利用規約同意 */}
            <div className="bg-gray-900/60 backdrop-blur-md rounded-xl sm:rounded-2xl border border-purple-500/30 p-4 sm:p-6 space-y-3 sm:space-y-4">
              <label className="flex items-start cursor-pointer group">
                <input
                  type="checkbox"
                  checked={formData.isHighSchoolOrAbove}
                  onChange={(e) => setFormData({ ...formData, isHighSchoolOrAbove: e.target.checked })}
                  className="mr-3 mt-0.5 w-5 h-5 bg-gray-800 border-purple-500 text-purple-600 rounded focus:ring-purple-500"
                />
                <span className="text-sm sm:text-base text-gray-300 group-hover:text-white transition-colors">
                  私は高校生以上です
                </span>
              </label>
              
              <label className="flex items-start cursor-pointer group">
                <input
                  type="checkbox"
                  checked={formData.agreeToTerms}
                  onChange={(e) => setFormData({ ...formData, agreeToTerms: e.target.checked })}
                  className="mr-3 mt-0.5 w-5 h-5 bg-gray-800 border-purple-500 text-purple-600 rounded focus:ring-purple-500"
                />
                <span className="text-sm sm:text-base text-gray-300 group-hover:text-white transition-colors">
                  <Link href="/terms" target="_blank" className="text-purple-400 hover:text-purple-300 underline">
                    利用規約
                  </Link>
                  に同意する
                </span>
              </label>
            </div>

            {/* 送信ボタン */}
            <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4">
              <button
                type="button"
                onClick={() => router.push('/')}
                className="px-6 sm:px-8 py-2.5 sm:py-3 bg-gray-700 text-white rounded-xl hover:bg-gray-600 transition-all transform hover:scale-105 shadow-lg font-medium"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={loading || !!handleNameError || !!passwordError || !formData.isHighSchoolOrAbove || !formData.agreeToTerms}
                className="px-6 sm:px-8 py-2.5 sm:py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 transition-all transform hover:scale-105 shadow-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
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