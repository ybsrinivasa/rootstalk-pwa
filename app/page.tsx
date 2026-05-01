'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'

export default function Root() {
  const router = useRouter()
  useEffect(() => {
    if (getToken()) router.replace('/home')
    else router.replace('/register')
  }, [router])
  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
