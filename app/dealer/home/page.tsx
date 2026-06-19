'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
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
  const t = useTranslations('dealer.home')
  const [pendingCount, setPendingCount] = useState(0)
  const [postponedCount, setPostponedCount] = useState(0)
  const [paymentCount, setPaymentCount] = useState(0)
  const [promotedCount, setPromotedCount] = useState(0)
  // 2026-06-06 — Per-tile counts so the dashboard surfaces a live
  // signal at a glance, not just a static "what's in here" label.
  // 2026-06-19 — Seed Orders tile removed; Packing tile replaces it.
  // Packing count mirrors the unified /dealer/orders Packing pill:
  // regular orders with approved items not yet shared/handed over +
  // seed orders parked at READY_FOR_PICKUP awaiting handover.
  const [packingCount, setPackingCount] = useState(0)
  const [dealershipCount, setDealershipCount] = useState(0)
  const [alertCount, setAlertCount] = useState(0)
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
      // 2026-06-06 — Pending count now spans BOTH regular input
      // orders AND seed orders so the dealer has one mental model
      // instead of a siloed Seed Orders tile. Same terminal-state
      // filter for both feeds (COMPLETED / CANCELLED / EXPIRED for
      // inputs; PURCHASED / CANCELLED / REJECTED / REROUTED for
      // seeds — the seed lifecycle's terminal equivalents).
      // 2026-06-18 — NOT_AVAILABLE means the dealer bounced the seed
      // order back to the farmer; no further work on this side. Must
      // match the filter on `app/dealer/seed-orders/page.tsx` so the
      // tile count agrees with the Active tab the dealer sees when
      // they tap in.
      const SEED_TERMINAL = ['PURCHASED', 'CANCELLED', 'REJECTED', 'REROUTED', 'NOT_AVAILABLE']
      const INPUT_TERMINAL = ['COMPLETED', 'CANCELLED', 'EXPIRED']
      let regularPending = 0
      let seedPending = 0
      const setBoth = () => setPendingCount(regularPending + seedPending)
      // 2026-06-19 — Packing count is "regular orders that need a
      // packing-list action" + "seed orders awaiting handover", same
      // predicate as `subBelongsTo('packing')` on /dealer/orders.
      let regularPacking = 0
      let seedPacking = 0
      const setPacking = () => setPackingCount(regularPacking + seedPacking)
      Promise.all([
        api.get<{ onboarded: boolean; client_count: number }>('/dealer/me/onboarding-status')
          .then(r => setOnboardingClientCount(r.data.client_count))
          .catch(() => setOnboardingClientCount(0)),
        api.get('/dealer/orders').then(r => {
          const rows = r.data as { status: string; item_status_counts?: { approved?: number }; packing_list_removed_at?: string | null; packing_farmer_received_at?: string | null }[]
          regularPending = rows.filter(o => !INPUT_TERMINAL.includes(o.status)).length
          regularPacking = rows.filter(o =>
            (o.item_status_counts?.approved ?? 0) > 0
            && !o.packing_list_removed_at
            && !o.packing_farmer_received_at
          ).length
          setBoth()
          setPacking()
        }).catch(() => {}),
        api.get('/dealer/seed-orders').then(r => {
          const rows = r.data as { status: string }[]
          seedPending = rows.filter(o => !SEED_TERMINAL.includes(o.status)).length
          seedPacking = rows.filter(o => o.status === 'READY_FOR_PICKUP').length
          setBoth()
          setPacking()
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
        // 2026-06-06 — Dealerships: no category param → all rows.
        // Alerts: promoter incoming-alerts is shared across the
        // Promoter / Facilitator / Dealer dashboards (see
        // project_rootstalk_promoter_alerts).
        api.get('/dealer/dealerships').then(r => {
          setDealershipCount((r.data as unknown[]).length)
        }).catch(() => {}),
        api.get('/promoter/me/incoming-alerts').then(r => {
          setAlertCount((r.data as unknown[]).length)
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
          <p className="text-xl font-bold text-[#6B3F1F]">{t('greetingMorning')}{user?.name ? t('greetingNameSuffix', { name: user.name.split(' ')[0] }) : ''}</p>
          <p className="text-[#7A8C7E] text-sm mt-0.5">
            {notOnboarded
              ? t('awaitingOnboarding')
              : pendingCount > 0 ? t('ordersWaiting', { count: pendingCount }) : t('noPendingOrders')}
          </p>
        </div>

        {/* Lifecycle gate (V1.1 Item 5): not onboarded by any company →
            show explanatory empty state instead of the action tiles.
            The user keeps full access to their profile and dealerships
            screens so they can finish setup while waiting. */}
        {notOnboarded && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-base font-bold text-amber-900 mb-2">{t('onboardingTitle')}</p>
            <p className="text-sm text-amber-800 leading-relaxed">
              {t('onboardingBody')}
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => router.push('/dealer/profile')}
                className="flex-1 py-2.5 rounded-xl border border-amber-300 bg-white text-sm font-semibold text-amber-900">
                {t('reviewProfile')}
              </button>
              <button onClick={() => router.push('/dealer/dealerships')}
                className="flex-1 py-2.5 rounded-xl border border-amber-300 bg-white text-sm font-semibold text-amber-900">
                {t('myDealershipsBtn')}
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
              <p className="text-sm opacity-80">{t('pendingOrders')}</p>
              <p className="text-4xl font-bold mt-1">{loading ? '—' : pendingCount}</p>
            </div>
            <span className="text-5xl opacity-30">📦</span>
          </div>
          {pendingCount > 0 && (
            <p className="text-xs opacity-70 mt-2">{t('tapToProcess')}</p>
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
                <p className="text-sm opacity-80">{t('postponedItems')}</p>
                <p className="text-4xl font-bold mt-1">{postponedCount}</p>
              </div>
              <span className="text-5xl opacity-30">⏰</span>
            </div>
            <p className="text-xs opacity-70 mt-2">{t('tapToResolve')}</p>
          </button>
        )}

        {/* Payment requests badge */}
        {paymentCount > 0 && (
          <button onClick={() => router.push('/dealer/payments')}
            className="w-full bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between active:scale-98 transition-transform">
            <div>
              <p className="font-semibold text-amber-800">{t('paymentRequests')}</p>
              <p className="text-xs text-amber-600 mt-0.5">{t('farmersWaiting', { count: paymentCount })}</p>
            </div>
            <span className="bg-amber-500 text-white text-sm font-bold w-7 h-7 rounded-full flex items-center justify-center">
              {paymentCount}
            </span>
          </button>
        )}

        {/* Quick actions grid */}
        {/* 2026-06-19 — Tile order reorganised + Seed Orders replaced
            by Packing. Row 1: Alerts | Packing. Row 2: Payments |
            My Farmers. Row 3: Shop details | My dealerships. Each
            tile now shows a clean top-right corner count (no badge,
            no background) so the dealer reads task-load at a glance
            without visual noise. Loading shows '…'. */}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => router.push('/dealer/alerts-incoming')}
            className="relative bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left">
            <span className="absolute top-3 right-4 text-base font-bold text-[#085041]">
              {loading ? '…' : alertCount}
            </span>
            <span className="text-2xl">🔔</span>
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">{t('tiles.alertsIncoming')}</p>
            <p className="text-xs text-[#7A8C7E]">{t('tiles.alertsSubtitle')}</p>
          </button>
          <button onClick={() => router.push('/dealer/orders?pill=packing')}
            className="relative bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left">
            <span className="absolute top-3 right-4 text-base font-bold text-[#085041]">
              {loading ? '…' : packingCount}
            </span>
            <span className="text-2xl">📦</span>
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">{t('tiles.packing')}</p>
            <p className="text-xs text-[#7A8C7E]">{t('tiles.packingSubtitle')}</p>
          </button>
          <button onClick={() => router.push('/dealer/payments')}
            className="relative bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left">
            <span className="absolute top-3 right-4 text-base font-bold text-[#085041]">
              {loading ? '…' : paymentCount}
            </span>
            <span className="text-2xl">💳</span>
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">{t('tiles.payments')}</p>
            <p className="text-xs text-[#7A8C7E]">{t('tiles.paymentsSubtitle')}</p>
          </button>
          <button onClick={() => router.push('/dealer/promoted-farmers')}
            className="relative bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left">
            <span className="absolute top-3 right-4 text-base font-bold text-[#085041]">
              {loading ? '…' : promotedCount}
            </span>
            <span className="text-2xl">👨‍🌾</span>
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">{t('tiles.myFarmers')}</p>
            <p className="text-xs text-[#7A8C7E]">{t('tiles.myFarmersSubtitle')}</p>
          </button>
          <button onClick={() => router.push('/dealer/profile')}
            className="relative bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left">
            <svg className="w-6 h-6 text-[#085041]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z"/>
            </svg>
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">{t('tiles.shopDetails')}</p>
            <p className="text-xs text-[#7A8C7E]">{t('tiles.whatYouSell')}</p>
          </button>
          <button onClick={() => router.push('/dealer/dealerships')}
            className="relative bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left">
            <span className="absolute top-3 right-4 text-base font-bold text-[#085041]">
              {loading ? '…' : dealershipCount}
            </span>
            <span className="text-2xl">🏭</span>
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">{t('tiles.myDealerships')}</p>
            <p className="text-xs text-[#7A8C7E]">{t('tiles.myDealershipsSubtitle')}</p>
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
