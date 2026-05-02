'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

const COLOUR = '#085041'

export default function DealerHomePage() {
  const router = useRouter()
  const user = getUser()
  const [pendingCount, setPendingCount] = useState(0)
  const [paymentCount, setPaymentCount] = useState(0)
  const [promotedCount, setPromotedCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    Promise.all([
      api.get('/dealer/orders').then(r => {
        const active = (r.data as { status: string }[]).filter(o =>
          !['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(o.status)
        )
        setPendingCount(active.length)
      }).catch(() => {}),
      api.get('/dealer/payment-requests').then(r => {
        setPaymentCount((r.data as { status: string }[]).filter(p => p.status === 'PENDING').length)
      }).catch(() => {}),
      api.get('/dealer/promoted-farmers').then(r => {
        setPromotedCount((r.data as unknown[]).length)
      }).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="sticky top-0 z-30 px-4 py-3 flex items-center justify-between"
        style={{ background: COLOUR }}>
        <div>
          <p className="text-white text-xs font-medium opacity-70">Acting as</p>
          <p className="text-white font-bold">Dealer</p>
        </div>
        <p className="text-white text-sm font-medium">{user?.name || ''}</p>
      </div>

      <div className="pb-24 px-4 pt-4 space-y-4 max-w-lg mx-auto">
        {/* Greeting */}
        <div>
          <p className="text-xl font-bold text-slate-900">Good morning{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</p>
          <p className="text-slate-500 text-sm mt-0.5">
            {pendingCount > 0 ? `${pendingCount} order${pendingCount > 1 ? 's' : ''} waiting` : 'No pending orders'}
          </p>
        </div>

        {/* Pending orders CTA */}
        <button onClick={() => router.push('/dealer/orders')}
          className="w-full rounded-2xl p-5 text-white text-left shadow-lg active:scale-98 transition-transform"
          style={{ background: `linear-gradient(135deg, #054a3a, ${COLOUR})` }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-80">Pending Orders</p>
              <p className="text-4xl font-bold mt-1">{loading ? '—' : pendingCount}</p>
            </div>
            <span className="text-5xl opacity-30">📦</span>
          </div>
          {pendingCount > 0 && (
            <p className="text-xs opacity-70 mt-2">Tap to process →</p>
          )}
        </button>

        {/* Payment requests badge */}
        {paymentCount > 0 && (
          <button onClick={() => router.push('/dealer/payments')}
            className="w-full bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between active:scale-98 transition-transform">
            <div>
              <p className="font-semibold text-amber-800">Payment Requests</p>
              <p className="text-xs text-amber-600 mt-0.5">{paymentCount} farmer{paymentCount > 1 ? 's' : ''} waiting for you to pay</p>
            </div>
            <span className="bg-amber-500 text-white text-sm font-bold w-7 h-7 rounded-full flex items-center justify-center">
              {paymentCount}
            </span>
          </button>
        )}

        {/* Quick actions grid */}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => router.push('/dealer/promoted-farmers')}
            className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm text-left">
            <span className="text-2xl">👨‍🌾</span>
            <p className="text-sm font-semibold text-slate-800 mt-2">My Farmers</p>
            <p className="text-xs text-slate-400">{loading ? '…' : `${promotedCount} promoted`}</p>
          </button>
          <button onClick={() => router.push('/dealer/dealerships')}
            className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm text-left">
            <span className="text-2xl">🏭</span>
            <p className="text-sm font-semibold text-slate-800 mt-2">My Dealerships</p>
            <p className="text-xs text-slate-400">Manufacturer brands</p>
          </button>
          <button onClick={() => router.push('/dealer/payments')}
            className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm text-left">
            <span className="text-2xl">💳</span>
            <p className="text-sm font-semibold text-slate-800 mt-2">Payments</p>
            <p className="text-xs text-slate-400">Farmer subscriptions</p>
          </button>
          <button onClick={() => router.push('/dealer/seed-orders')}
            className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm text-left">
            <span className="text-2xl">🌱</span>
            <p className="text-sm font-semibold text-slate-800 mt-2">Seed Orders</p>
            <p className="text-xs text-slate-400">Seed and seedling</p>
          </button>
          <button onClick={() => router.push('/dealer/profile')}
            className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm text-left">
            <span className="text-2xl">🏪</span>
            <p className="text-sm font-semibold text-slate-800 mt-2">Shop Profile</p>
            <p className="text-xs text-slate-400">What you sell</p>
          </button>
        </div>
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />
    </div>
  )
}
