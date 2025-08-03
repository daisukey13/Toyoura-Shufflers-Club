'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    // メール確認後、ログインページにリダイレクト
    router.push('/login')
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">メールアドレスが確認されました</h1>
        <p>ログインページにリダイレクトします...</p>
      </div>
    </div>
  )
}
