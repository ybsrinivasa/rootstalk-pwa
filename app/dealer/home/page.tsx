'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser, refreshUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import RoleSwitcherDrawer from '@/components/RoleSwitcherDrawer'
import BottomNav from '@/components/layout/BottomNav'
import ExitGuard from '@/components/ExitGuard'
import api from '@/lib/api'

const COLOUR = '#085041'

export default function DealerHomePage() {
  const router = useRouter()
  const user = getUser()
  const [pendingCount, setPendingCount] = useState(0)
  const [postponedCount, setPostponedCount] = useState(0)
  const [paymentCount, setPaymentCount] = useState(0)
  const [promotedCount, setPromotedCount] = useState(0)
  const [onboardingClientCount, setOnboardingClientCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [showRoleDrawer, setShowRoleDrawer] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    // Refresh /auth/me cache so the right drawer sees any newly
    // added fields (e.g. dealer_profile_complete on legacy sessions
    // that logged in before the field existed). Cheap; one fetch.
    void refreshUser()
    // Gate 1 (existing): incomplete shop profile = can't enter
    // dealer home. Profile page shows a banner explaining why the
    // redirect happened and which fields are pending.
    api.get<{ is_profile_complete: boolean }>('/dealer/profile').then(r => {
      if (!r.data.is_profile_complete) {
        router.replace('/dealer/profile')
        return
      }
      // Gate 2 (V1.1 Item 5): "must be onboarded by ≥1 client to
      // be functional". We don't bounce — instead render an
      // explanatory empty state below so the user understands
      // why the tiles aren't useful yet.
      Promise.all([
        api.get<{ onboarded: boolean; client_count: number }>('/dealer/me/onboarding-status')
          .then(r => setOnboardingClientCount(r.data.client_count))
          .catch(() => setOnboardingClientCount(0)),
        api.get('/dealer/orders').then(r => {
          const active = (r.data as { status: string }[]).filter(o =>
            !['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(o.status)
          )
          setPendingCount(active.length)
        }).catch(() => {}),
        api.get('/dealer/postponed-items').then(r => {
          setPostponedCount((r.data as unknown[]).length)
        }).catch(() => {}),
        api.get('/dealer/payment-requests').then(r => {
          setPaymentCount((r.data as { status: string }[]).filter(p => p.status === 'PENDING').length)
        }).catch(() => {}),
        api.get('/dealer/promoted-farmers').then(r => {
          setPromotedCount((r.data as unknown[]).length)
        }).catch(() => {}),
      ]).finally(() => setLoading(false))
    }).catch(() => setLoading(false))
  }, [router])

  const notOnboarded = onboardingClientCount === 0

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader activeRole="DEALER" onRoleSwitch={() => setShowRoleDrawer(true)} />

      <div className="pt-20 pb-24 px-4 space-y-4 max-w-lg mx-auto">
        {/* Greeting */}
        <div>
          <p className="text-xl font-bold text-[#6B3F1F]">Good morning{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</p>
          <p className="text-[#7A8C7E] text-sm mt-0.5">
            {notOnboarded
              ? 'Awaiting onboarding'
              : pendingCount > 0 ? `${pendingCount} order${pendingCount > 1 ? 's' : ''} waiting` : 'No pending orders'}
          </p>
        </div>

        {/* Lifecycle gate (V1.1 Item 5): not onboarded by any company →
            show explanatory empty state instead of the action tiles.
            The user keeps full access to their profile and dealerships
            screens so they can finish setup while waiting. */}
        {notOnboarded && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-base font-bold text-amber-900 mb-2">Ask a Field Manager to onboard you</p>
            <p className="text-sm text-amber-800 leading-relaxed">
              You&apos;ve set up your shop profile — well done. To start receiving farmer orders, you need to be
              onboarded by at least one RootsTalk company. Share your registered phone number with a Field
              Manager from any company you sell for. Once any one of them adds you, your tiles below will start
              showing live activity.
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => router.push('/dealer/profile')}
                className="flex-1 py-2.5 rounded-xl border border-amber-300 bg-white text-sm font-semibold text-amber-900">
                Review profile
              </button>
              <button onClick={() => router.push('/dealer/dealerships')}
                className="flex-1 py-2.5 rounded-xl border border-amber-300 bg-white text-sm font-semibold text-amber-900">
                My dealerships
              </button>
            </div>
          </div>
        )}

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

        {/* 2026-06-05 — Postponed items elevated to a primary CTA
            (same visual weight as Pending Orders) per user 2026-06-05.
            Easier-than-digging-through-orders surface so the dealer's
            second-most-frequent action lives at thumb-distance from
            the first. */}
        {postponedCount > 0 && (
          <button onClick={() => router.push('/dealer/postponed')}
            className="w-full rounded-2xl p-5 text-white text-left shadow-lg active:scale-98 transition-transform"
            style={{ background: 'linear-gradient(135deg, #b45309, #d97706)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">Postponed items</p>
                <p className="text-4xl font-bold mt-1">{postponedCount}</p>
              </div>
              <span className="text-5xl opacity-30">⏰</span>
            </div>
            <p className="text-xs opacity-70 mt-2">Tap to resolve →</p>
          </button>
        )}

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
            className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left">
            <span className="text-2xl">👨‍🌾</span>
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">My Farmers</p>
            <p className="text-xs text-[#7A8C7E]">{loading ? '…' : `${promotedCount} promoted`}</p>
          </button>
          <button onClick={() => router.push('/dealer/dealerships')}
            className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left">
            <span className="text-2xl">🏭</span>
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">My Dealerships</p>
            <p className="text-xs text-[#7A8C7E]">Manufacturer brands</p>
          </button>
          <button onClick={() => router.push('/dealer/payments')}
            className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left">
            <span className="text-2xl">💳</span>
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">Payments</p>
            <p className="text-xs text-[#7A8C7E]">Farmer subscriptions</p>
          </button>
          <button onClick={() => router.push('/dealer/seed-orders')}
            className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left">
            <span className="text-2xl">🌱</span>
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">Seed Orders</p>
            <p className="text-xs text-[#7A8C7E]">Seed and seedling</p>
          </button>
          <button onClick={() => router.push('/dealer/profile')}
            className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left">
            <svg className="w-6 h-6 text-[#085041]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z"/>
            </svg>
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">Shop Details</p>
            <p className="text-xs text-[#7A8C7E]">What you sell</p>
          </button>
          <button onClick={() => router.push('/dealer/alerts-incoming')}
            className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left">
            <span className="text-2xl">🔔</span>
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">Alerts I receive</p>
            <p className="text-xs text-[#7A8C7E]">Farmer-added + auto</p>
          </button>
        </div>
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />
      <ExitGuard />

      <RoleSwitcherDrawer
        open={showRoleDrawer}
        onClose={() => setShowRoleDrawer(false)}
        onSwitch={() => setShowRoleDrawer(false)}
        activeRole="DEALER"
      />
    </div>
  )
}
