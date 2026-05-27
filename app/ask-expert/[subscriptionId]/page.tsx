'use client'
import { useState, useEffect, FormEvent } from 'react'
import Script from 'next/script'
import { useRouter, useParams } from 'next/navigation'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import ClientCropChip from '@/components/ClientCropChip'
import api from '@/lib/api'

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open(): void }
  }
}

interface RazorpayResponse {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

const SEVERITY_OPTIONS = [
  { value: 'CRITICAL', label: 'Critical', desc: 'Severe damage visible, urgent action needed' },
  { value: 'HIGH', label: 'High', desc: 'Significant impact, needs prompt attention' },
  { value: 'MODERATE', label: 'Moderate', desc: 'Some concern but crop is managing' },
  { value: 'LOW', label: 'Low', desc: 'Minor issue or general question' },
]

interface CoshOption { cosh_id: string; name: string }
interface Quota {
  used: number
  free_limit: number
  free_remaining: number
  price_paise: number
  next_query_is_paid: boolean
}

type MediaItem = { media_type: 'IMAGE' | 'AUDIO'; url: string }

const MAX_PHOTOS = 4

export default function AskExpertPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const router = useRouter()
  const user = getUser()
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState<'photo' | 'audio' | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const [queryTypes, setQueryTypes] = useState<CoshOption[]>([])
  const [quota, setQuota] = useState<Quota | null>(null)
  const [clientName, setClientName] = useState<string>('')
  const [clientId, setClientId] = useState<string>('')
  const [cropCoshId, setCropCoshId] = useState<string | undefined>(undefined)

