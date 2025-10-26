// app/(main)/terms/page.tsx

import {
  FaScroll,
  FaShieldAlt,
  FaUserCheck,
  FaLock,
  FaExclamationTriangle,
  FaGamepad,
  FaGavel,
  FaBalanceScale,
  FaCalendarAlt,
} from "react-icons/fa";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#2a2a3e] text-white">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* ヘッダー */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="p-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full">
              <FaScroll className="text-3xl text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
            利用規約
          </h1>
          <p className="text-gray-400">
            豊浦シャッフラーズクラブ ランキングシステム
          </p>
        </div>

        <div className="bg-gray-900/60 backdrop-blur-md rounded-2xl border border-purple-500/30 p-8 space-y-8">
          {/* 第1条 */}
          <section className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20 hover:border-purple-400/40 transition-all">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <FaShieldAlt className="text-purple-400 text-xl" />
              </div>
              <h2 className="text-2xl font-bold text-purple-300">
                第1条（目的）
              </h2>
            </div>
            <p className="text-gray-300 leading-relaxed">
              本規約は、テーブルシャッフルボード日本ランキングシステム（以下「本サービス」といいます）の利用に関する条件を定めるものです。
              利用者は、本規約に同意した上で本サービスを利用するものとします。
            </p>
          </section>

          {/* 第2条 */}
          <section className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20 hover:border-purple-400/40 transition-all">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <FaUserCheck className="text-blue-400 text-xl" />
              </div>
              <h2 className="text-2xl font-bold text-blue-300">
                第2条（利用登録）
              </h2>
            </div>
            <p className="text-gray-300 leading-relaxed">
              利用登録を希望する者は、本規約に同意の上、当社の定める方法によって利用登録を申請し、
              当社がこれを承認することによって、利用登録が完了するものとします。
            </p>
          </section>

          {/* 第3条 */}
          <section className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20 hover:border-purple-400/40 transition-all">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <FaLock className="text-green-400 text-xl" />
              </div>
              <h2 className="text-2xl font-bold text-green-300">
                第3条（個人情報の取り扱い）
              </h2>
            </div>
            <p className="text-gray-300 mb-4 leading-relaxed">
              本サービスでは、以下の情報を収集・管理します：
            </p>
            <div className="space-y-3 mb-4">
              <div className="flex items-start gap-3 bg-gray-700/30 rounded-lg p-3">
                <span className="text-green-400 mt-1">▸</span>
                <div>
                  <span className="text-green-300 font-medium">公開情報：</span>
                  <span className="text-gray-300">
                    ハンドルネーム、アバター画像、地域、ランキング情報、試合結果
                  </span>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-gray-700/30 rounded-lg p-3">
                <span className="text-yellow-400 mt-1">▸</span>
                <div>
                  <span className="text-yellow-300 font-medium">
                    非公開情報：
                  </span>
                  <span className="text-gray-300">
                    氏名、メールアドレス、電話番号
                  </span>
                </div>
              </div>
            </div>
            <p className="text-gray-300 bg-gray-700/30 rounded-lg p-3 border-l-4 border-green-500">
              非公開情報は、サービス運営に必要な場合のみ使用し、第三者に提供することはありません。
            </p>
          </section>

          {/* 第4条 */}
          <section className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20 hover:border-purple-400/40 transition-all">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-500/20 rounded-lg">
                <FaExclamationTriangle className="text-red-400 text-xl" />
              </div>
              <h2 className="text-2xl font-bold text-red-300">
                第4条（禁止事項）
              </h2>
            </div>
            <p className="text-gray-300 mb-4 leading-relaxed">
              利用者は、以下の行為を行ってはなりません：
            </p>
            <ul className="space-y-2">
              {[
                "虚偽の情報を登録する行為",
                "他の利用者になりすます行為",
                "本サービスの運営を妨害する行為",
                "他の利用者に対する誹謗中傷行為",
                "その他、当社が不適切と判断する行為",
              ].map((item, index) => (
                <li
                  key={index}
                  className="flex items-center gap-3 text-gray-300 bg-red-900/20 rounded-lg p-2 border border-red-500/20"
                >
                  <span className="text-red-400">✗</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          {/* 第5条 */}
          <section className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20 hover:border-purple-400/40 transition-all">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-yellow-500/20 rounded-lg">
                <FaGamepad className="text-yellow-400 text-xl" />
              </div>
              <h2 className="text-2xl font-bold text-yellow-300">
                第5条（試合結果の登録）
              </h2>
            </div>
            <p className="text-gray-300 leading-relaxed">
              試合結果は正確に登録するものとし、虚偽の結果を登録した場合は、
              アカウントの停止等の措置を取る場合があります。
            </p>
          </section>

          {/* 第6条 */}
          <section className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20 hover:border-purple-400/40 transition-all">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-orange-500/20 rounded-lg">
                <FaGavel className="text-orange-400 text-xl" />
              </div>
              <h2 className="text-2xl font-bold text-orange-300">
                第6条（免責事項）
              </h2>
            </div>
            <p className="text-gray-300 leading-relaxed">
              本サービスの利用により生じた損害について、当社は一切の責任を負いません。
              ただし、当社に故意または重大な過失がある場合を除きます。
            </p>
          </section>

          {/* 第7条 */}
          <section className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20 hover:border-purple-400/40 transition-all">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-cyan-500/20 rounded-lg">
                <FaScroll className="text-cyan-400 text-xl" />
              </div>
              <h2 className="text-2xl font-bold text-cyan-300">
                第7条（規約の変更）
              </h2>
            </div>
            <p className="text-gray-300 leading-relaxed">
              当社は、必要と判断した場合には、利用者に通知することなく本規約を変更することができるものとします。
              変更後の規約は、本サービス上に掲示された時点から効力を生じるものとします。
            </p>
          </section>

          {/* 第8条 */}
          <section className="bg-gray-800/50 rounded-xl p-6 border border-purple-500/20 hover:border-purple-400/40 transition-all">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-indigo-500/20 rounded-lg">
                <FaBalanceScale className="text-indigo-400 text-xl" />
              </div>
              <h2 className="text-2xl font-bold text-indigo-300">
                第8条（準拠法・管轄裁判所）
              </h2>
            </div>
            <p className="text-gray-300 leading-relaxed">
              本規約の解釈にあたっては、日本法を準拠法とします。
              本サービスに関して紛争が生じた場合には、当社の本店所在地を管轄する裁判所を専属的合意管轄とします。
            </p>
          </section>

          {/* 日付情報 */}
          <div className="mt-8 pt-6 border-t border-purple-500/30">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <FaCalendarAlt className="text-purple-400" />
              <div>
                <p>制定日：2025年8月1日</p>
                <p>最終更新日：2025年8月1日</p>
              </div>
            </div>
          </div>
        </div>

        {/* 同意ボタン（必要に応じて） */}
        <div className="text-center mt-8">
          <p className="text-gray-400 text-sm">
            プレイヤー登録時に本規約への同意が必要です
          </p>
        </div>
      </div>
    </div>
  );
}
