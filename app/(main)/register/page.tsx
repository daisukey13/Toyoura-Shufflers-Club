// app/(main)/register/page.tsx
'use client';

import { useState, useEffect, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

import {
  FaUserPlus,
  FaUser,
  FaEnvelope,
  FaPhone,
  FaMapMarkerAlt,
  FaGamepad,
  FaCheckCircle,
  FaExclamationCircle,
  FaSpinner,
  FaLock,
  FaImage,
} from 'react-icons/fa';

import AvatarSelector from '@/components/AvatarSelector';

type FormData = {
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
};

const addressOptions = [
  '豊浦町',
  '洞爺湖町',
  '壮瞥町',
  '伊達市',
  '室蘭市',
  '登別市',
  '倶知安町',
  'ニセコ町',
  '札幌市',
  'その他道内',
  '内地',
  '外国（Visitor)',
];

const DEFAULT_AVATAR = '/default-avatar.png';

const PASSCODE = process.env.NEXT_PUBLIC_SIGNUP_PASSCODE || '';
const RATING_DEFAULT = Number(process.env.NEXT_PUBLIC_RATING_DEFAULT ?? 1000);
const HANDICAP_DEFAULT = Number(process.env.NEXT_PUBLIC_HANDICAP_DEFAULT ?? 30);

const supabase = createClient();

export default function RegisterPage() {
  const router = useRouter();

  const [unlocked, setUnlocked] = useState<boolean>(PASSCODE.length === 0);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeError, setPasscodeError] = useState<string | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.removeItem('regUnlocked');
      localStorage.removeItem('regUnlocked');
    } catch {}
  }, []);

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

  const [loading, setLoading] = useState(false);
  const [handleNameError, setHandleNameError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [checkingHandleName, setCheckingHandleName] = useState(false);

  async function ensureHandleUnique(handle: string) {
    const { data, error } = await supabase
      .from('players')
      .select('id')
      .eq('handle_name', handle)
      .limit(1)
      .maybeSingle();

    if (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[ensureHandleUnique]', error.message);
      }
      // 取得失敗時は「とりあえず通す」
      return true;
    }
    return !data;
  }

  // 管理者判定（管理者なら招待コードを自動解除）
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data.user;
        if (!user) return;

        // ★ ここを安全にアクセスするように修正（row が null の可能性を考慮）
        const { data: row, error } = await supabase
          .from('players')
          .select('id, is_admin')
          .eq('id', user.id)
          .maybeSingle();

        if (!error && row && row.is_admin) {
          setIsAdmin(true);
          setUnlocked(true);
        }
      } catch {
        // 管理者チェック失敗時は何もしない（通常フローで進む）
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!formData.handle_name || formData.handle_name.length < 3) {
      setHandleNameError('');
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      setCheckingHandleName(true);
      const ok = await ensureHandleUnique(formData.handle_name);
      if (!active) return;
      setHandleNameError(ok ? '' : 'このハンドルネームは既に使用されています');
      setCheckingHandleName(false);
    }, 450);
    return () => {
      active = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.handle_name]);

  useEffect(() => {
    if (formData.password && formData.password.length < 6) {
      setPasswordError('パスワードは6文字以上で設定してください');
    } else if (formData.passwordConfirm && formData.password !== formData.passwordConfirm) {
      setPasswordError('パスワードが一致しません');
    } else {
      setPasswordError('');
    }
  }, [formData.password, formData.passwordConfirm]);

  const onSubmitPasscode = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPasscodeError(null);

    const input = passcodeInput.trim();
    const expected = PASSCODE.trim();

    if (expected.length === 0) {
      setUnlocked(true);
      return;
    }
    if (input === expected) {
      setUnlocked(true);
    } else {
      setPasscodeError('招待コードが違います。');
    }
  };

  async function provisionProfile(userId: string) {
    const payload = {
      // route.ts 側の差異吸収（どっちでもOK）
      user_id: userId,
      userId,

      handle_name: formData.handle_name,
      full_name: formData.full_name,
      email: formData.email.trim(),
      phone: formData.phone.trim(),
      address: formData.address || '未設定',
      avatar_url: formData.avatar_url || DEFAULT_AVATAR,
      ranking_points: RATING_DEFAULT,
      handicap: HANDICAP_DEFAULT,
    };

    const res = await fetch('/api/register/provision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({} as any));
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || `provision failed (${res.status})`);
    }
  }

  async function adminRegisterDirect() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('admin session is missing');

    const res = await fetch('/api/admin/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        handle_name: formData.handle_name,
        full_name: formData.full_name,
        email: formData.email.trim(),
        password: formData.password.trim(),
        phone: formData.phone.trim(),
        address: formData.address || '未設定',
        avatar_url: formData.avatar_url || DEFAULT_AVATAR,
        ranking_points: RATING_DEFAULT,
        handicap: HANDICAP_DEFAULT,
      }),
    });

    const json = await res.json().catch(() => ({} as any));
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || `admin register failed (${res.status})`);
    }
    return String(json.user_id || '');
  }

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!unlocked) return;

    // 管理者はノーチェック
    if (!isAdmin) {
      if (!formData.isHighSchoolOrAbove) {
        alert('高校生以上の方のみ登録可能です。');
        return;
      }
      if (!formData.agreeToTerms) {
        alert('利用規約に同意してください。');
        return;
      }
      if (handleNameError || passwordError) {
        alert('入力内容を確認してください。');
        return;
      }
    } else {
      if (!formData.email.trim() || !formData.password.trim()) {
        alert('メールアドレスとパスワードを入力してください。');
        return;
      }
      if (passwordError) {
        alert('入力内容を確認してください。');
        return;
      }
    }

    setLoading(true);
    try {
      const uniqueNow = await ensureHandleUnique(formData.handle_name);
      if (!uniqueNow) {
        setHandleNameError('このハンドルネームは既に使用されています');
        alert('このハンドルネームは既に使用されています。別の名前を選んでください。');
        return;
      }

      // 管理者：APIで直接作成
      if (isAdmin) {
        const newUserId = await adminRegisterDirect();
        if (!newUserId) throw new Error('admin register returned empty user_id');
        alert('管理者登録でプレイヤーを作成しました。');
        router.replace(`/players/${newUserId}`);
        return;
      }

      // 通常：Auth 作成
      const email = formData.email.trim();
      const password = formData.password.trim();

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { handle_name: formData.handle_name, full_name: formData.full_name } },
      });
      if (authError || !authData?.user) throw authError ?? new Error('ユーザー作成に失敗しました');

      const userId = authData.user.id;

      // DB作成（Service Role）
      await provisionProfile(userId);

      // 直後に signIn を試す
      let session = authData.session ?? null;
      if (!session) {
        const { data: si, error: siErr } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (!siErr) session = si.session ?? null;
      }

      if (!session) {
        alert('登録が完了しました。ログイン画面へ移動します。');
        router.replace('/login?redirect=/mypage');
        return;
      }

      alert('プレイヤー登録が完了しました！');
      router.replace('/mypage');
    } catch (err: any) {
      const msg = String(err?.message || err);

      if (/duplicate key value|unique constraint|23505/i.test(msg)) {
        alert('このハンドルネームは既に使用されています。別の名前を選んでください。');
        setHandleNameError('このハンドルネームは既に使用されています');
        return;
      }
      if (/already registered|User already registered/i.test(msg)) {
        alert('このメールアドレスは既に登録されています。ログインするか、別のメールを使用してください。');
        return;
      }

      let hint = '';
      if (/row-level security|RLS/i.test(msg)) hint = '\n（Supabase の RLS を確認してください）';
      if (/does not exist|schema|relation .* does not exist|column .* does not exist/i.test(msg))
        hint = '\n（テーブル/カラム名が一致しているか確認してください）';

      alert(`登録中にエラーが発生しました。\n詳細: ${msg}${hint}`);
      console.error('[register] submit error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#2a2a3e] pb-20 lg:pb-8">
      <div className="container mx-auto px-4 py-4 sm:py-8">
        <div className="mb-6 sm:mb-8 text-center">
          <div className="flex items-center justify-center gap-3 mb-3 sm:mb-4">
            <div className="p-2.5 sm:p-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full">
              <FaUserPlus className="text-2xl sm:text-3xl text-white" />
            </div>
          </div>
          <h1 className="text-2xl sm:text-4xl font-bold text-white mb-2 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            新規プレイヤー登録
          </h1>
          <p className="text-sm sm:text-base text-gray-300">豊浦シャッフラーズクラブへようこそ</p>
        </div>

        <div className="max-w-3xl mx-auto">
          {!unlocked && (
            <div className="bg-gray-900/60 border border-purple-500/30 rounded-2xl p-4 sm:p-6 mb-4 sm:mb-6">
              <h2 className="text-lg sm:text-xl font-semibold text白 flex items-center gap-2 mb-3">
                <FaLock className="text-purple-400" />
                招待コードの入力
              </h2>
              <form onSubmit={onSubmitPasscode} noValidate className="flex gap-2">
                <input
                  type="password"
                  value={passcodeInput}
                  onChange={(e) => setPasscodeInput(e.target.value)}
                  className="flex-1 px-3 sm:px-4 py-2.5 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="招待コードを入力"
                  autoComplete="one-time-code"
                />
                <button
                  type="submit"
                  className="px-4 sm:px-6 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg"
                >
                  送信
                </button>
              </form>
              {passcodeError && <p className="mt-2 text-sm text-red-400">{passcodeError}</p>}
              <p className="mt-3 text-xs text-gray-400">招待コードは運営から共有された文字列です。</p>
            </div>
          )}

          {unlocked && (
            <form onSubmit={onSubmit} className="space-y-4 sm:space-y-8">
              {/* 基本情報 */}
              <div className="bg-gray-900/60 border border-purple-500/30 rounded-2xl p-4 sm:p-6 space-y-4 sm:space-y-6">
                <h2 className="text-lg sm:text-xl font-semibold text-white flex items-center gap-2">
                  <FaGamepad className="text-purple-400" />
                  基本情報
                </h2>

                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-2">
                    <FaUser className="inline mr-2" />
                    ハンドルネーム（公開）
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={formData.handle_name}
                      onChange={(e) => setFormData({ ...formData, handle_name: e.target.value })}
                      className={`w-full px-3 sm:px-4 py-2.5 bg-gray-800/50 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all ${
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
                        {handleNameError ? <FaExclamationCircle className="text-red-400" /> : <FaCheckCircle className="text-green-400" />}
                      </div>
                    )}
                  </div>
                  {handleNameError && <p className="mt-1 text-sm text-red-400">{handleNameError}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-2">氏名（非公開）</label>
                  <input
                    type="text"
                    required
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    className="w-full px-3 sm:px-4 py-2.5 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400"
                    placeholder="例: 山田太郎"
                  />
                </div>
              </div>

              {/* アカウント */}
              <div className="bg-gray-900/60 border border-purple-500/30 rounded-2xl p-4 sm:p-6 space-y-4 sm:space-y-6">
                <h2 className="text-lg sm:text-xl font-semibold text-white flex items-center gap-2">
                  <FaLock className="text-purple-400" />
                  アカウント情報
                </h2>

                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-2">
                    <FaEnvelope className="inline mr-2" />
                    メールアドレス（ログインに使用）
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 sm:px-4 py-2.5 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400"
                    placeholder="例: example@email.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-2">
                    <FaLock className="inline mr-2" />
                    パスワード（6文字以上）
                  </label>
                  <input
                    type="password"
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className={`w-full px-3 sm:px-4 py-2.5 bg-gray-800/50 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all ${
                      passwordError && formData.password ? 'border-red-500' : 'border-purple-500/30 focus:border-purple-400'
                    }`}
                    placeholder="パスワードを入力"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-2">
                    <FaLock className="inline mr-2" />
                    パスワード（確認）
                  </label>
                  <input
                    type="password"
                    required
                    value={formData.passwordConfirm}
                    onChange={(e) => setFormData({ ...formData, passwordConfirm: e.target.value })}
                    className={`w-full px-3 sm:px-4 py-2.5 bg-gray-800/50 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all ${
                      passwordError && formData.passwordConfirm ? 'border-red-500' : 'border-purple-500/30 focus:border-purple-400'
                    }`}
                    placeholder="パスワードを再入力"
                  />
                  {passwordError && <p className="mt-1 text-sm text-red-400">{passwordError}</p>}
                </div>
              </div>

              {/* 連絡先 + アバター */}
              <div className="bg-gray-900/60 border border-purple-500/30 rounded-2xl p-4 sm:p-6 space-y-4 sm:space-y-6">
                <h2 className="text-lg sm:text-xl font-semibold text-white flex items-center gap-2">
                  <FaPhone className="text-purple-400" />
                  連絡先情報 / アバター
                </h2>

                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-2">
                    <FaPhone className="inline mr-2" />
                    電話番号（非公開）
                  </label>
                  <input
                    type="tel"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 sm:px-4 py-2.5 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400"
                    placeholder="例: 090-1234-5678"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-2">
                    <FaMapMarkerAlt className="inline mr-2" />
                    お住まいの地域（公開：players に保存）
                  </label>
                  <select
                    required
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-3 sm:px-4 py-2.5 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400"
                  >
                    <option value="" className="bg-gray-800">選択してください</option>
                    {addressOptions.map((a) => (
                      <option key={a} value={a} className="bg-gray-800">{a}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-2 flex items-center gap-2">
                    <FaImage className="text-purple-400" />
                    アバター（任意）
                  </label>
                  <AvatarSelector
                    value={formData.avatar_url}
                    onChange={(url) => setFormData({ ...formData, avatar_url: url })}
                    pageSize={20}
                    bucket="avatars"
                    prefix="preset"
                  />
                </div>
              </div>

              {/* 同意（UI維持：管理者は未チェックでも通る） */}
              <div className="bg-gray-900/60 border border-purple-500/30 rounded-2xl p-4 sm:p-6 space-y-3">
                <label className="flex items-start cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={formData.isHighSchoolOrAbove}
                    onChange={(e) => setFormData({ ...formData, isHighSchoolOrAbove: e.target.checked })}
                    className="mr-3 mt-0.5 w-5 h-5 bg-gray-800 border-purple-500 text-purple-600 rounded focus:ring-purple-500"
                  />
                  <span className="text-sm sm:text-base text-gray-300 group-hover:text-white">私は高校生以上です</span>
                </label>

                <label className="flex items-start cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={formData.agreeToTerms}
                    onChange={(e) => setFormData({ ...formData, agreeToTerms: e.target.checked })}
                    className="mr-3 mt-0.5 w-5 h-5 bg-gray-800 border-purple-500 text-purple-600 rounded focus:ring-purple-500"
                  />
                  <span className="text-sm sm:text-base text-gray-300 group-hover:text-white">
                    <Link href="/terms" target="_blank" className="text-purple-400 hover:text-purple-300 underline">
                      利用規約
                    </Link>{' '}
                    に同意する
                  </span>
                </label>
              </div>

              <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4">
                <button
                  type="button"
                  onClick={() => router.push('/')}
                  className="px-6 sm:px-8 py-2.5 bg-gray-700 text-white rounded-xl hover:bg-gray-600"
                >
                  キャンセル
                </button>

                <button
                  type="submit"
                  disabled={
                    loading ||
                    !!handleNameError ||
                    !!passwordError ||
                    (!isAdmin && (!formData.isHighSchoolOrAbove || !formData.agreeToTerms))
                  }
                  className="px-6 sm:px-8 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <FaSpinner className="animate-spin" /> 登録中...
                    </>
                  ) : (
                    <>
                      <FaUserPlus /> 登録する
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
