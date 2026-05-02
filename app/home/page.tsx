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

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'

type ClientBranding = {
  display_name: string; primary_colour: string; tagline: string | null; logo_url: string | null
}

export default function HomePage() {
  const router = useRouter()
  const user = getUser()
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [brandings, setBrandings] = useState<Record<string, ClientBranding>>({})
  const [loading, setLoading] = useState(true)
  const [qrSub, setQrSub] = useState<Subscription | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)

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

  async function showCropQR(sub: Subscription) {
    setQrSub(sub)
    const token = getToken()
    setQrUrl(`${API_URL}/farmer/subscriptions/${sub.id}/crop-qr`)
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
                  onClick={() => router.push(`/crop-detail/${sub.id}`)}
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
                    <div className="flex items-center gap-2">
                      {sub.reference_number && (
                        <button
                          onClick={e => { e.stopPropagation(); showCropQR(sub) }}
                          className="text-xs bg-slate-100 text-slate-500 px-2.5 py-1 rounded-lg font-medium hover:bg-slate-200"
                          title="Share crop record QR">
                          🔗 Share
                        </button>
                      )}
                      <span className="text-slate-300 text-xl">›</span>
                    </div>
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
            onClick={() => router.push('/orders/purchased')}
            className="bg-white rounded-2xl p-4 border border-slate-100 text-left shadow-sm">
            <span className="text-2xl">✅</span>
            <p className="text-sm font-medium text-slate-800 mt-2">Purchased Items</p>
            <p className="text-xs text-slate-400">Verify with QR scan</p>
          </button>
        </div>
      </div>

      <BottomNav color="#1A5C2A" />

      {/* Crop QR bottom sheet */}
      {qrSub && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setQrSub(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-6 pb-10 text-center"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-bold text-slate-800">Share Crop Record</p>
              <button onClick={() => setQrSub(null)} className="text-slate-400 text-xl">✕</button>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Anyone can scan this QR code to view your crop record. No personal contact details are shared.
            </p>
            {qrUrl && (
              <img
                src={qrUrl}
                alt="Crop QR Code"
                className="w-48 h-48 mx-auto border border-slate-100 rounded-xl"
              />
            )}
            <p className="text-sm font-mono font-semibold text-slate-700 mt-3">{qrSub.reference_number}</p>
            <p className="text-xs text-slate-400 mt-1">Subscription Reference</p>
          </div>
        </div>
      )}
    </div>
  )
}
