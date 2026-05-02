'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import api from '@/lib/api'

interface TLWindow {
  timeline_id: string; timeline_name: string; from_type: string
  from_value: number; to_value: number; source: string
  practices: { id: string; l0_type: string; l1_type: string | null; l2_type: string | null; status: string }[]
}

const COLOUR = '#085041'

export default function DealerFarmerAdvisoryPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const router = useRouter()
  const [advisory, setAdvisory] = useState<{ active_timelines: TLWindow[]; farmer_name?: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get(`/farmer/advisory/today?subscription_id=${subscriptionId}`)
      .then(r => setAdvisory(r.data))
      .finally(() => setLoading(false))
  }, [subscriptionId])

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Read-only teal header */}
      <div className="sticky top-0 z-30 px-4 py-3" style={{ background: COLOUR }}>
        <div className="flex items-center justify-between">
          <button onClick={() => router.back()} className="text-white opacity-70 text-sm">← Back</button>
          <p className="text-white font-bold text-sm">Farmer Advisory</p>
          <div className="w-12" />
        </div>
        <div className="mt-1 bg-white/20 rounded-xl px-3 py-1.5 text-center">
          <p className="text-white text-xs font-medium">📖 Read-only view — you are viewing as their Promoter</p>
        </div>
      </div>

      <div className="pt-4 pb-24 px-4 max-w-lg mx-auto">
        {loading ? (
          <div className="space-y-3 mt-4">
            {[1, 2, 3].map(i => <div key={i} className="h-20 bg-white rounded-2xl animate-pulse" />)}
          </div>
        ) : !advisory || advisory.active_timelines.length === 0 ? (
          <div className="mt-12 text-center px-6">
            <span className="text-5xl">🌿</span>
            <p className="font-semibold text-slate-800 mt-4">No action recommended for today</p>
            <p className="text-slate-400 text-sm mt-2 leading-relaxed">
              We will notify you when your next recommended action is available.
            </p>
          </div>
        ) : (
          <div className="space-y-3 mt-4">
            {advisory.active_timelines.map(tl => (
              <div key={tl.timeline_id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-50">
                  <p className="font-semibold text-slate-800 text-sm">{tl.timeline_name}</p>
                  <p className="text-xs text-slate-400">{tl.source}</p>
                </div>
                <div className="divide-y divide-slate-50">
                  {tl.practices.map(p => (
                    <div key={p.id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm text-slate-700">{p.l2_type || p.l1_type || p.l0_type}</p>
                        <p className="text-xs text-slate-400">{p.l0_type}</p>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-500">
                        {p.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
