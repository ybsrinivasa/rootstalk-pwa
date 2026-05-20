'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import api from '@/lib/api'

interface AssignmentDetail {
  subscription_id: string
  company: { id: string; name: string; logo_url: string | null; primary_colour: string; tagline: string | null } | null
  crop_cosh_id: string | null
  package_description: string | null
  duration_days: number | null
  package_type: string | null
  parameter_variables: { parameter: string; variable: string }[]
  promoter: { name: string | null; phone: string | null } | null
  promoter_type: string
  subscription_price: number
  paid_by_company: boolean
}

function formatCropName(coshId: string | null): string {
  if (!coshId) return 'Crop'
  return coshId.replace(/^crop_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function AssignmentReviewPage() {
  const router = useRouter()
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const [detail, setDetail] = useState<AssignmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return }
    api.get<AssignmentDetail>(`/farmer/assignments/${subscriptionId}/details`)
      .then(r => setDetail(r.data))
      .catch(() => router.replace('/home'))
      .finally(() => setLoading(false))
  }, [subscriptionId, router])

  async function respond(approved: boolean) {
    const message = approved
      ? `Subscribe to ${detail?.company?.name}'s ${formatCropName(detail?.crop_cosh_id || null)} advisory? You won't be able to unsubscribe — your company has paid for this.`
      : `Decline this advisory request from ${detail?.promoter?.name}?`
    if (!confirm(message)) return
    setBusy(true); setError('')
    try {
      await api.put(`/farmer/assignments/${subscriptionId}/respond`, { approved })
      router.replace('/home')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Could not respond. Please try again.')
    } finally { setBusy(false) }
  }

  if (loading || !detail) return (
    <div className="min-h-screen bg-[#F7F5F0] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#3A7D44] border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  const colour = detail.company?.primary_colour || '#3A7D44'
  const cropName = formatCropName(detail.crop_cosh_id)

  return (
    <div className="min-h-screen bg-[#F7F5F0]">
      {/* Branded header */}
      <div className="px-5 py-6" style={{ background: colour }}>
        <button onClick={() => router.back()} className="text-white/70 mb-3">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
          </svg>
        </button>
        <p className="text-white/70 text-xs uppercase tracking-widest">Advisory Request</p>
        <h1 className="text-white text-2xl font-bold mt-1">{detail.company?.name}</h1>
        {detail.company?.tagline && <p className="text-white/60 text-sm mt-1">{detail.company.tagline}</p>}
      </div>

      <div className="px-5 py-6 max-w-lg mx-auto pb-32">
        {/* Promoter card */}
        <div className="bg-white border border-[#DDD0B8] rounded-2xl p-4 mb-4">
          <p className="text-[#7A8C7E] text-xs uppercase tracking-widest mb-1">From your {detail.promoter_type.toLowerCase()}</p>
          <p className="font-semibold text-[#6B3F1F]">{detail.promoter?.name || 'Promoter'}</p>
          {detail.promoter?.phone && <p className="text-[#7A8C7E] text-sm font-mono">{detail.promoter.phone}</p>}
        </div>

        {/* Crop */}
        <div className="bg-white border border-[#DDD0B8] rounded-2xl p-4 mb-4">
          <p className="text-[#7A8C7E] text-xs uppercase tracking-widest mb-1">Crop</p>
          <p className="font-semibold text-[#6B3F1F] text-lg">{cropName}</p>
          {detail.duration_days && <p className="text-[#7A8C7E] text-sm mt-1">{detail.duration_days} days</p>}
        </div>

        {/* Plain-language summary */}
        {detail.parameter_variables.length > 0 && (
          <div className="bg-white border border-[#DDD0B8] rounded-2xl p-4 mb-4">
            <p className="text-[#7A8C7E] text-xs uppercase tracking-widest mb-3">For your situation</p>
            <div className="space-y-2">
              {detail.parameter_variables.map((pv, i) => (
                <div key={i} className="flex items-baseline gap-2">
                  <span className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: colour }}/>
                  <p className="text-[#6B3F1F] text-sm">
                    <span className="text-[#7A8C7E]">{pv.parameter}:</span>{' '}
                    <span className="font-medium">{pv.variable}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Description */}
        {detail.package_description && (
          <div className="bg-white border border-[#DDD0B8] rounded-2xl p-4 mb-4">
            <p className="text-[#7A8C7E] text-xs uppercase tracking-widest mb-2">About this advisory</p>
            <p className="text-[#6B3F1F] text-sm leading-relaxed">{detail.package_description}</p>
          </div>
        )}

        {/* Payment info */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
          <p className="text-emerald-800 text-sm font-medium">Paid by {detail.company?.name}</p>
          <p className="text-emerald-700 text-xs mt-1">No payment needed from you. You won&apos;t be able to unsubscribe later — your company has covered this advisory.</p>
        </div>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#DDD0B8] px-5 py-4">
        <div className="max-w-lg mx-auto flex gap-3">
          <button onClick={() => respond(false)} disabled={busy}
            className="flex-1 py-3.5 rounded-xl font-medium text-[#6B3F1F] border border-[#DDD0B8] disabled:opacity-50">
            Decline
          </button>
          <button onClick={() => respond(true)} disabled={busy}
            className="flex-1 py-3.5 rounded-xl font-semibold text-white disabled:opacity-50"
            style={{ background: colour }}>
            {busy ? 'Saving…' : 'Accept'}
          </button>
        </div>
      </div>
    </div>
  )
}
