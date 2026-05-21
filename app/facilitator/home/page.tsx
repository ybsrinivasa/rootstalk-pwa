'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser } from '@/lib/auth'
import BottomNav from '@/components/layout/BottomNav'
import ExitGuard from '@/components/ExitGuard'
import api from '@/lib/api'

const COLOUR = '#7D4E00'

export default function FacilitatorHomePage() {
  const router = useRouter()
  const user = getUser()
  const [pendingCount, setPendingCount] = useState(0)
  const [paymentCount, setPaymentCount] = useState(0)
  const [promotedCount, setPromotedCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    // Gate: declaration not yet confirmed = bounce to profile page.
    if (!user?.facilitator_declared_at) {
      router.replace('/facilitator/profile')
      return
    }
    Promise.all([
      api.get('/facilitator/orders').then(r => {
        const active = (r.data as { status: string }[]).filter(o =>
          !['COMPLETED', 'CANCELLED'].includes(o.status)
        )
        setPendingCount(active.length)
      }).catch(() => {}),
      api.get('/facilitator/payment-requests').then(r => {
        setPaymentCount((r.data as { status: string }[]).filter(p => p.status === 'PENDING').length)
      }).catch(() => {}),
      api.get('/facilitator/promoted-farmers').then(r => {
        setPromotedCount((r.data as unknown[]).length)
      }).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      {/* Ochre header */}
      <div className="sticky top-0 z-30 px-4 py-3 flex items-center justify-between"
        style={{ background: COLOUR }}>
        <div>
          <p className="text-white text-xs font-medium opacity-70">Acting as</p>
          <p className="text-white font-bold">Facilitator</p>
        </div>
        <p className="text-white text-sm font-medium">{user?.name || ''}</p>
      </div>

      <div className="pb-24 px-4 pt-4 space-y-4 max-w-lg mx-auto">
        <div>
          <p className="text-xl font-bold text-[#6B3F1F]">Good morning{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</p>
          <p className="text-[#7A8C7E] text-sm mt-0.5">
            {pendingCount > 0 ? `${pendingCount} order${pendingCount > 1 ? 's' : ''} to process` : 'No pending orders'}
          </p>
        </div>

        {/* Pending orders CTA */}
        <button onClick={() => router.push('/facilitator/orders')}
          className="w-full rounded-2xl p-5 text-white text-left shadow-lg active:scale-98 transition-transform"
          style={{ background: `linear-gradient(135deg, #5a3800, ${COLOUR})` }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-80">Pending Orders</p>
              <p className="text-4xl font-bold mt-1">{loading ? '—' : pendingCount}</p>
            </div>
            <span className="text-5xl opacity-30">🌾</span>
          </div>
          {pendingCount > 0 && <p className="text-xs opacity-70 mt-2">Tap to process →</p>}
        </button>

        {/* Payment requests badge */}
        {paymentCount > 0 && (
          <button onClick={() => router.push('/facilitator/payments')}
            className="w-full bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="font-semibold text-amber-800">Payment Requests</p>
              <p className="text-xs text-amber-600 mt-0.5">{paymentCount} farmer subscription request{paymentCount > 1 ? 's' : ''}</p>
            </div>
            <span className="bg-amber-500 text-white text-sm font-bold w-7 h-7 rounded-full flex items-center justify-center">
              {paymentCount}
            </span>
          </button>
        )}

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => router.push('/facilitator/promoted-farmers')}
            className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left">
            <span className="text-2xl">👨‍🌾</span>
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">My Farmers</p>
            <p className="text-xs text-[#7A8C7E]">{loading ? '…' : `${promotedCount} promoted`}</p>
          </button>
          <button onClick={() => router.push('/facilitator/payments')}
            className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left">
            <span className="text-2xl">💳</span>
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">Payments</p>
            <p className="text-xs text-[#7A8C7E]">Farmer subscriptions</p>
          </button>
          <button onClick={() => router.push('/facilitator/profile')}
            className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left">
            <svg className="w-6 h-6 text-[#7D4E00]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z"/>
            </svg>
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">Service Profile</p>
            <p className="text-xs text-[#7A8C7E]">My declaration</p>
          </button>
        </div>
      </div>
      <BottomNav color={COLOUR} activeRole="FACILITATOR" />
      <ExitGuard />
    </div>
  )
}
