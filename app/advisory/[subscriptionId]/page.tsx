'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

type Subscription = {
  id: string; package_id: string; client_id: string
  status: string; crop_start_date: string | null; reference_number: string | null
}

export default function AdvisoryPage() {
  const router = useRouter()
  const { subscriptionId } = useParams()
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [startDate, setStartDate] = useState('')
  const [savingDate, setSavingDate] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [router, subscriptionId])

  async function load() {
    try {
      const { data } = await api.get<Subscription[]>('/farmer/my-subscriptions')
      const sub = data.find(s => s.id === subscriptionId)
      if (sub) { setSubscription(sub); setStartDate(sub.crop_start_date?.split('T')[0] || '') }
    } finally { setLoading(false) }
  }

  async function saveStartDate() {
    if (!startDate) return
    setSavingDate(true)
    try {
      await api.put(`/farmer/subscriptions/${subscriptionId}/start-date`, {
        crop_start_date: new Date(startDate).toISOString()
      })
      load()
    } finally { setSavingDate(false) }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!subscription) return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-slate-400">Advisory not found</p>
    </div>
  )

  const hasStartDate = !!subscription.crop_start_date

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Advisory" activeRole="FARMER" />
      <div className="pt-16 pb-20">

        {/* Start date gate */}
        {!hasStartDate && (
          <div className="mx-4 mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <p className="font-semibold text-amber-800 text-sm mb-1">Set your crop start date</p>
            <p className="text-amber-600 text-xs mb-4">
              Your advisory will be personalised once you tell us when you sowed or planted.
            </p>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="w-full border border-amber-200 rounded-xl px-4 py-3 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 mb-3" />
            <button onClick={saveStartDate} disabled={!startDate || savingDate}
              className="w-full py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
              style={{ background: '#1A5C2A' }}>
              {savingDate ? 'Saving…' : 'Set start date'}
            </button>
          </div>
        )}

        {/* Advisory content placeholder — practices load from BL-03 dedup engine */}
        {hasStartDate && (
          <div className="px-4 mt-4 space-y-3">
            <div className="bg-white rounded-2xl p-4 border border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Current</p>
                <p className="text-xs text-slate-400">
                  Started: {new Date(subscription.crop_start_date!).toLocaleDateString()}
                </p>
              </div>
              <div className="text-center py-8">
                <span className="text-3xl">🌱</span>
                <p className="text-slate-700 font-medium mt-3">Advisory is active</p>
                <p className="text-slate-400 text-sm mt-1">
                  Practices will appear here as they become due during the crop cycle.
                </p>
                <p className="text-xs text-slate-300 mt-4">
                  Ref: {subscription.reference_number || 'Pending'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => router.push(`/advisory/${subscriptionId}/diagnose`)}
                className="bg-white rounded-2xl p-4 border border-slate-100 text-left shadow-sm">
                <span className="text-2xl">🔍</span>
                <p className="text-sm font-medium text-slate-800 mt-2">Diagnose</p>
                <p className="text-xs text-slate-400">Identify crop problems</p>
              </button>
              <button
                onClick={() => router.push(`/advisory/${subscriptionId}/ask-expert`)}
                className="bg-white rounded-2xl p-4 border border-slate-100 text-left shadow-sm">
                <span className="text-2xl">💬</span>
                <p className="text-sm font-medium text-slate-800 mt-2">Ask Expert</p>
                <p className="text-xs text-slate-400">Connect with a FarmPundit</p>
              </button>
            </div>
          </div>
        )}
      </div>
      <BottomNav color="#1A5C2A" />
    </div>
  )
}
