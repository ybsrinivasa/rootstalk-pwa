'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser } from '@/lib/auth'
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
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [clientInfos, setClientInfos] = useState<Record<string, ClientInfo>>({})
  const [pendingAssignments, setPendingAssignments] = useState<PendingAssignment[]>([])
  const [assignmentClientInfos, setAssignmentClientInfos] = useState<Record<string, ClientInfo>>({})
  const [loading, setLoading] = useState(true)
  const [showRoleDrawer, setShowRoleDrawer] = useState(false)
  const [cancellingSub, setCancellingSub] = useState<string | null>(null)

  async function cancelPendingPayment(sub: Subscription) {
    if (!confirm('Cancel this pending-payment subscription? You can subscribe again later.')) return
    setCancellingSub(sub.id)
    try {
      await api.put(`/farmer/subscriptions/${sub.id}/unsubscribe`)
      // Refetch so the cancelled row disappears.
      await load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      alert(msg || 'Could not cancel. Please try again.')
    } finally { setCancellingSub(null) }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return }
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
  // (subscription created but payment not completed) get their own
  // section above the live tiles so the farmer has a clear path
  // to finish payment — pre-fix they rendered identically to live
  // advisories and confused users into thinking they were active.
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
            {user?.name ? `Welcome, ${user.name.split(' ')[0]}` : 'Welcome'}
          </p>
          <p className="text-sm mt-0.5" style={{ color: C.textSecond }}>
            {uniqueClientIds.length > 0
              ? `${uniqueClientIds.length} compan${uniqueClientIds.length > 1 ? 'ies' : 'y'} — ${subscriptions.length} crop${subscriptions.length > 1 ? 's' : ''}`
              : 'No active advisories yet'}
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
            {/* Pending payment banners — subscriptions the farmer
                created but didn't complete payment on. Each gets
                its own card with a Complete payment CTA back into
                the Subscribe flow's payment stage. */}
            {waitlisted.length > 0 && (
              <div className="mb-4 space-y-3">
                {waitlisted.map(sub => {
                  const info = clientInfos[sub.client_id]
                  return (
                    <div key={sub.id}
                      className="rounded-2xl p-4 border"
                      style={{ background: C.accent + '1A', borderColor: C.accent + '44' }}>
                      <div className="flex items-start gap-3 mb-3">
                        <span className="text-lg leading-none mt-0.5">⏳</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-[15px]" style={{ color: C.textPrimary }}>
                            Payment pending
                          </p>
                          <p className="text-[13px] mt-0.5" style={{ color: C.textPrimary, opacity: 0.85 }}>
                            Your{info?.display_name ? ` ${info.display_name}` : ''} subscription is reserved.
                            Complete payment to activate the advisory.
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => router.push('/subscribe')}
                        className="w-full py-2.5 rounded-xl text-white font-bold text-sm"
                        style={{ background: C.accent, minHeight: 48 }}>
                        Complete payment →
                      </button>
                      {/* Cancel link — small, muted, sits below
                          the primary CTA. Only shown for SELF
                          subs (the only ones the unsubscribe
                          endpoint will accept). */}
                      {(sub.subscription_type === 'SELF' || !sub.subscription_type) && (
                        <button
                          onClick={() => cancelPendingPayment(sub)}
                          disabled={cancellingSub === sub.id}
                          className="w-full mt-2 py-2 text-xs"
                          style={{ color: C.textSecond }}>
                          {cancellingSub === sub.id ? 'Cancelling…' : 'Cancel this subscription'}
                        </button>
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
                  const promoterLabel = assignment.promoter_type === 'DEALER' ? 'Dealer' : 'Facilitator'
                  const promoterName = assignment.promoter.name || 'Someone'

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
                          <p className="font-semibold text-[15px]" style={{ color: C.textPrimary }}>Advisory assignment request</p>
                          <p className="text-[13px] mt-0.5 leading-relaxed" style={{ color: C.textPrimary, opacity: 0.85 }}>
                            {promoterLabel} <span className="font-semibold">{promoterName}</span> wants to subscribe you to{' '}
                            <span className="font-semibold">{clientInfo?.display_name || 'a company'}</span>&apos;s advisory for your crops.
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => router.push(`/assignment/${assignment.subscription_id}`)}
                        className="w-full py-2.5 rounded-xl text-white font-bold text-sm"
                        style={{ background: C.primary, minHeight: 48 }}>
                        Review request →
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
                <p className="font-semibold text-lg mt-4" style={{ color: C.textPrimary }}>No advisories yet</p>
                <p className="text-sm text-center mt-2 max-w-[240px]" style={{ color: C.textSecond }}>
                  Subscribe to a company&apos;s advisory to get started
                </p>
                <button
                  onClick={() => router.push('/subscribe')}
                  className="mt-6 py-3.5 px-8 rounded-2xl text-white font-bold"
                  style={{ background: C.primary, minHeight: 48 }}>
                  Subscribe now →
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
                          {info?.display_name || 'Loading…'}
                        </p>
                        {needsStartDate && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold ml-auto shrink-0"
                            style={{ background: C.accent, color: 'white' }}>
                            Set start date
                          </span>
                        )}
                      </div>

                      {/* Card body */}
                      {info?.tagline && (
                        <p className="text-[14px] px-4 py-2" style={{ color: C.textPrimary, opacity: 0.85 }}>{info.tagline}</p>
                      )}
                      <p className="text-xs px-4 pb-3 pt-1" style={{ color: C.textSecond }}>
                        {subs.length} crop{subs.length > 1 ? 's' : ''} subscribed
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
                  + Subscribe to another advisory
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
