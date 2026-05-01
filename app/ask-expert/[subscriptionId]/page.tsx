'use client'
import { useState, FormEvent } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

const SEVERITY_OPTIONS = [
  { value: 'CRITICAL', label: 'Critical', desc: 'Severe damage visible, urgent action needed' },
  { value: 'HIGH', label: 'High', desc: 'Significant impact, needs prompt attention' },
  { value: 'MODERATE', label: 'Moderate', desc: 'Some concern but crop is managing' },
  { value: 'LOW', label: 'Low', desc: 'Minor issue or general question' },
]

export default function AskExpertPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const [form, setForm] = useState({
    title: '',
    description: '',
    crop_age: '',
    severity: 'MODERATE',
  })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!getToken()) { router.replace('/register'); return }
    setSubmitting(true); setError('')
    try {
      // We need client_id — get it from the subscription
      const { data: subs } = await api.get<{ id: string; client_id: string; crop_cosh_id?: string }[]>('/farmer/my-subscriptions')
      const sub = subs.find(s => s.id === subscriptionId)
      if (!sub) throw new Error('Subscription not found')

      await api.post('/farmer/queries', {
        subscription_id: subscriptionId,
        client_id: sub.client_id,
        crop_cosh_id: sub.crop_cosh_id,
        ...form,
      })
      setDone(true)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Failed to submit query.')
    } finally { setSubmitting(false) }
  }

  if (done) return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 text-center">
      <span className="text-5xl mb-4">✅</span>
      <h1 className="text-xl font-bold text-slate-900">Query submitted!</h1>
      <p className="text-slate-500 text-sm mt-2 max-w-xs">
        A FarmPundit expert has been assigned. They have 7 days to respond. You'll be notified when they reply.
      </p>
      <button onClick={() => router.push('/home')}
        className="mt-6 w-full max-w-xs py-3.5 rounded-2xl text-white font-semibold"
        style={{ background: '#1A5C2A' }}>
        Back to Home
      </button>
      <button onClick={() => router.push('/orders')}
        className="mt-2 w-full max-w-xs py-3.5 rounded-2xl border border-slate-200 text-slate-600 font-medium text-sm">
        View My Queries
      </button>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Ask an Expert" activeRole="FARMER" />
      <div className="pt-16 pb-20 px-4">
        <div className="mt-4 mb-5">
          <p className="text-lg font-bold text-slate-900">Describe your crop issue</p>
          <p className="text-slate-400 text-sm mt-0.5">A FarmPundit expert will respond within 7 days</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-100 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Issue Title <span className="text-red-500">*</span></label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                required placeholder="e.g. Yellow spots on leaves, Stem borer, Poor germination…"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Crop Age</label>
              <input value={form.crop_age} onChange={e => setForm(f => ({ ...f, crop_age: e.target.value }))}
                placeholder="e.g. 45 DAS, 3 weeks after transplanting"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Describe in detail (optional)</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={4} placeholder="When did it start? Which part of the plant? How much of the field is affected?"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none resize-none" />
            </div>
          </div>

          {/* Severity */}
          <div className="bg-white rounded-2xl p-5 border border-slate-100">
            <p className="text-sm font-medium text-slate-700 mb-3">How urgent is this? <span className="text-red-500">*</span></p>
            <div className="space-y-2">
              {SEVERITY_OPTIONS.map(s => (
                <label key={s.value} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${form.severity === s.value ? 'border-green-500 bg-green-50' : 'border-transparent bg-slate-50'}`}>
                  <input type="radio" name="severity" value={s.value}
                    checked={form.severity === s.value}
                    onChange={() => setForm(f => ({ ...f, severity: s.value }))} className="sr-only" />
                  <div>
                    <p className="text-sm font-medium text-slate-800">{s.label}</p>
                    <p className="text-xs text-slate-400">{s.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-xl">{error}</p>}

          <button type="submit" disabled={!form.title || submitting}
            className="w-full py-4 rounded-2xl text-white font-semibold disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #065f46, #1A5C2A)' }}>
            {submitting ? 'Submitting…' : 'Submit to Expert →'}
          </button>
          <p className="text-center text-xs text-slate-400">
            Your query is shared with the company's FarmPundit experts. Response within 7 days.
          </p>
        </form>
      </div>
    </div>
  )
}
