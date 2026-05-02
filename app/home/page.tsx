'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import RoleSwitcherDrawer from '@/components/RoleSwitcherDrawer'
import api from '@/lib/api'

type Subscription = {
  id: string; client_id: string; package_id: string
  status: string; reference_number: string | null; crop_start_date: string | null
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
      <line x1="30" y1="52" x2="30" y2="20" stroke="#1A5C2A" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M30 35 C30 25 18 18 12 22 C18 22 28 28 30 35Z" fill="#1A5C2A" opacity="0.8"/>
      <path d="M30 28 C30 18 42 12 48 16 C42 16 32 22 30 28Z" fill="#1A5C2A"/>
      <ellipse cx="30" cy="53" rx="8" ry="2" fill="#1A5C2A" opacity="0.2"/>
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
  const [respondingId, setRespondingId] = useState<string | null>(null)

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

  async function respondToAssignment(subscriptionId: string, approved: boolean) {
    setRespondingId(subscriptionId)
    try {
      await api.put(`/farmer/assignments/${subscriptionId}/respond`, { approved })
      setPendingAssignments(prev => prev.filter(a => a.subscription_id !== subscriptionId))
      if (approved) {
        // Reload subscriptions to show the newly approved one
        const { data } = await api.get<Subscription[]>('/farmer/my-subscriptions')
        setSubscriptions(data)
      }
    } catch {
      // silently ignore
    } finally {
      setRespondingId(null)
    }
  }

  // Group subscriptions by client_id
  const grouped: Record<string, Subscription[]> = {}
  for (const sub of subscriptions) {
    if (!grouped[sub.client_id]) grouped[sub.client_id] = []
    grouped[sub.client_id].push(sub)
  }
  const uniqueClientIds = Object.keys(grouped)

  return (
    <div className="min-h-screen bg-stone-50">
      <PWAHeader
        title="rootsTALK"
        activeRole="FARMER"
        onRoleSwitch={() => setShowRoleDrawer(true)}
      />

      <div className="pt-16 pb-20 px-4">
        {/* Greeting */}
        <div className="mt-4 mb-5">
          <p className="text-xl font-bold text-stone-900">
            {user?.name ? `Welcome, ${user.name.split(' ')[0]}` : 'Welcome'}
          </p>
          <p className="text-stone-400 text-sm mt-0.5">
            {uniqueClientIds.length > 0
              ? `${uniqueClientIds.length} compan${uniqueClientIds.length > 1 ? 'ies' : 'y'} — ${subscriptions.length} crop${subscriptions.length > 1 ? 's' : ''}`
              : 'No active advisories yet'}
          </p>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-stone-200 border-t-[#1A5C2A] rounded-full animate-spin"/>
          </div>
        ) : (
          <>
            {/* Pending assignment banners — shown above company tiles */}
            {pendingAssignments.length > 0 && (
              <div className="mb-4 space-y-3">
                {pendingAssignments.map(assignment => {
                  const clientInfo = assignmentClientInfos[assignment.client_id]
                  const colour = clientInfo?.primary_colour || '#1A5C2A'
                  const initials = (clientInfo?.display_name || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                  const promoterLabel = assignment.promoter_type === 'DEALER' ? 'Dealer' : 'Facilitator'
                  const promoterName = assignment.promoter.name || 'Someone'
                  const isResponding = respondingId === assignment.subscription_id

                  return (
                    <div key={assignment.subscription_id}
                      className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-3">
                      <div className="flex items-start gap-3 mb-3">
                        {clientInfo?.logo_url ? (
                          <img src={clientInfo.logo_url} alt={clientInfo.display_name}
                            className="w-10 h-10 rounded-full object-contain bg-white p-1 shrink-0 border border-green-200"/>
                        ) : (
                          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 border border-green-200"
                            style={{ background: colour }}>
                            <span className="text-xs font-bold text-white">{initials}</span>
                          </div>
                        )}
                        <div className="flex-1">
                          <p className="font-semibold text-stone-900 text-sm">Advisory assignment request</p>
                          <p className="text-stone-600 text-xs mt-0.5 leading-relaxed">
                            {promoterLabel} <span className="font-medium">{promoterName}</span> wants to subscribe you to{' '}
                            <span className="font-medium">{clientInfo?.display_name || 'a company'}</span>&apos;s advisory for your crops.
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => respondToAssignment(assignment.subscription_id, true)}
                          disabled={isResponding}
                          className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
                          style={{ background: '#1A5C2A' }}>
                          {isResponding ? 'Processing…' : 'Approve →'}
                        </button>
                        <button
                          onClick={() => respondToAssignment(assignment.subscription_id, false)}
                          disabled={isResponding}
                          className="px-5 py-2.5 rounded-xl border border-stone-300 text-stone-600 text-sm font-medium disabled:opacity-50">
                          Decline
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {uniqueClientIds.length === 0 && pendingAssignments.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center py-16">
                <SeedlingIllustration/>
                <p className="text-stone-800 font-semibold text-lg mt-4">No advisories yet</p>
                <p className="text-stone-400 text-sm text-center mt-2 max-w-[240px]">
                  Subscribe to a company&apos;s advisory to get started
                </p>
                <button
                  onClick={() => router.push('/subscribe')}
                  className="mt-6 py-3.5 px-8 rounded-2xl text-white font-medium"
                  style={{ background: '#1A5C2A' }}>
                  Subscribe now →
                </button>
              </div>
            ) : (
              /* Company tiles */
              <div className="space-y-3">
                {uniqueClientIds.map(clientId => {
                  const subs = grouped[clientId]
                  const info = clientInfos[clientId]
                  const colour = info?.primary_colour || '#1A5C2A'
                  const needsStartDate = subs.some(s => !s.crop_start_date)
                  const initials = (info?.display_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

                  return (
                    <button key={clientId}
                      onClick={() => router.push(`/home/${clientId}`)}
                      className="w-full bg-white rounded-2xl overflow-hidden shadow-sm border border-stone-100 text-left active:scale-[0.98] transition-transform">

                      {/* Branded header */}
                      <div className="px-4 py-4 flex items-center gap-3" style={{ background: colour }}>
                        {info?.logo_url ? (
                          <img src={info.logo_url} alt={info.display_name}
                            className="w-9 h-9 rounded-full object-contain bg-white p-1 shrink-0"/>
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center shrink-0"
                            style={{ color: colour }}>
                            <span className="text-xs font-bold">{initials}</span>
                          </div>
                        )}
                        <p className="text-white font-semibold text-base flex-1">
                          {info?.display_name || 'Loading…'}
                        </p>
                        {needsStartDate && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-amber-400/90 text-white font-medium ml-auto shrink-0">
                            Set start date
                          </span>
                        )}
                      </div>

                      {/* Card body */}
                      {info?.tagline && (
                        <p className="text-stone-500 text-sm px-4 py-2">{info.tagline}</p>
                      )}
                      <p className="text-stone-400 text-xs px-4 pb-3 pt-1">
                        {subs.length} crop{subs.length > 1 ? 's' : ''} subscribed
                      </p>
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      <BottomNav color="#1A5C2A"/>

      <RoleSwitcherDrawer
        open={showRoleDrawer}
        onClose={() => setShowRoleDrawer(false)}
        onSwitch={() => setShowRoleDrawer(false)}
        activeRole="FARMER"
      />
    </div>
  )
}
