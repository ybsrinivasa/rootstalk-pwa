'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken, getUser, refreshUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import RoleSwitcherDrawer from '@/components/RoleSwitcherDrawer'
import ExitGuard from '@/components/ExitGuard'
import api from '@/lib/api'
import { C } from '@/lib/tokens'

type Subscription = {
  id: string; client_id: string; package_id: string
  status: string; reference_number: string | null; crop_start_date: string | null
  subscription_type?: string
  // 2026-05-20 — backend decorates each sub with the SE-authored
  // package label, the resolved crop name, and (for WAITLISTED
  // rows) who owes the payment. Drives the Home pending-payment
  // card copy + CTA shape.
  package_name?: string | null
  crop_cosh_id?: string | null
  crop_name?: string | null
  pending_payment_from?: {
    payment_request_id: string
    method: 'DELEGATE' | 'SHARE_LINK'   // V1.1 share-link 2026-05-29
    user_id: string | null              // null when method='SHARE_LINK'
    name: string | null
    phone: string | null
    role: 'DEALER' | 'FACILITATOR' | 'OTHER'
    short_url: string | null            // method='SHARE_LINK' only
    expires_at: string | null
    hours_remaining: number
  } | null
}

type ClientInfo = {
  id: string; display_name: string; primary_colour: string
  tagline: string | null; logo_url: string | null
  support_phone: string | null; website: string | null
}

interface PendingAssignment {
  subscription_id: string
  client_id: string
  package_id: string
  promoter: { name: string | null; phone: string | null }
  promoter_type: string
  created_at: string
}

function SeedlingIllustration() {
  return (
    <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
      <line x1="30" y1="52" x2="30" y2="20" stroke="#3A7D44" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M30 35 C30 25 18 18 12 22 C18 22 28 28 30 35Z" fill="#3A7D44" opacity="0.8"/>
      <path d="M30 28 C30 18 42 12 48 16 C42 16 32 22 30 28Z" fill="#3A7D44"/>
      <ellipse cx="30" cy="53" rx="8" ry="2" fill="#3A7D44" opacity="0.2"/>
    </svg>
  )
}

