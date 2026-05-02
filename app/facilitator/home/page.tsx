'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser } from '@/lib/auth'
import BottomNav from '@/components/layout/BottomNav'
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
    <div className="min-h-screen bg-slate-50">
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
          <p className="text-xl font-bold text-slate-900">Good morning{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</p>
          <p className="text-slate-500 text-sm mt-0.5">
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
            className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm text-left">
            <span className="text-2xl">👨‍🌾</span>
            <p className="text-sm font-semibold text-slate-800 mt-2">My Farmers</p>
            <p className="text-xs text-slate-400">{loading ? '…' : `${promotedCount} promoted`}</p>
          </button>
          <button onClick={() => router.push('/facilitator/payments')}
            className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm text-left">
            <span className="text-2xl">💳</span>
            <p className="text-sm font-semibold text-slate-800 mt-2">Payments</p>
            <p className="text-xs text-slate-400">Farmer subscriptions</p>
          </button>
        </div>
      </div>
      <BottomNav color={COLOUR} activeRole="FACILITATOR" />
    </div>
  )
}
