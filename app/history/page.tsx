'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'

export default function HistoryPage() {
  const router = useRouter()
  useEffect(() => { if (!getToken()) router.replace('/register') }, [router])

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="History" activeRole="FARMER" />
      <div className="pt-16 pb-20 px-4">
        <div className="mt-8 text-center py-16">
          <span className="text-4xl">📋</span>
          <p className="text-slate-800 font-medium mt-3">Advisory History</p>
          <p className="text-slate-400 text-sm mt-1">Completed seasons and past practices will appear here</p>
        </div>
      </div>
      <BottomNav color="#1A5C2A" />
    </div>
  )
}
