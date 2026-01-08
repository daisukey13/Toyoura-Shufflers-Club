// app/(main)/register/page.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  FaUserPlus, FaUser, FaEnvelope, FaPhone, FaMapMarkerAlt,
  FaGamepad, FaCheckCircle, FaExclamationCircle,
  FaSpinner, FaLock, FaImage
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

  // ★追加：管理者の対面登録モード
  adminAssisted: boolean;
};

const addressOptions = [
  '豊浦町','洞爺湖町','壮瞥町','伊達市','室蘭市','登別市',
  '倶知安町','ニセコ町','札幌市','その他道内','内地','外国（Visitor)'
];

const DEFAULT_AVATAR = '/default-avatar.png';

// パスコード（設定されていると必須）
const PASSCODE = process.env.NEXT_PUBLIC_SIGNUP_PASSCODE || '';
const RATING_DEFAULT = Number(process.env.NEXT_PUBLIC_RATING_DEFAULT ?? 1000);
const HANDICAP_DEFAULT = Number(process.env.NEXT_PUBLIC_HANDICAP_DEFAULT ?? 30);

// ★簡易ランダム生成（外部依存なし）
function randDigits(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += String(Math.floor(Math.random() * 10));
  return s;
}
function genProxyEmail() {
  // 例: 20251231123456-123456@toyoura.online
  const stamp = new Date();
  const y = stamp.getFullYear();
  const mo = String(stamp.getMonth() + 1).padStart(2, '0');
  const d = String(stamp.getDate()).padStart(2, '0');
  const hh = String(stamp.getHours()).padStart(2, '0');
  const mm = String(stamp.getMinutes()).padStart(2, '0');
  const ss = String(stamp.getSeconds()).padStart(2, '0');
  return `${y}${mo}${d}${hh}${mm}${ss}-${randDigits(6)}@toyoura.online`;
}
function genPassword(len = 14) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ★ハンドル名の正規化（前後空白・全角空白・連続空白の吸収）
function normalizeHandleName(s: string) {
  return (s ?? '')
    .replace(/\u3000/g, ' ')     // 全角スペース→半角
    .replace(/\s+/g, ' ')       // 連続空白を1つに
    .trim();
}

