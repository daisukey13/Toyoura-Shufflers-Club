'use client'

import { createClient } from '@/lib/supabase/client'

export default function TestConnection() {
  const testConnection = async () => {
    const supabase = createClient()
    
    try {
      const { data, error } = await supabase
        .from('players')
        .select('count')
        .limit(1)
      
      if (error) {
        console.error('接続エラー:', error)
        alert('接続エラー: ' + error.message)
      } else {
        console.log('接続成功！')
        alert('Supabaseへの接続に成功しました！')
      }
    } catch (e) {
      console.error('エラー:', e)
      alert('エラーが発生しました')
    }
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Supabase接続テスト</h1>
      <button 
        onClick={testConnection}
        className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
      >
        接続テスト
      </button>
    </div>
  )
}