  const [form, setForm] = useState({
    query_type_cosh_id: '',
    description: '',
    crop_age: '',
    severity: 'MODERATE',
    photos: [] as string[],   // image URLs, mandatory ≥1, max MAX_PHOTOS
    audio: null as string | null,  // optional, single
  })

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<CoshOption[]>('/cosh/query-types')
      .then(r => setQueryTypes(r.data))
      .catch(() => { /* form still submits; dropdown is empty */ })
    // Pull subscription → resolve client_id and quota together.
    api.get<{ id: string; client_id: string; crop_cosh_id?: string; client_display_name?: string | null }[]>('/farmer/my-subscriptions')
      .then(r => {
        const sub = r.data.find(s => s.id === subscriptionId)
        if (!sub) return
        setClientId(sub.client_id)
        setClientName(sub.client_display_name || 'this company')
        setCropCoshId(sub.crop_cosh_id)
        api.get<Quota>(`/farmer/queries/quota?client_id=${sub.client_id}`)
          .then(qr => setQuota(qr.data))
          .catch(() => {})
      })
  }, [subscriptionId])

  async function uploadPhoto(file: File) {
    if (form.photos.length >= MAX_PHOTOS) return
    setUploading('photo'); setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'query-photos')
      const { data } = await api.post<{ url: string }>('/media/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setForm(f => ({ ...f, photos: [...f.photos, data.url] }))
    } catch (err: unknown) {
      setError(extractMsg(err, 'Photo upload failed.'))
    } finally { setUploading(null) }
  }

  async function uploadAudio(file: File) {
    setUploading('audio'); setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'query-audio')
      const { data } = await api.post<{ url: string }>('/media/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setForm(f => ({ ...f, audio: data.url }))
    } catch (err: unknown) {
      setError(extractMsg(err, 'Audio upload failed.'))
    } finally { setUploading(null) }
  }

  function extractMsg(err: unknown, fallback: string): string {
    const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
    if (typeof detail === 'string') return detail
    const m = (detail as { message?: string } | undefined)?.message
    return m || fallback
  }

  function buildPayload(razorpay?: RazorpayResponse) {
    const media: MediaItem[] = [
      ...form.photos.map(url => ({ media_type: 'IMAGE' as const, url })),
      ...(form.audio ? [{ media_type: 'AUDIO' as const, url: form.audio }] : []),
    ]
    return {
      subscription_id: subscriptionId,
      client_id: clientId,
      crop_cosh_id: cropCoshId,
      query_type_cosh_id: form.query_type_cosh_id,
      crop_age: form.crop_age || undefined,
      description: form.description || undefined,
      severity: form.severity,
      media,
      ...(razorpay ? {
        razorpay_order_id: razorpay.razorpay_order_id,
        razorpay_payment_id: razorpay.razorpay_payment_id,
        razorpay_signature: razorpay.razorpay_signature,
      } : {}),
    }
  }

  async function submitWith(razorpay?: RazorpayResponse) {
    try {
      await api.post('/farmer/queries', buildPayload(razorpay))
      setDone(true)
    } catch (err: unknown) {
      setError(extractMsg(err, 'Failed to submit query.'))
    } finally { setSubmitting(false) }
  }

  async function openRazorpayForQuery() {
    try {
      const { data: order } = await api.post<{
        razorpay_order_id: string; amount: number; currency: string; key_id: string
      }>('/farmer/queries/init-payment', { client_id: clientId })
      const options = {
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        name: 'rootsTALK.in',
        description: `Expert Query (paid to rootsTALK.in, not ${clientName})`,
        order_id: order.razorpay_order_id,
        prefill: { name: user?.name || '', contact: user?.phone || '' },
        theme: { color: '#3A7D44' },
        handler: (resp: RazorpayResponse) => {
          // Razorpay sheet has closed with a success — submit the
          // query with the payment artefacts attached.
          submitWith(resp)
        },
        modal: {
          ondismiss: () => {
            setSubmitting(false)
            setError('Payment cancelled. Try again to submit your query.')
          },
        },
      }
      new window.Razorpay(options).open()
    } catch (err: unknown) {
      setSubmitting(false)
      setError(extractMsg(err, 'Could not start payment. Try again.'))
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (form.photos.length < 1) {
      setError('Please add at least one photograph.')
      return
    }
    setSubmitting(true); setError('')
    if (quota?.next_query_is_paid) {
      // Razorpay path — opens the sheet; the handler calls submitWith().
      openRazorpayForQuery()
    } else {
      submitWith()
    }
  }

  // Staging-only bypass — Razorpay TEST mode rejects real UPI handles
  // so we can't actually pay through the sheet on the testing host.
  // The button below is hidden everywhere except rstalk-pwa.eywa.farm;
  // the backend re-checks settings.environment != "production" before
  // honouring staging_bypass.
  const isStaging = typeof window !== 'undefined'
    && /(?:^|\.)rstalk-pwa\.eywa\.farm$/i.test(window.location.hostname)

  async function bypassSubmit() {
    if (form.photos.length < 1) {
      setError('Please add at least one photograph.')
      return
    }
    setSubmitting(true); setError('')
    try {
      await api.post('/farmer/queries', {
        ...buildPayload(),
        staging_bypass: true,
      })
      setDone(true)
    } catch (err: unknown) {
      setError(extractMsg(err, 'Bypass submit failed.'))
    } finally { setSubmitting(false) }
  }

  if (done) return (
    <div className="min-h-screen bg-[#F5F0E8] flex flex-col items-center justify-center px-4 text-center">
      <span className="text-5xl mb-4">✅</span>
      <h1 className="text-xl font-bold text-[#6B3F1F]">Query submitted!</h1>
      <p className="text-[#7A8C7E] text-sm mt-2 max-w-xs">
        A FarmPundit expert has been assigned. They have <strong>2 days</strong> to respond.
        You'll be notified when they reply.
      </p>
      <button onClick={() => router.push('/home')}
        className="mt-6 w-full max-w-xs py-3.5 rounded-2xl text-white font-semibold"
        style={{ background: '#3A7D44' }}>
        Back to Home
      </button>
      <button onClick={() => router.push('/orders')}
        className="mt-2 w-full max-w-xs py-3.5 rounded-2xl border border-[#DDD0B8] text-[#6B3F1F] font-medium text-sm">
        View My Queries
      </button>
    </div>
  )

  const canSubmit =
    !!form.query_type_cosh_id &&
    form.photos.length >= 1 &&
    !!form.severity &&
    !submitting &&
    !uploading

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      {/* Razorpay checkout — only needed when the quota is exhausted,
          but `Script` with lazyOnload is cheap to include unconditionally
          and matches the pattern used on /subscribe. */}
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <PWAHeader title="Ask an Expert" activeRole="FARMER" back />
      <div className="pt-16">
        <ClientCropChip subscriptionId={subscriptionId} />
      </div>
      <div className="pb-20 px-4">
        <div className="mt-4 mb-3">
          <p className="text-lg font-bold text-[#6B3F1F]">Describe your crop issue</p>
          <p className="text-[#7A8C7E] text-sm mt-0.5">A FarmPundit expert will respond within 2 days</p>
        </div>

        {/* Free-quota banner. Two shapes: still-have-free and exhausted.
            The exhausted version is the first place the farmer learns
            the 7th+ query is paid — and that rootsTALK.in (not the
            company) takes the payment. */}
        {quota && (
          quota.next_query_is_paid ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-4 text-sm">
              <p className="font-semibold text-amber-800">
                Your 6 free queries to {clientName} are used up.
              </p>
              <p className="text-amber-700 mt-1">
                This query will cost <strong>₹{(quota.price_paise / 100).toFixed(0)}</strong>,
                paid to <strong>rootsTALK.in</strong> for software infrastructure.
                It is <em>not</em> paid to {clientName}.
              </p>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-2.5 mb-4 text-sm text-emerald-800">
              You have <strong>{quota.free_remaining} of {quota.free_limit}</strong> free queries left for {clientName}.
            </div>
          )
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8] space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">
                Nature of Query <span className="text-[#D4682E]">*</span>
              </label>
              <select value={form.query_type_cosh_id}
                onChange={e => setForm(f => ({ ...f, query_type_cosh_id: e.target.value }))}
                required
                className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="">Select…</option>
                {queryTypes.map(o => <option key={o.cosh_id} value={o.cosh_id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">Crop Age (optional)</label>
              <input value={form.crop_age} onChange={e => setForm(f => ({ ...f, crop_age: e.target.value }))}
                placeholder="e.g. 45 DAS, 3 weeks after transplanting"
                className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">Describe in detail (optional)</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={4} placeholder="When did it start? Which part of the plant? How much of the field is affected?"
                className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm focus:outline-none resize-none" />
            </div>
          </div>

          {/* Photos — at least 1, up to 4. */}
          <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8]">
            <p className="text-sm font-medium text-[#6B3F1F] mb-2">
              Photographs <span className="text-[#D4682E]">*</span>
              <span className="text-xs text-[#7A8C7E] font-normal ml-1">
                ({form.photos.length} / {MAX_PHOTOS}; at least 1 required)
              </span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              {form.photos.map((url, idx) => (
                <div key={idx} className="relative">
                  <img src={url} alt={`Photo ${idx + 1}`}
                    className="w-full h-28 object-cover rounded-xl border border-[#DDD0B8]" />
                  <button type="button"
                    onClick={() => setForm(f => ({ ...f, photos: f.photos.filter((_, i) => i !== idx) }))}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs leading-none flex items-center justify-center"
                    aria-label="Remove photo">×</button>
                </div>
              ))}
              {form.photos.length < MAX_PHOTOS && (
                <label className="h-28 border-2 border-dashed border-[#DDD0B8] rounded-xl flex items-center justify-center cursor-pointer text-xs text-[#7A8C7E] hover:bg-[#F5F0E8]">
                  {uploading === 'photo' ? 'Uploading…' : '+ Add photo'}
                  <input type="file" accept="image/*" className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) uploadPhoto(f)
                      e.target.value = ''
                    }} />
                </label>
              )}
            </div>
          </div>

          {/* Audio — at most 1, optional. */}
          <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8]">
            <p className="text-sm font-medium text-[#6B3F1F] mb-2">
              Voice note (optional)
            </p>
            {form.audio ? (
              <div className="bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl px-3 py-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-[#6B3F1F]">🎙 Voice note attached — play to confirm</span>
                  <button type="button"
                    onClick={() => setForm(f => ({ ...f, audio: null }))}
                    className="text-xs text-[#D4682E] font-medium">Remove</button>
                </div>
                <audio src={form.audio} controls className="w-full" />
              </div>
            ) : (
              <label className="block w-full py-2.5 border-2 border-dashed border-[#DDD0B8] rounded-xl text-center text-xs text-[#7A8C7E] cursor-pointer hover:bg-[#F5F0E8]">
                {uploading === 'audio' ? 'Uploading…' : '🎙 Add a voice note'}
                <input type="file" accept="audio/*" className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) uploadAudio(f)
                    e.target.value = ''
                  }} />
              </label>
            )}
          </div>

          {/* Severity */}
          <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8]">
            <p className="text-sm font-medium text-[#6B3F1F] mb-3">How urgent is this? <span className="text-[#D4682E]">*</span></p>
            <div className="space-y-2">
              {SEVERITY_OPTIONS.map(s => (
                <label key={s.value} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${form.severity === s.value ? 'border-green-500 bg-green-50' : 'border-transparent bg-[#F5F0E8]'}`}>
                  <input type="radio" name="severity" value={s.value}
                    checked={form.severity === s.value}
                    onChange={() => setForm(f => ({ ...f, severity: s.value }))} className="sr-only" />
                  <div>
                    <p className="text-sm font-medium text-[#6B3F1F]">{s.label}</p>
                    <p className="text-xs text-[#7A8C7E]">{s.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-[#D4682E] bg-red-50 px-4 py-2 rounded-xl">{error}</p>}

          <button type="submit" disabled={!canSubmit}
            className="w-full py-4 rounded-2xl text-white font-semibold disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #065f46, #3A7D44)' }}>
            {submitting
              ? (quota?.next_query_is_paid ? 'Opening payment…' : 'Submitting…')
              : (quota?.next_query_is_paid
                  ? `Pay ₹${(quota.price_paise / 100).toFixed(0)} & Submit →`
                  : 'Submit to Expert →')}
          </button>
          {isStaging && quota?.next_query_is_paid && (
            <button type="button" onClick={bypassSubmit} disabled={!canSubmit}
              className="w-full py-2.5 rounded-2xl text-xs font-semibold border border-dashed border-amber-400 text-amber-700 bg-amber-50 disabled:opacity-40">
              ⚙ Staging: skip Razorpay, submit as paid
            </button>
          )}
          <p className="text-center text-xs text-[#7A8C7E]">
            Your query is shared with the company's FarmPundit experts. Response within 2 days.
          </p>
        </form>
      </div>
    </div>
  )
}