export default function RegisterPage() {
  const router = useRouter();

  // ★他ページと同じ Supabase client に統一（ここが重要）
  const supabase = createClient();

  // 毎回ロックから始める（PASSCODE が空なら最初から解錠）
  const [unlocked, setUnlocked] = useState<boolean>(PASSCODE.length === 0);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeError, setPasscodeError] = useState<string | null>(null);

  // 以前の実装の残骸を掃除（自動スキップを防止）
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
    adminAssisted: false, // ★追加
  });

  const [loading, setLoading] = useState(false);
  const [handleNameError, setHandleNameError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [checkingHandleName, setCheckingHandleName] = useState(false);

  // ★管理者判定
  const [adminChecking, setAdminChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminNote, setAdminNote] = useState<string | null>(null);

  // ★対面登録で作ったログイン情報（表示用）
  const [createdCreds, setCreatedCreds] = useState<{ email: string; password: string } | null>(null);

  // ---- helpers -------------------------------------------------------------

  /**
   * ✅ ハンドル重複チェック（最小強化）
   * - is_deleted=false のみ対象
   * - handle_name は正規化して比較
   */
  async function ensureHandleUnique(handleRaw: string) {
    const handle = normalizeHandleName(handleRaw);
    if (!handle) return true;

    const { data, error } = await supabase
      .from('players')
      .select('id')
      .eq('is_deleted', false)
      .eq('handle_name', handle)
      .limit(1)
      .maybeSingle();

    if (error) {
      if (process.env.NODE_ENV !== 'production') console.warn('[ensureHandleUnique]', error.message);
      // エラー時は「一旦OK扱い」にして入力を止めない（送信時にDB側で弾かれる）
      return true;
    }
    return !data;
  }

  /**
   * ✅ 途中失敗で players だけ残った場合の自動クリーンアップ（再発防止の本命）
   * - 登録処理の途中で失敗したら、その userId の players を論理削除して handle を解放する
   * - RLS 等で失敗する可能性はあるが、できる範囲で実行する（失敗してもメインのエラーは返す）
   */
  async function cleanupPartialPlayer(userId: string) {
    try {
      await supabase
        .from('players')
        .update({ is_deleted: true, is_active: false } as any)
        .eq('id', userId);
    } catch {
      // ignore（RLS 等で更新不可でも、ログイン側の運用で救済できる）
    }
  }

  // ★管理者チェック：ログイン中ユーザー → players.is_admin or metadata を確認
  useEffect(() => {
    let alive = true;
    (async () => {
      setAdminChecking(true);
      setAdminNote(null);
      try {
        const { data: ures, error: uerr } = await supabase.auth.getUser();
        if (uerr) throw uerr;

        const u = ures.user;
        if (!u) {
          if (!alive) return;
          setIsAdmin(false);
          setAdminNote('管理者チェック: 未ログイン');
          return;
        }

        // まず metadata 側を軽く見る（あれば即OK）
        const metaIsAdmin =
          Boolean((u.user_metadata as any)?.is_admin) ||
          Boolean((u.app_metadata as any)?.is_admin) ||
          (u.app_metadata as any)?.role === 'admin';

        if (metaIsAdmin) {
          if (!alive) return;
          setIsAdmin(true);
          setAdminNote('管理者ログイン中（metadata判定）');
          return;
        }

        // players テーブルから is_admin を確認
        const { data, error } = await supabase
          .from('players')
          .select('is_admin')
          .eq('id', u.id)
          .maybeSingle();

        if (error) {
          if (!alive) return;
          setIsAdmin(false);
          setAdminNote(`管理者チェック失敗: ${error.message}`);
          return;
        }

        const ok = Boolean((data as any)?.is_admin);
        if (!alive) return;
        setIsAdmin(ok);
        setAdminNote(ok ? '管理者ログイン中' : '管理者ではありません');
      } catch (e: any) {
        if (!alive) return;
        setIsAdmin(false);
        setAdminNote(e?.message ?? '管理者チェックに失敗しました');
      } finally {
        if (!alive) return;
        setAdminChecking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  useEffect(() => {
    const handle = normalizeHandleName(formData.handle_name);
    if (!handle || handle.length < 3) {
      setHandleNameError('');
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      setCheckingHandleName(true);
      const ok = await ensureHandleUnique(handle);
      if (!active) return;
      setHandleNameError(ok ? '' : 'このハンドルネームは既に使用されています');
      setCheckingHandleName(false);
    }, 450);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [formData.handle_name]);

  // ★adminAssisted のときはパスワード検証をスキップ
  useEffect(() => {
    if (formData.adminAssisted) {
      setPasswordError('');
      return;
    }
    if (formData.password && formData.password.length < 6) {
      setPasswordError('パスワードは6文字以上で設定してください');
    } else if (formData.passwordConfirm && formData.password !== formData.passwordConfirm) {
      setPasswordError('パスワードが一致しません');
    } else {
      setPasswordError('');
    }
  }, [formData.password, formData.passwordConfirm, formData.adminAssisted]);

  // パスコード送信
  const onSubmitPasscode = (e: React.FormEvent<HTMLFormElement>) => {
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

  // 登録送信
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!unlocked) return;

    if (!formData.isHighSchoolOrAbove) {
      alert('高校生以上の方のみ登録可能です。');
      return;
    }
    if (!formData.agreeToTerms) {
      alert('利用規約に同意してください。');
      return;
    }
    if (handleNameError) {
      alert('入力内容を確認してください。');
      return;
    }
    // ★通常登録のみパスワードエラーをチェック
    if (!formData.adminAssisted && passwordError) {
      alert('入力内容を確認してください。');
      return;
    }
    // ★対面登録は管理者必須
    if (formData.adminAssisted && (adminChecking || !isAdmin)) {
      alert('管理者ログインが確認できないため、対面登録モードは利用できません。');
      return;
    }

    setLoading(true);
    setCreatedCreds(null);

    // ★途中失敗のクリーンアップ用
    let createdUserId: string | null = null;
    let insertedPlayers = false;

    try {
      const handle = normalizeHandleName(formData.handle_name);

      if (!handle) {
        alert('ハンドルネームを入力してください。');
        return;
      }

      const uniqueNow = await ensureHandleUnique(handle);
      if (!uniqueNow) {
        setHandleNameError('このハンドルネームは既に使用されています');
        alert('このハンドルネームは既に使用されています。別の名前を選んでください。');
        return;
      }

      // ★対面登録時は email/password を自動生成
      const email = formData.adminAssisted ? genProxyEmail() : formData.email.trim();
      const password = formData.adminAssisted ? genPassword() : formData.password.trim();

      // ★対面登録: もし signUp でセッションが新規ユーザーに切り替わっても戻せるように退避
      const { data: s0 } = await supabase.auth.getSession();
      const adminTokens =
        formData.adminAssisted && s0.session
          ? { access_token: s0.session.access_token, refresh_token: s0.session.refresh_token }
          : null;

      // 1) Auth ユーザー作成
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { handle_name: handle, full_name: formData.full_name } },
      });
      if (authError || !authData?.user) throw authError ?? new Error('ユーザー作成に失敗しました');

      const userId = authData.user.id;
      createdUserId = userId;

      // 2) 公開 players
      const publicRow = {
        id: userId,
        auth_user_id: userId, // ✅ 追加（紐付けを明確化）
        user_id: userId,      // ✅ 追加（互換のため）
        handle_name: handle,  // ✅ 正規化済み
        avatar_url: formData.avatar_url || DEFAULT_AVATAR,
        address: formData.address || '未設定',
        is_admin: false,
        is_active: true,
        is_deleted: false,    // ✅ 明示
        ranking_points: RATING_DEFAULT,
        handicap: HANDICAP_DEFAULT,
        matches_played: 0,
        wins: 0,
        losses: 0,
      };
      {
        const { error } = await supabase.from('players').insert(publicRow as any);
        if (error) throw error;
        insertedPlayers = true;
      }

      // 3) 非公開 players_private（主キー候補を順に試行）
      const tryKeys: Array<'player_id' | 'id' | 'user_id' | 'auth_user_id'> = ['player_id', 'id', 'user_id', 'auth_user_id'];
      let saved = false, lastErr: any = null;
      for (const key of tryKeys) {
        const base: Record<string, any> = {
          [key]: userId,
          full_name: formData.full_name,
          email,
          phone: formData.phone.trim(),
        };
        const { error } = await supabase.from('players_private').upsert(base, { onConflict: key } as any);
        if (!error) { saved = true; break; }
        lastErr = error;
        if (!/does not exist|no unique|exclusion|schema cache/i.test(String(error?.message))) {
          break;
        }
      }
      if (!saved && lastErr) throw lastErr;

      // ★対面登録: 管理者セッションへ戻す（自動ログインが発生した場合の対策）
      if (formData.adminAssisted && adminTokens) {
        const { data: uNow } = await supabase.auth.getUser();
        if (uNow.user && uNow.user.email === email) {
          const { error: se } = await supabase.auth.setSession(adminTokens);
          if (se) console.warn('[admin restore] failed:', se.message);
        }
      }

      if (formData.adminAssisted) {
        setCreatedCreds({ email, password });
        alert('対面登録が完了しました（ログイン情報を画面下に表示しました）。');
        // そのまま続けて登録したい場合が多いので、画面は残す（UI維持）
        // 必要なら admin/dashboard へ飛ばす場合はここを router.replace('/admin/dashboard') に
        return;
      }

      alert('プレイヤー登録が完了しました！確認メールをご確認ください。');
      router.replace(`/players/${userId}`);
    } catch (err: any) {
      const msg = String(err?.message || err);

      // ✅ 途中で players まで作れたのに失敗した場合は、handle を解放する（再発防止）
      if (createdUserId && insertedPlayers) {
        await cleanupPartialPlayer(createdUserId);
      }

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
      if (/row-level security|RLS/i.test(msg)) hint = '\n（Supabase の RLS で INSERT/UPDATE 許可ポリシーを確認してください）';
      if (/does not exist|schema|relation .* does not exist|column .* does not exist/i.test(msg)) hint = '\n（テーブル/カラム名がスキーマと一致しているか確認してください）';
      alert(`登録中にエラーが発生しました。\n詳細: ${msg}${hint}`);
      console.error('[register] submit error:', err);
    } finally {
      setLoading(false);
    }
  };

  // ---- UI ------------------------------------------------------------------

  const adminAssistDisabled = adminChecking || !isAdmin;

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
          <h1 className="text-2xl sm:text-4xl font-bold text白 mb-2 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            新規プレイヤー登録
          </h1>
          <p className="text-sm sm:text-base text-gray-300">豊浦シャッフラーズクラブへようこそ</p>
        </div>

        <div className="max-w-3xl mx-auto">
          {/* パスコード（ロック時のみ表示） */}
          {!unlocked && (
            <div className="bg-gray-900/60 border border-purple-500/30 rounded-2xl p-4 sm:p-6 mb-4 sm:mb-6">
              <h2 className="text-lg sm:text-xl font-semibold text-white flex items-center gap-2 mb-3">
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

          {/* 登録フォーム（解錠後のみ描画） */}
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
                <h2 className="text-lg sm:text-xl font-semibold text白 flex items-center gap-2">
                  <FaLock className="text-purple-400" />
                  アカウント情報
                </h2>

                {/* ★追加：管理者の対面登録 */}
                <div className="p-3 rounded-xl border border-purple-500/20 bg-purple-900/20">
                  <label className="flex items-start cursor-pointer gap-3">
                    <input
                      type="checkbox"
                      checked={formData.adminAssisted}
                      disabled={adminAssistDisabled}
                      onChange={(e) =>
                        setFormData((v) => ({
                          ...v,
                          adminAssisted: e.target.checked,
                          // 対面ONにしたら入力不要項目を一旦クリア（UIはそのまま）
                          ...(e.target.checked
                            ? { email: '', password: '', passwordConfirm: '' }
                            : {}),
                        }))
                      }
                      className="mt-1 w-5 h-5 bg-gray-800 border-purple-500 text-purple-600 rounded focus:ring-purple-500 disabled:opacity-50"
                    />
                    <div className="min-w-0">
                      <div className="text-sm sm:text-base text-gray-200">
                        管理者が対面で登録する（メールアドレス無しプレーヤー）
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {adminChecking ? (
                          <span className="inline-flex items-center gap-2">
                            <FaSpinner className="animate-spin" /> 管理者ログイン状態を確認中…
                          </span>
                        ) : isAdmin ? (
                          <span className="text-green-300">管理者ログイン中：チェック可能です</span>
                        ) : (
                          <span className="text-yellow-300">
                            管理者ログインが確認できないため無効（{adminNote ?? '不明'}）
                          </span>
                        )}
                      </div>
                      {formData.adminAssisted && isAdmin && (
                        <div className="mt-2 text-xs text-gray-300">
                          メール/パスワードは自動生成されます（@toyoura.online）。
                        </div>
                      )}
                    </div>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-2">
                    <FaEnvelope className="inline mr-2" />
                    メールアドレス（ログインに使用）
                  </label>
                  <input
                    type="email"
                    required={!formData.adminAssisted}
                    disabled={formData.adminAssisted}
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 sm:px-4 py-2.5 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400 disabled:opacity-50"
                    placeholder={formData.adminAssisted ? '（対面登録モードでは自動生成されます）' : '例: example@email.com'}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-2">
                    <FaLock className="inline mr-2" />
                    パスワード（6文字以上）
                  </label>
                  <input
                    type="password"
                    required={!formData.adminAssisted}
                    disabled={formData.adminAssisted}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className={`w-full px-3 sm:px-4 py-2.5 bg-gray-800/50 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all disabled:opacity-50 ${
                      passwordError && formData.password ? 'border-red-500' : 'border-purple-500/30 focus:border-purple-400'
                    }`}
                    placeholder={formData.adminAssisted ? '（自動生成）' : 'パスワードを入力'}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-2">
                    <FaLock className="inline mr-2" />
                    パスワード（確認）
                  </label>
                  <input
                    type="password"
                    required={!formData.adminAssisted}
                    disabled={formData.adminAssisted}
                    value={formData.passwordConfirm}
                    onChange={(e) => setFormData({ ...formData, passwordConfirm: e.target.value })}
                    className={`w-full px-3 sm:px-4 py-2.5 bg-gray-800/50 border rounded-lg text白 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all disabled:opacity-50 ${
                      passwordError && formData.passwordConfirm ? 'border-red-500' : 'border-purple-500/30 focus:border-purple-400'
                    }`}
                    placeholder={formData.adminAssisted ? '（自動生成）' : 'パスワードを再入力'}
                  />
                  {!formData.adminAssisted && passwordError && <p className="mt-1 text-sm text-red-400">{passwordError}</p>}
                </div>

                {/* ★対面登録で作った資格情報を表示 */}
                {createdCreds && (
                  <div className="p-3 rounded-xl border border-green-500/30 bg-green-500/10 text-sm text-gray-200">
                    <div className="font-semibold text-green-200 mb-1">対面登録のログイン情報（記録用）</div>
                    <div className="text-xs text-gray-300 break-all">Email: {createdCreds.email}</div>
                    <div className="text-xs text-gray-300 break-all">Password: {createdCreds.password}</div>
                  </div>
                )}
              </div>

              {/* 連絡先 + アバター */}
              <div className="bg-gray-900/60 border border-purple-500/30 rounded-2xl p-4 sm:p-6 space-y-4 sm:space-y-6">
                <h2 className="text-lg sm:text-xl font-semibold text白 flex items-center gap-2">
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
                    className="w-full px-3 sm:px-4 py-2.5 bg-gray-800/50 border border-purple-500/30 rounded-lg text白 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400"
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
                    className="w-full px-3 sm:px-4 py-2.5 bg-gray-800/50 border border-purple-500/30 rounded-lg text白 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400"
                  >
                    <option value="" className="bg-gray-800">選択してください</option>
                    {addressOptions.map((a) => (
                      <option key={a} value={a} className="bg-gray-800">{a}</option>
                    ))}
                  </select>
                </div>

                {/* アバター選択（Supabase Storageからページング） */}
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

              {/* 同意 */}
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
                    <Link href="/terms" target="_blank" className="text-purple-400 hover:text-purple-300 underline">利用規約</Link> に同意する
                  </span>
                </label>
              </div>

              {/* ボタン */}
              <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4">
                <button
                  type="button"
                  onClick={() => router.push('/')}
                  className="px-6 sm:px-8 py-2.5 bg-gray-700 text白 rounded-xl hover:bg-gray-600"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={
                    loading ||
                    !!handleNameError ||
                    (!formData.adminAssisted && !!passwordError) ||
                    !formData.isHighSchoolOrAbove ||
                    !formData.agreeToTerms ||
                    (formData.adminAssisted && (adminChecking || !isAdmin))
                  }
                  className="px-6 sm:px-8 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text白 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? (<><FaSpinner className="animate-spin" /> 登録中...</>) : (<><FaUserPlus /> 登録する</>)}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
