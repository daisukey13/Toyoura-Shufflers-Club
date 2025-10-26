import Link from "next/link";
import { FaUserCheck, FaUsers, FaChevronRight } from "react-icons/fa";

export default function RegisterHubPage() {
  return (
    <div className="container mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-6 text-yellow-100">
        試合結果の登録
      </h1>
      <p className="text-gray-300 mb-8">登録する試合の種類を選んでください。</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl">
        {/* 個人戦 */}
        <Link
          href="/matches/register/singles"
          className="group glass-card rounded-xl p-6 border border-purple-500/30 hover:border-purple-400/60 transition-colors"
        >
          <div className="flex items-center gap-4">
            <div className="p-4 rounded-full bg-blue-500/20">
              <FaUserCheck className="text-2xl text-blue-300" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-yellow-100">
                個人試合を登録
              </h2>
              <p className="text-sm text-gray-400">
                原則、自分が出場した個人戦のみ登録できます（管理者は全試合可）。
              </p>
            </div>
            <FaChevronRight className="text-gray-400 group-hover:text-gray-200" />
          </div>
        </Link>

        {/* チーム戦 */}
        <Link
          href="/matches/register/teams"
          className="group glass-card rounded-xl p-6 border border-purple-500/30 hover:border-purple-400/60 transition-colors"
        >
          <div className="flex items-center gap-4">
            <div className="p-4 rounded-full bg-emerald-500/20">
              <FaUsers className="text-2xl text-emerald-300" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-yellow-100">
                チーム試合を登録
              </h2>
              <p className="text-sm text-gray-400">
                所属チームでの試合のみ登録できます（対戦相手を選んで登録）。
              </p>
            </div>
            <FaChevronRight className="text-gray-400 group-hover:text-gray-200" />
          </div>
        </Link>
      </div>
    </div>
  );
}