export default function HomePage() {
  const router = useRouter()
  const user = getUser()
  const t = useTranslations('home')
  const tCommon = useTranslations('common')
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [clientInfos, setClientInfos] = useState<Record<string, ClientInfo>>({})
  const [pendingAssignments, setPendingAssignments] = useState<PendingAssignment[]>([])
  const [assignmentClientInfos, setAssignmentClientInfos] = useState<Record<string, ClientInfo>>({})
  const [loading, setLoading] = useState(true)
  const [showRoleDrawer, setShowRoleDrawer] = useState(false)
  const [cancellingSub, setCancellingSub] = useState<string | null>(null)

  async function cancelPendingPayment(sub: Subscription) {
    if (!confirm(t('paymentPending.confirmCancelSelf'))) return
    setCancellingSub(sub.id)
    try {
      await api.put(`/farmer/subscriptions/${sub.id}/unsubscribe`)
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      // 2026-05-29: backend now refuses unsubscribe when a payment
      // request is currently PENDING. Surface the structured message
      // so the farmer knows to cancel the payment request first.
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message
      alert(msg || t('paymentPending.errorCancelSelf'))
    } finally { setCancellingSub(null) }
  }

  async function cancelDelegationRequest(sub: Subscription) {
    if (!confirm(t('paymentPending.confirmCancelDelegate'))) return
    setCancellingSub(sub.id)
    try {
      // Removes the SubscriptionPaymentRequest row; the WAITLISTED
      // subscription itself stays, switching back to self-pending.
      await api.delete(`/farmer/subscriptions/${sub.id}/delegate-payment`)
      await load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      alert(msg || t('paymentPending.errorCancelDelegate'))
    } finally { setCancellingSub(null) }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return }
    // Pull fresh /auth/me so the role-switcher drawer sees fields
    // added in recent backend deploys (dealer_profile_complete,
    // facilitator_declared_at) — legacy sessions cached before
    // those fields existed would otherwise show "Set up →" on
    // already-completed roles.
    void refreshUser()
    load()
  }, [router])

  async function load() {
    try {
      const [subsResult, pendingResult] = await Promise.allSettled([
        api.get<Subscription[]>('/farmer/my-subscriptions'),
        api.get<PendingAssignment[]>('/farmer/assignments/pending'),
      ])

      let subs: Subscription[] = []
      if (subsResult.status === 'fulfilled') {
        subs = subsResult.value.data
        setSubscriptions(subs)
      }

      let pending: PendingAssignment[] = []
      if (pendingResult.status === 'fulfilled') {
        pending = pendingResult.value.data
        setPendingAssignments(pending)
      }

      // Fetch client infos for subscriptions
      const clientIds = [...new Set(subs.map(s => s.client_id))]
      // Also fetch for pending assignments (may overlap)
      const pendingClientIds = [...new Set(pending.map(a => a.client_id))]
      const allClientIds = [...new Set([...clientIds, ...pendingClientIds])]

      const results = await Promise.allSettled(
        allClientIds.map(id => api.get<ClientInfo>(`/client/${id}/info`).then(r => ({ id, data: r.data })))
      )
      const map: Record<string, ClientInfo> = {}
      results.forEach(r => { if (r.status === 'fulfilled') map[r.value.id] = r.value.data })
      setClientInfos(map)
      setAssignmentClientInfos(map)
    } finally { setLoading(false) }
  }

  // Group ACTIVE subscriptions by client_id. WAITLISTED rows
  // (SELF-pay subs awaiting payment) get their own pending-payment
  // section above the live tiles so the farmer has a clear path
  // to finish payment.
  //
  // 2026-05-31 — Promoter-assigned subs awaiting the farmer's
  // explicit accept are no longer included in /farmer/my-subscriptions
  // at all (backend filter). The pending-approval card from
  // /farmer/assignments/pending is the only surface for them until
  // the farmer accepts.
  const grouped: Record<string, Subscription[]> = {}
  const waitlisted: Subscription[] = []
  for (const sub of subscriptions) {
    if (sub.status === 'WAITLISTED') {
      waitlisted.push(sub)
      continue
    }
    if (sub.status !== 'ACTIVE') continue
    if (!grouped[sub.client_id]) grouped[sub.client_id] = []
    grouped[sub.client_id].push(sub)
  }
  const uniqueClientIds = Object.keys(grouped)
  // Crop count for the greeting line must match the tile grid —
  // both count ACTIVE only. `subscriptions.length` includes
  // WAITLISTED / CANCELLED / LAPSED rows and produced a mismatch
  // like "1 company — 2 crops" when only one ACTIVE tile rendered.
  const activeCropCount = Object.values(grouped).reduce((n, arr) => n + arr.length, 0)

  return (
    <div className="min-h-screen" style={{ background: C.background }}>
      <PWAHeader
        activeRole="FARMER"
        onRoleSwitch={() => setShowRoleDrawer(true)}
      />

      <div className="pt-16 pb-20 px-4">
        {/* Greeting */}
        <div className="mt-4 mb-5">
          <p className="text-xl font-bold" style={{ color: C.textPrimary }}>
            {user?.name ? t('greetingNamed', { name: user.name.split(' ')[0] }) : t('greetingFallback')}
          </p>
          <p className="text-sm mt-0.5" style={{ color: C.textSecond }}>
            {uniqueClientIds.length > 0
              ? t('summary', { companies: uniqueClientIds.length, crops: activeCropCount })
              : t('noAdvisoriesYet')}
          </p>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full animate-spin"
              style={{ border: `2px solid ${C.divider}`, borderTopColor: C.primary }}/>
          </div>
        ) : (
          <>
            {/* Pending payment cards — three variants depending on
                pending_payment_from:
                  null            → self-pending (farmer pays)
                  DEALER          → waiting for that dealer
                  FACILITATOR     → waiting for that facilitator
                Each variant has appropriate copy + CTA shape so the
                farmer knows exactly what's next and who's blocking. */}
            {waitlisted.length > 0 && (
              <div className="mb-4 space-y-3">
                {waitlisted.map(sub => {
                  const info = clientInfos[sub.client_id]
                  const delegate = sub.pending_payment_from
                  const isSelfPending = !delegate
                  const isShareLink = delegate?.method === 'SHARE_LINK'
                  const cropLabel = sub.crop_name || (sub.crop_cosh_id ? '' : '')
                  const cardLabel = [info?.display_name, cropLabel].filter(Boolean).join(' · ')
                  const roleKey = delegate?.role === 'DEALER' ? 'dealer'
                    : delegate?.role === 'FACILITATOR' ? 'facilitator'
                    : 'helper'
                  const roleLabel = t(`paymentPending.role.${roleKey}`)
                  const delegateName = delegate?.name || t('paymentPending.fallbackDelegate')

                  return (
                    <div key={sub.id}
                      className="rounded-2xl p-4 border"
                      style={{ background: C.accent + '1A', borderColor: C.accent + '44' }}>
                      <div className="flex items-start gap-3 mb-3">
                        <span className="text-lg leading-none mt-0.5">⏳</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-[15px]" style={{ color: C.textPrimary }}>
                            {t('paymentPending.title')}
                          </p>
                          <p className="text-[13px] mt-0.5 leading-relaxed" style={{ color: C.textPrimary, opacity: 0.85 }}>
                            {t('paymentPending.reservedPrefix')} <span className="font-semibold">{cardLabel || t('paymentPending.fallbackLabel')}</span> {t('paymentPending.reservedSuffix')}{' '}
                            {isSelfPending
                              ? t('paymentPending.selfBody')
                              : isShareLink
                                ? t('paymentPending.linkBody')
                                : <>{t('paymentPending.delegateBodyPrefix')} <span className="font-semibold">{delegateName}</span> ({roleLabel}) {t('paymentPending.delegateBodySuffix')}</>
                            }
                          </p>
                          {!isSelfPending && (
                            <div className="mt-2 flex items-center justify-between gap-2">
                              {/* DELEGATE: phone chip; SHARE_LINK: 🔗 chip. */}
                              {!isShareLink && delegate?.phone ? (
                                <a href={`tel:${delegate.phone}`}
                                  className="inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1 rounded-full"
                                  style={{ background: '#fff', color: C.accent, border: `1px solid ${C.accent}66` }}>
                                  📞 {delegate.phone}
                                </a>
                              ) : isShareLink ? (
                                <span className="inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1 rounded-full"
                                  style={{ background: '#fff', color: C.accent, border: `1px solid ${C.accent}66` }}>
                                  {t('paymentPending.linkChip')}
                                </span>
                              ) : <span />}
                              {typeof delegate?.hours_remaining === 'number' && (
                                <span className="text-[11px] font-medium"
                                  style={{ color: delegate.hours_remaining <= 6 ? '#B85C00' : C.textSecond }}>
                                  {delegate.hours_remaining === 0
                                    ? t('paymentPending.expiringSoon')
                                    : t('paymentPending.hoursRemaining', { hours: delegate.hours_remaining })}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {isSelfPending ? (
                        <>
                          <button
                            onClick={() => router.push(`/subscribe?resume=${sub.id}`)}
                            className="w-full py-2.5 rounded-xl text-white font-bold text-sm"
                            style={{ background: C.accent, minHeight: 48 }}>
                            {t('paymentPending.completeCta')}
                          </button>
                          {(sub.subscription_type === 'SELF' || !sub.subscription_type) && (
                            <button
                              onClick={() => cancelPendingPayment(sub)}
                              disabled={cancellingSub === sub.id}
                              className="w-full mt-2 py-2 text-xs"
                              style={{ color: C.textSecond }}>
                              {cancellingSub === sub.id ? tCommon('cancelling') : t('paymentPending.cancelSub')}
                            </button>
                          )}
                        </>
                      ) : isShareLink ? (
                        <>
                          {/* SHARE_LINK variant — primary CTA goes
                              straight to the share screen so the
                              farmer can re-show the QR to whoever's
                              paying. */}
                          <button
                            onClick={() => router.push(`/share-link/${delegate!.payment_request_id}`)}
                            className="w-full py-2.5 rounded-xl text-white font-bold text-sm"
                            style={{ background: C.accent, minHeight: 48 }}>
                            {t('paymentPending.shareLinkCta')}
                          </button>
                          <button
                            onClick={() => cancelDelegationRequest(sub)}
                            disabled={cancellingSub === sub.id}
                            className="w-full mt-2 py-2 text-xs"
                            style={{ color: C.textSecond }}>
                            {cancellingSub === sub.id ? tCommon('working') : t('paymentPending.cancelLink')}
                          </button>
                          <p className="mt-1 text-[11px] text-center" style={{ color: C.textSecond, opacity: 0.7 }}>
                            {t('paymentPending.cancelLinkNote')}
                          </p>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => router.push(`/subscribe?resume=${sub.id}`)}
                            className="w-full py-2.5 rounded-xl text-white font-bold text-sm"
                            style={{ background: C.accent, minHeight: 48 }}>
                            {t('paymentPending.payMyselfCta')}
                          </button>
                          {/* 2026-05-29: cancel-and-route — while the
                              payment is pending with someone else,
                              the only teardown action is "Cancel
                              request". The farmer can cancel the
                              subscription itself only after the
                              request is cleared (backend enforces
                              the same guard with HTTP 409). */}
                          <button
                            onClick={() => cancelDelegationRequest(sub)}
                            disabled={cancellingSub === sub.id}
                            className="w-full mt-2 py-2 text-xs"
                            style={{ color: C.textSecond }}>
                            {cancellingSub === sub.id ? tCommon('working') : t('paymentPending.cancelRequest')}
                          </button>
                          <p className="mt-1 text-[11px] text-center" style={{ color: C.textSecond, opacity: 0.7 }}>
                            {t('paymentPending.cancelRequestNote')}
                          </p>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Pending assignment banners — shown above company tiles */}
            {pendingAssignments.length > 0 && (
              <div className="mb-4 space-y-3">
                {pendingAssignments.map(assignment => {
                  const clientInfo = assignmentClientInfos[assignment.client_id]
                  const colour = clientInfo?.primary_colour || C.primary
                  const initials = (clientInfo?.display_name || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                  const promoterLabel = assignment.promoter_type === 'DEALER'
                    ? t('assignment.promoterLabel.dealer')
                    : t('assignment.promoterLabel.facilitator')
                  const promoterName = assignment.promoter.name || t('assignment.fallbackName')

                  return (
                    <div key={assignment.subscription_id}
                      className="rounded-2xl p-4 mb-3"
                      style={{ background: C.primarySoft, border: `1px solid ${C.primary}33` }}>
                      <div className="flex items-start gap-3 mb-3">
                        {clientInfo?.logo_url ? (
                          <img src={clientInfo.logo_url} alt={clientInfo.display_name}
                            className="w-10 h-10 rounded-full object-contain p-1 shrink-0"
                            style={{ background: C.cardBg, border: `1px solid ${C.primary}33` }}/>
                        ) : (
                          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                            style={{ background: colour, border: `1px solid ${C.primary}33` }}>
                            <span className="text-xs font-bold text-white">{initials}</span>
                          </div>
                        )}
                        <div className="flex-1">
                          <p className="font-semibold text-[15px]" style={{ color: C.textPrimary }}>{t('assignment.title')}</p>
                          <p className="text-[13px] mt-0.5 leading-relaxed" style={{ color: C.textPrimary, opacity: 0.85 }}>
                            {promoterLabel} <span className="font-semibold">{promoterName}</span> {t('assignment.bodyMiddle')}{' '}
                            <span className="font-semibold">{clientInfo?.display_name || t('assignment.fallbackCompany')}</span>{t('assignment.bodySuffix')}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => router.push(`/assignment/${assignment.subscription_id}`)}
                        className="w-full py-2.5 rounded-xl text-white font-bold text-sm"
                        style={{ background: C.primary, minHeight: 48 }}>
                        {t('assignment.cta')}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {uniqueClientIds.length === 0 && pendingAssignments.length === 0 && waitlisted.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center py-16">
                <SeedlingIllustration/>
                <p className="font-semibold text-lg mt-4" style={{ color: C.textPrimary }}>{t('empty.title')}</p>
                <p className="text-sm text-center mt-2 max-w-[240px]" style={{ color: C.textSecond }}>
                  {t('empty.body')}
                </p>
                <button
                  onClick={() => router.push('/subscribe')}
                  className="mt-6 py-3.5 px-8 rounded-2xl text-white font-bold"
                  style={{ background: C.primary, minHeight: 48 }}>
                  {t('empty.cta')}
                </button>
              </div>
            ) : (
              /* Company tiles + persistent "Subscribe to another"
                 CTA below. Pre-fix the Subscribe button only
                 rendered in the empty-state branch, so once a
                 farmer had ANY pending or active sub there was no
                 affordance to subscribe to a second crop / second
                 company. */
              <div className="space-y-3">
                {uniqueClientIds.map(clientId => {
                  const subs = grouped[clientId]
                  const info = clientInfos[clientId]
                  const colour = info?.primary_colour || C.primary
                  const needsStartDate = subs.some(s => !s.crop_start_date)
                  const initials = (info?.display_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

                  return (
                    <button key={clientId}
                      onClick={() => router.push(`/home/${clientId}`)}
                      className="w-full rounded-2xl overflow-hidden shadow-sm text-left active:scale-[0.98] transition-transform"
                      style={{ background: C.cardBg, border: `1px solid ${C.divider}` }}>

                      {/* Branded header — keeps the client's brand
                          colour. RootsTalk Crop Green only as the
                          default fallback. */}
                      <div className="px-4 py-4 flex items-center gap-3" style={{ background: colour }}>
                        {info?.logo_url ? (
                          <img src={info.logo_url} alt={info.display_name}
                            className="w-9 h-9 rounded-full object-contain p-1 shrink-0"
                            style={{ background: C.cardBg }}/>
                        ) : (
                          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                            style={{ background: C.cardBg, color: colour }}>
                            <span className="text-xs font-bold">{initials}</span>
                          </div>
                        )}
                        <p className="text-white font-bold text-base flex-1">
                          {info?.display_name || tCommon('loading')}
                        </p>
                        {needsStartDate && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold ml-auto shrink-0"
                            style={{ background: C.accent, color: 'white' }}>
                            {t('tile.setStartDate')}
                          </span>
                        )}
                      </div>

                      {/* Card body */}
                      {info?.tagline && (
                        <p className="text-[14px] px-4 py-2" style={{ color: C.textPrimary, opacity: 0.85 }}>{info.tagline}</p>
                      )}
                      <p className="text-xs px-4 pb-3 pt-1" style={{ color: C.textSecond }}>
                        {t('tile.cropsSubscribed', { count: subs.length })}
                      </p>
                    </button>
                  )
                })}

                {/* Subscribe-to-another CTA. Sits below the tile
                    list so it's always reachable even when the
                    farmer already has pending or active subs. */}
                <button
                  onClick={() => router.push('/subscribe')}
                  className="w-full mt-2 py-3.5 rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2"
                  style={{
                    background: 'transparent',
                    border: `2px dashed ${C.primary}66`,
                    color: C.primary,
                    minHeight: 48,
                  }}>
                  {t('subscribeAnother')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <BottomNav color={C.primary}/>

      <RoleSwitcherDrawer
        open={showRoleDrawer}
        onClose={() => setShowRoleDrawer(false)}
        onSwitch={() => setShowRoleDrawer(false)}
        activeRole="FARMER"
      />

      {/* Device back from the root Home triggers the close-app
          confirm; detail screens are unaffected (their back is
          intercepted by Next router for one-step navigation). */}
      <ExitGuard />
    </div>
  )
}
