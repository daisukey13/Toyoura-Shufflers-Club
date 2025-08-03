import Link from 'next/link'

export default function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center mb-4">
              <div className="w-8 h-8 bg-blue-400 rounded-lg flex items-center justify-center text-gray-900 font-bold">
                S
              </div>
              <span className="ml-2 text-xl font-bold">SHUFFLEBOARD</span>
            </div>
            <p className="text-gray-400 text-sm">
              テーブル・シャッフルボードゲームの試合結果とランキングを管理するシステム
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-4">
              サイト情報
            </h3>
            <ul className="space-y-2">
              <li>
                <Link href="/about" className="text-gray-400 hover:text-white text-sm">
                  サイトについて
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-gray-400 hover:text-white text-sm">
                  利用規約
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-4">
              コミュニティ
            </h3>
            <ul className="space-y-2">
              <li>
                <Link href="/rankings" className="text-gray-400 hover:text-white text-sm">
                  ランキング
                </Link>
              </li>
              <li>
                <Link href="/players" className="text-gray-400 hover:text-white text-sm">
                  プレイヤー
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-gray-800">
          <p className="text-center text-gray-400 text-sm">
            © {currentYear} Shuffleboard Ranking System. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
