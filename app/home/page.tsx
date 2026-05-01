'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser, logout } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

type Subscription = {
  id: string; client_id: string; package_id: string
  status: string; reference_number: string | null; crop_start_date: string | null
}

type ClientBranding = {
  display_name: string; primary_colour: string; tagline: string | null; logo_url: string | null
}

export default function HomePage() {
  const router = useRouter()
  const user = getUser()
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [brandings, setBrandings] = useState<Record<string, ClientBranding>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [router])

  async function load() {
    try {
      const { data } = await api.get<Subscription[]>('/farmer/my-subscriptions')
      setSubscriptions(data)
      // Fetch branding for each unique client
      const clientIds = [...new Set(data.map(s => s.client_id))]
      const results = await Promise.allSettled(
        clientIds.map(id => api.get<ClientBranding>(`/portal/${id}/branding`).then(r => ({ id, data: r.data })))
      )
      const map: Record<string, ClientBranding> = {}
      results.forEach(r => { if (r.status === 'fulfilled') map[r.value.id] = r.value.data })
      setBrandings(map)
    } finally { setLoading(false) }
  }

  const activeCount = subscriptions.filter(s => s.status === 'ACTIVE').length

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="RootsTalk" activeRole="FARMER" />

      <div className="pt-16 pb-20 px-4">
        {/* Greeting */}
        <div className="mt-4 mb-5">
          <p className="text-xl font-bold text-slate-900">
            {user?.name ? `Welcome, ${user.name.split(' ')[0]}` : 'Welcome'}
          </p>
          <p className="text-slate-500 text-sm mt-0.5">
            {activeCount > 0
              ? `${activeCount} active advisory${activeCount > 1 ? 's' : ''}`
              : 'No active advisories yet'}
          </p>
        </div>

        {/* Company tiles */}
        {loading
          ? <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="h-28 bg-white rounded-2xl animate-pulse border border-slate-100" />
            ))}
          </div>
          : subscriptions.length === 0
            ? (
              <div className="bg-white rounded-2xl p-6 text-center border border-slate-100">
                <div className="text-4xl mb-3">🌱</div>
                <p className="font-medium text-slate-800">No advisories yet</p>
                <p className="text-slate-400 text-sm mt-1">Your agri-advisory will appear here once assigned</p>
              </div>
            )
            : subscriptions.map(sub => {
              const b = brandings[sub.client_id]
              const colour = b?.primary_colour || '#1A5C2A'
              const hasStartDate = !!sub.crop_start_date
              return (
                <button key={sub.id}
                  onClick={() => router.push(`/advisory/${sub.id}`)}
                  className="w-full mb-3 rounded-2xl overflow-hidden border border-slate-100 shadow-sm active:scale-98 transition-transform text-left">
                  {/* Branded header */}
                  <div className="px-4 py-3 flex items-center justify-between"
                    style={{ background: colour }}>
                    <div>
                      <p className="text-white font-semibold text-sm">{b?.display_name || 'Loading…'}</p>
                      {b?.tagline && <p className="text-white text-xs opacity-70">{b.tagline}</p>}
                    </div>
                    {hasStartDate
                      ? <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">Active</span>
                      : <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">Set start date</span>
                    }
                  </div>
                  {/* Card body */}
                  <div className="bg-white px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-400">Advisory</p>
                      <p className="text-sm font-medium text-slate-700">{sub.reference_number || 'Not yet active'}</p>
                    </div>
                    <span className="text-slate-300 text-xl">›</span>
                  </div>
                </button>
              )
            })
        }

        {/* Quick actions */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            onClick={() => router.push('/orders')}
            className="bg-white rounded-2xl p-4 border border-slate-100 text-left shadow-sm">
            <span className="text-2xl">📦</span>
            <p className="text-sm font-medium text-slate-800 mt-2">My Orders</p>
            <p className="text-xs text-slate-400">Track your input orders</p>
          </button>
          <button
            onClick={() => router.push('/profile')}
            className="bg-white rounded-2xl p-4 border border-slate-100 text-left shadow-sm">
            <span className="text-2xl">👤</span>
            <p className="text-sm font-medium text-slate-800 mt-2">Profile</p>
            <p className="text-xs text-slate-400">Settings and roles</p>
          </button>
        </div>
      </div>

      <BottomNav color="#1A5C2A" />
    </div>
  )
}
