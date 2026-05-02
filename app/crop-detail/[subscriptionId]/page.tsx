'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import api from '@/lib/api'

interface SubscriptionDetail {
  id: string; status: string; crop_start_date: string | null
  reference_number: string | null; client_id: string; package_id: string
}
interface Branding {
  display_name: string; primary_colour: string; tagline: string | null; logo_url: string | null
}
interface PreStartInput {
  timeline_id: string; timeline_name: string
  days_before_sowing_from: number; days_before_sowing_to: number
  practices: { id: string; l0_type: string; l1_type: string | null; l2_type: string | null }[]
}
interface MissedCount { count: number }

export default function CropDetailPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const router = useRouter()
  const [sub, setSub] = useState<SubscriptionDetail | null>(null)
  const [branding, setBranding] = useState<Branding | null>(null)
  const [preStart, setPreStart] = useState<PreStartInput[]>([])
  const [missedCount, setMissedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState('')
  const [savingDate, setSavingDate] = useState(false)
  const [showStartDate, setShowStartDate] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [subscriptionId])

  async function load() {
    try {
      const subs = await api.get<SubscriptionDetail[]>('/farmer/my-subscriptions')
      const found = subs.data.find(s => s.id === subscriptionId)
      if (!found) { router.replace('/home'); return }
      setSub(found)
      setStartDate(found.crop_start_date?.split('T')[0] || '')

      const [brandRes, preStartRes, missedRes] = await Promise.allSettled([
        api.get<Branding>(`/portal/${found.client_id}/branding`),
        api.get<PreStartInput[]>(`/farmer/subscriptions/${subscriptionId}/pre-start-inputs`),
        api.get<{ count: number } | { timeline_id: string }[]>(`/farmer/subscriptions/${subscriptionId}/missed-items`),
      ])

      if (brandRes.status === 'fulfilled') setBranding(brandRes.value.data)
      if (preStartRes.status === 'fulfilled') setPreStart(preStartRes.value.data)
      if (missedRes.status === 'fulfilled') {
        const d = missedRes.value.data
        setMissedCount(Array.isArray(d) ? d.length : (d as { count: number }).count)
      }
    } finally { setLoading(false) }
  }

  async function saveStartDate() {
    if (!startDate) return
    setSavingDate(true)
    try {
      await api.put(`/farmer/subscriptions/${subscriptionId}/start-date`, {
        crop_start_date: new Date(startDate).toISOString(),
      })
      setSub(s => s ? { ...s, crop_start_date: new Date(startDate).toISOString() } : s)
      setShowStartDate(false)
    } finally { setSavingDate(false) }
  }

  if (loading || !sub) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-green-700 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const colour = branding?.primary_colour || '#1A5C2A'
  const hasStartDate = !!sub.crop_start_date

  const pestPracticeIds = preStart.flatMap(tl =>
    tl.practices.filter(p => p.l1_type?.toLowerCase().includes('pest') || p.l2_type?.toLowerCase().includes('pest')).map(p => p.id)
  )
  const fertPracticeIds = preStart.flatMap(tl =>
    tl.practices.filter(p => p.l1_type?.toLowerCase().includes('fert') || p.l2_type?.toLowerCase().includes('fert')).map(p => p.id)
  )

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Branded header */}
      <div className="sticky top-0 z-30 px-4 pt-safe" style={{ background: colour }}>
        <div className="flex items-center gap-3 py-3">
          <button onClick={() => router.push('/home')} className="text-white opacity-70 text-xl">←</button>
          <div className="flex-1">
            <p className="text-white font-bold text-sm">{branding?.display_name || 'Loading…'}</p>
            {branding?.tagline && <p className="text-white text-xs opacity-70">{branding.tagline}</p>}
          </div>
          {sub.reference_number && (
            <p className="text-white text-xs opacity-60 font-mono">{sub.reference_number}</p>
          )}
        </div>
      </div>

      <div className="pb-28 px-4 pt-5 max-w-lg mx-auto space-y-5">
        {/* Start date */}
        {!hasStartDate ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <p className="font-bold text-amber-800">Set your crop start date</p>
            <p className="text-amber-600 text-xs mt-1">Advisory and Diagnosis unlock once you set the sowing date.</p>
            {showStartDate ? (
              <div className="mt-3 flex gap-2">
                <input type="date" value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="flex-1 border border-amber-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none" />
                <button onClick={saveStartDate} disabled={savingDate || !startDate}
                  className="px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                  style={{ background: colour }}>
                  {savingDate ? '…' : 'Set'}
                </button>
              </div>
            ) : (
              <button onClick={() => setShowStartDate(true)}
                className="mt-3 w-full py-2.5 rounded-xl text-white text-sm font-semibold"
                style={{ background: colour }}>
                Set Start Date
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">Crop start date</p>
              <p className="font-semibold text-slate-800">{new Date(sub.crop_start_date!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
            </div>
            <button onClick={() => setShowStartDate(!showStartDate)}
              className="text-xs text-slate-400 underline">change</button>
          </div>
        )}
        {showStartDate && hasStartDate && (
          <div className="bg-white rounded-2xl border border-slate-100 p-4 flex gap-2">
            <input type="date" value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none" />
            <button onClick={saveStartDate} disabled={savingDate || !startDate}
              className="px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
              style={{ background: colour }}>
              {savingDate ? '…' : 'Update'}
            </button>
          </div>
        )}

        {/* Three action tiles */}
        <div className="grid grid-cols-3 gap-3">
          {/* Advisory */}
          <button
            onClick={() => hasStartDate ? router.push(`/advisory/${subscriptionId}`) : setShowStartDate(true)}
            className={`rounded-2xl p-4 text-center border shadow-sm transition-all ${hasStartDate ? 'bg-white border-slate-100 active:scale-95' : 'bg-slate-50 border-slate-200 opacity-60'}`}>
            <span className="text-3xl block mb-2">🌿</span>
            <p className="text-xs font-bold text-slate-800">Advisory</p>
            {!hasStartDate && <p className="text-xs text-amber-600 mt-0.5">Set date first</p>}
          </button>

          {/* Diagnose */}
          <button
            onClick={() => hasStartDate ? router.push(`/advisory/${subscriptionId}/diagnose`) : setShowStartDate(true)}
            className={`rounded-2xl p-4 text-center border shadow-sm transition-all ${hasStartDate ? 'bg-white border-slate-100 active:scale-95' : 'bg-slate-50 border-slate-200 opacity-60'}`}>
            <span className="text-3xl block mb-2">🔬</span>
            <p className="text-xs font-bold text-slate-800">Diagnose</p>
            {!hasStartDate && <p className="text-xs text-amber-600 mt-0.5">Set date first</p>}
          </button>

          {/* Ask Expert — always available */}
          <button
            onClick={() => router.push(`/ask-expert/${subscriptionId}`)}
            className="bg-white rounded-2xl p-4 text-center border border-slate-100 shadow-sm active:scale-95">
            <span className="text-3xl block mb-2">🎓</span>
            <p className="text-xs font-bold text-slate-800">Ask Expert</p>
          </button>
        </div>

        {/* Missed items link */}
        {missedCount > 0 && (
          <button onClick={() => router.push(`/missed-items/${subscriptionId}`)}
            className="w-full bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <p className="text-sm text-amber-700 font-medium">
              {missedCount} missed item{missedCount > 1 ? 's' : ''} — application window passed
            </p>
            <span className="text-amber-500 text-sm">View →</span>
          </button>
        )}

        {/* Pre-Start Inputs */}
        {preStart.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-50">
              <p className="font-bold text-slate-800 text-sm">Prepare for Your Crop</p>
              <p className="text-xs text-slate-400 mt-0.5">Input requirements before sowing begins</p>
            </div>
            <div className="divide-y divide-slate-50">
              {preStart.map(tl => (
                <div key={tl.timeline_id} className="px-4 py-4">
                  <p className="text-xs font-semibold text-slate-500 mb-2">{tl.timeline_name} · {tl.days_before_sowing_from}–{tl.days_before_sowing_to} days before sowing</p>
                  <div className="space-y-2">
                    {tl.practices.map(p => (
                      <div key={p.id} className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-slate-700">{p.l2_type || p.l1_type || p.l0_type}</p>
                          <p className="text-xs text-slate-400">{p.l0_type}</p>
                        </div>
                        <button
                          onClick={() => router.push(`/order/new/${subscriptionId}?practice_ids=${p.id}&order_type=${
                            (p.l1_type || '').toLowerCase().includes('pest') ? 'PESTICIDE' :
                            (p.l1_type || '').toLowerCase().includes('fert') ? 'FERTILISER' : 'PESTICIDE'
                          }`)}
                          className="text-xs px-3 py-1.5 rounded-xl text-white font-semibold"
                          style={{ background: colour }}>
                          Order
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Seeds section */}
        <button onClick={() => router.push(`/subscribe/seed-varieties/${subscriptionId}`)}
          className="w-full bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-4 flex items-center justify-between active:scale-98 transition-transform">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🌾</span>
            <div className="text-left">
              <p className="font-semibold text-slate-800 text-sm">Seeds / Seedlings</p>
              <p className="text-xs text-slate-400">Browse and order recommended varieties</p>
            </div>
          </div>
          <span className="text-slate-300 text-xl">›</span>
        </button>
      </div>
    </div>
  )
}
