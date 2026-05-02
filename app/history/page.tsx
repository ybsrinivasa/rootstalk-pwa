'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface Subscription {
  id: string; status: string; client_id: string
  crop_start_date: string | null; reference_number: string | null
}
interface Branding { display_name: string; primary_colour: string }

export default function HistoryPage() {
  const router = useRouter()
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [brandings, setBrandings] = useState<Record<string, Branding>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<Subscription[]>('/farmer/my-subscriptions').then(async r => {
      setSubscriptions(r.data)
      const ids = [...new Set(r.data.map(s => s.client_id))]
      const results = await Promise.allSettled(ids.map(id =>
        api.get<Branding>(`/portal/${id}/branding`).then(res => ({ id, data: res.data }))
      ))
      const m: Record<string, Branding> = {}
      results.forEach(res => { if (res.status === 'fulfilled') m[res.value.id] = res.value.data })
      setBrandings(m)
    }).finally(() => setLoading(false))
  }, [])

  const active = subscriptions.filter(s => s.status === 'ACTIVE')
  const past = subscriptions.filter(s => !['ACTIVE', 'WAITLISTED'].includes(s.status))

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Crop History" activeRole="FARMER" />
      <div className="pt-16 pb-20 px-4 max-w-lg mx-auto">
        {loading ? (
          <div className="mt-4 space-y-3">{[1, 2].map(i => <div key={i} className="h-20 bg-white rounded-2xl animate-pulse" />)}</div>
        ) : subscriptions.length === 0 ? (
          <div className="text-center py-20 mt-4">
            <span className="text-4xl">📋</span>
            <p className="text-slate-500 font-medium mt-3">No crop records yet</p>
          </div>
        ) : (
          <div className="space-y-5 mt-4">
            {active.length > 0 && (
              <section>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Ongoing ({active.length})</p>
                <div className="space-y-3">
                  {active.map(sub => <SubCard key={sub.id} sub={sub} branding={brandings[sub.client_id]} router={router} />)}
                </div>
              </section>
            )}
            {past.length > 0 && (
              <section>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Completed Seasons ({past.length})</p>
                <div className="space-y-3">
                  {past.map(sub => <SubCard key={sub.id} sub={sub} branding={brandings[sub.client_id]} router={router} />)}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
      <BottomNav color="#1A5C2A" />
    </div>
  )
}

function SubCard({ sub, branding, router }: { sub: { id: string; status: string; crop_start_date: string | null; reference_number: string | null }; branding?: { display_name: string; primary_colour: string }; router: ReturnType<typeof useRouter> }) {
  const colour = branding?.primary_colour || '#1A5C2A'
  return (
    <button onClick={() => router.push(`/crop-detail/${sub.id}`)}
      className="w-full bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden text-left active:scale-98 transition-transform">
      <div className="px-4 py-2 flex items-center justify-between" style={{ background: colour + '18' }}>
        <p className="text-xs font-semibold" style={{ color: colour }}>{branding?.display_name || 'Company'}</p>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sub.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
          {sub.status}
        </span>
      </div>
      <div className="px-4 py-3 flex items-center justify-between">
        <div>
          {sub.reference_number && <p className="text-xs font-mono text-slate-500">{sub.reference_number}</p>}
          <p className="text-xs text-slate-400 mt-0.5">
            {sub.crop_start_date
              ? `Started ${new Date(sub.crop_start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
              : 'Start date not set'}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={e => { e.stopPropagation(); router.push(`/missed-items/${sub.id}`) }}
            className="text-xs text-amber-600 border border-amber-200 rounded-lg px-2 py-1">
            Missed
          </button>
          <span className="text-slate-300 text-lg">›</span>
        </div>
      </div>
    </button>
  )
}
