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
  const [loading, setLoading] = useState(true)
  const [showRoleDrawer, setShowRoleDrawer] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return }
    load()
  }, [router])

  async function load() {
    try {
      const { data } = await api.get<Subscription[]>('/farmer/my-subscriptions')
      setSubscriptions(data)
      const clientIds = [...new Set(data.map(s => s.client_id))]
      const results = await Promise.allSettled(
        clientIds.map(id => api.get<ClientInfo>(`/client/${id}/info`).then(r => ({ id, data: r.data })))
      )
      const map: Record<string, ClientInfo> = {}
      results.forEach(r => { if (r.status === 'fulfilled') map[r.value.id] = r.value.data })
      setClientInfos(map)
    } finally { setLoading(false) }
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
        ) : uniqueClientIds.length === 0 ? (
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
