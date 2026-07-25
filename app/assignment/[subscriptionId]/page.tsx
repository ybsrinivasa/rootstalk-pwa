'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import api from '@/lib/api'

interface AssignmentDetail {
  subscription_id: string
  company: {
    id: string; name: string; logo_url: string | null;
    primary_colour: string; tagline: string | null;
    // 2026-07-24 — Training Sandbox marker. Drives the practice
    // banner + swaps the "Paid by" copy so the farmer understands
    // no real money is involved.
    is_training?: boolean;
  } | null
  crop_cosh_id: string | null
  /** 2026-05-31 — crop's English display name resolved server-side
   *  from Cosh, so the review screen renders "Coconut" instead of
   *  the raw UUID. Null when the crop isn't in the Cosh catalogue. */
  crop_name?: string | null
  package_name?: string | null
  package_description: string | null
  duration_days: number | null
  package_type: string | null
  parameter_variables: { parameter: string; variable: string }[]
  promoter: { name: string | null; phone: string | null } | null
  promoter_type: string
  subscription_price: number
  paid_by_company: boolean
}

function formatCropName(detail: AssignmentDetail | null): string {
  if (!detail) return 'Crop'
  if (detail.crop_name) return detail.crop_name
  // Fallback for legacy crop_<slug> ids — modern Cosh ids are UUIDs
  // and look ugly under this transform; the server now sets crop_name
  // for those, so we only reach this path when the crop isn't yet
  // classified in Cosh.
  if (!detail.crop_cosh_id) return 'Crop'
  return detail.crop_cosh_id.replace(/^crop_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function AssignmentReviewPage() {
  const router = useRouter()
  const tTrain = useTranslations('training')
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
    const isTraining = !!detail?.company?.is_training
    const message = approved
      ? (isTraining
          ? tTrain('farmerAssignment.confirmAcceptTraining', {
              company: detail?.company?.name || '',
              crop: formatCropName(detail),
            })
          : `Subscribe to ${detail?.company?.name}'s ${formatCropName(detail)} advisory? You won't be able to unsubscribe — your company has paid for this.`)
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
  const cropName = formatCropName(detail)

  return (
    <div className="min-h-screen bg-[#F7F5F0]">
      {/* Branded header */}
      <div className="px-5 py-6 relative" style={{ background: colour }}>
        {/* 2026-07-24 — Training badge sits on the branded header
            for immediate visual signalling before the farmer even
            reads the copy below. */}
        {detail.company?.is_training && (
          <span className="absolute top-3 right-3 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-300 text-amber-900 shadow-sm">
            {tTrain('chip')}
          </span>
        )}
        <button onClick={() => router.push('/home')}
          aria-label="Back"
          className="text-white/90 mb-3 text-[28px] leading-none w-9 h-9 flex items-center justify-center font-light pb-1">
          ‹
        </button>
        <p className="text-white/70 text-xs uppercase tracking-widest">
          {detail.company?.is_training ? tTrain('farmerAssignment.headerLabel') : 'Advisory Request'}
        </p>
        <h1 className="text-white text-2xl font-bold mt-1">{detail.company?.name}</h1>
        {detail.company?.tagline && <p className="text-white/60 text-sm mt-1">{detail.company.tagline}</p>}
      </div>

      <div className="px-5 py-6 max-w-lg mx-auto pb-32">
        {/* 2026-07-24 — Training banner explaining consequences. Sits
            at the very top so the farmer reads it before scrolling
            through the crop/package details. */}
        {detail.company?.is_training && (
          <div className="mb-4 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-amber-900 font-semibold text-sm">
              {tTrain('farmerAssignment.bannerTitle')}
            </p>
            <p className="text-amber-800 text-xs mt-1 leading-relaxed">
              {tTrain('farmerAssignment.bannerBody')}
            </p>
          </div>
        )}
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

        {/* Payment info — swapped to a training-specific card when
            this is a practice session. Real money never changes
            hands in a training session (Commit D bypass), so
            "Paid by" copy would be misleading. */}
        {detail.company?.is_training ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="text-amber-900 text-sm font-medium">{tTrain('farmerAssignment.paymentCardTitle')}</p>
            <p className="text-amber-800 text-xs mt-1">{tTrain('farmerAssignment.paymentCardBody')}</p>
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
            <p className="text-emerald-800 text-sm font-medium">Paid by {detail.company?.name}</p>
            <p className="text-emerald-700 text-xs mt-1">No payment needed from you. You won&apos;t be able to unsubscribe later — your company has covered this advisory.</p>
          </div>
        )}

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
