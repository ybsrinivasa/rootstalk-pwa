'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken, getUser, refreshUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import RoleSwitcherDrawer from '@/components/RoleSwitcherDrawer'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

const COLOUR = '#7D4E00'

export default function FacilitatorHomePage() {
  const router = useRouter()
  const t = useTranslations('facilitator.home')
  const user = getUser()
  const [pendingCount, setPendingCount] = useState(0)
  const [paymentCount, setPaymentCount] = useState(0)
  const [promotedCount, setPromotedCount] = useState(0)
  // 2026-06-06 — Alerts shared across Promoter/Facilitator/Dealer.
  const [alertCount, setAlertCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showRoleDrawer, setShowRoleDrawer] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    // Refresh /auth/me so the drawer sees any newly-added fields
    // (e.g. facilitator_declared_at on legacy sessions). Cheap;
    // one fetch.
    void refreshUser()
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
      api.get('/promoter/me/incoming-alerts').then(r => {
        setAlertCount((r.data as unknown[]).length)
      }).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader activeRole="FACILITATOR" onRoleSwitch={() => setShowRoleDrawer(true)} />

      <div className="pt-20 pb-24 px-4 space-y-4 max-w-lg mx-auto">
        <div>
          <p className="text-xl font-bold text-[#6B3F1F]">{t('greetingPrefix')}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</p>
          <p className="text-[#7A8C7E] text-sm mt-0.5">
            {pendingCount > 0 ? t('ordersToProcess', { count: pendingCount }) : t('noPendingOrders')}
          </p>
        </div>

        {/* Pending orders CTA */}
        <button onClick={() => router.push('/facilitator/orders')}
          className="w-full rounded-2xl p-5 text-white text-left shadow-lg active:scale-98 transition-transform"
          style={{ background: `linear-gradient(135deg, #5a3800, ${COLOUR})` }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-80">{t('pendingOrdersTile')}</p>
              <p className="text-4xl font-bold mt-1">{loading ? '—' : pendingCount}</p>
            </div>
            <span className="text-5xl opacity-30">🌾</span>
          </div>
          {pendingCount > 0 && <p className="text-xs opacity-70 mt-2">{t('tapToProcess')}</p>}
        </button>

        {/* Payment requests badge */}
        {paymentCount > 0 && (
          <button onClick={() => router.push('/facilitator/payments')}
            className="w-full bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="font-semibold text-amber-800">{t('paymentRequestsTitle')}</p>
              <p className="text-xs text-amber-600 mt-0.5">{t('paymentRequestsBody', { count: paymentCount })}</p>
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
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">{t('tileMyFarmers')}</p>
            <p className="text-xs text-[#7A8C7E]">{loading ? '…' : t('tileMyFarmersHint', { count: promotedCount })}</p>
          </button>
          <button onClick={() => router.push('/facilitator/payments')}
            className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left">
            <span className="text-2xl">💳</span>
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">{t('tilePayments')}</p>
            <p className="text-xs text-[#7A8C7E]">{loading ? '…' : t('tilePaymentsHint', { count: paymentCount })}</p>
          </button>
          <button onClick={() => router.push('/facilitator/alerts-incoming')}
            className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left">
            <span className="text-2xl">🔔</span>
            <p className="text-sm font-semibold text-[#6B3F1F] mt-2">{t('tileAlerts')}</p>
            <p className="text-xs text-[#7A8C7E]">{loading ? '…' : t('tileAlertsHint', { count: alertCount })}</p>
          </button>
        </div>
      </div>
      <BottomNav color={COLOUR} activeRole="FACILITATOR" />

      <RoleSwitcherDrawer
        open={showRoleDrawer}
        onClose={() => setShowRoleDrawer(false)}
        onSwitch={() => setShowRoleDrawer(false)}
        activeRole="FACILITATOR"
      />
    </div>
  )
}
