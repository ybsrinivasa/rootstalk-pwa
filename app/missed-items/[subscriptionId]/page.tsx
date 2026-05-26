'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import ClientCropChip from '@/components/ClientCropChip'
import api from '@/lib/api'

interface MissedTimeline {
  timeline_id: string; timeline_name: string; from_type: string
  from_value: number; to_value: number; window_end: string | null
  practices: { id: string; l0_type: string; l1_type: string | null; l2_type: string | null }[]
}

export default function MissedItemsPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const router = useRouter()
  const [timelines, setTimelines] = useState<MissedTimeline[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<MissedTimeline[]>(`/farmer/subscriptions/${subscriptionId}/missed-items`)
      .then(r => setTimelines(r.data))
      .finally(() => setLoading(false))
  }, [subscriptionId])

  const TYPE_BADGE: Record<string, string> = {
    INPUT: 'bg-blue-100 text-blue-700',
    NON_INPUT: 'bg-purple-100 text-purple-700',
    INSTRUCTION: 'bg-amber-100 text-amber-700',
    MEDIA: 'bg-pink-100 text-pink-700',
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Missed Items" activeRole="FARMER" back />
      <div className="pt-16">
        <ClientCropChip subscriptionId={subscriptionId} />
      </div>
      <div className="pb-24 px-4 max-w-lg mx-auto">
        {/* Warm amber banner */}
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
          <p className="text-sm text-amber-800 font-semibold">These practices have passed their application window</p>
          <p className="text-xs text-amber-600 mt-0.5">Read only — no actions available</p>
        </div>

        {loading ? (
          <div className="mt-4 space-y-3">
            {[1, 2].map(i => <div key={i} className="h-24 bg-white rounded-2xl animate-pulse" />)}
          </div>
        ) : timelines.length === 0 ? (
          <div className="text-center py-16 mt-4">
            <span className="text-4xl">✓</span>
            <p className="text-[#7A8C7E] font-medium mt-3">No missed items</p>
            <p className="text-xs text-[#7A8C7E] mt-1">All application windows are still open</p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {timelines.map(tl => (
              <div key={tl.timeline_id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
                  <p className="font-semibold text-amber-900 text-sm">{tl.timeline_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-amber-600">
                      {tl.from_type === 'DAS'
                        ? `Day ${tl.from_value}–${tl.to_value} after sowing`
                        : `${tl.from_value}–${tl.to_value} days before sowing`}
                    </p>
                    {tl.window_end && (
                      <p className="text-xs text-amber-500">
                        · Expired {new Date(tl.window_end).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                      </p>
                    )}
                  </div>
                </div>
                <div className="divide-y divide-slate-50">
                  {tl.practices.map(p => (
                    <div key={p.id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm text-[#7A8C7E] line-through">{p.l2_type || p.l1_type || p.l0_type}</p>
                        <p className="text-xs text-[#7A8C7E]">Application window passed</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_BADGE[p.l0_type] || 'bg-slate-100 text-[#7A8C7E]'}`}>
                        {p.l0_type}
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
