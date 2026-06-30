'use client'
import { useState, useEffect, FormEvent } from 'react'
import Script from 'next/script'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
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

const SEVERITY_KEYS = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'] as const

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
  const t = useTranslations('askExpert')
  const tSeverity = useTranslations('askExpert.severity')
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
    // 2026-06-30 — Optional for plant-wise crops. Propagates into a
    // QA-triggered TriggeredCHAEntry's affected_plants_count when the
    // pundit's chosen Standard Response fires a CHA. Left blank means
    // the dealer screen shows a "Please check with the farmer" hint.
    affected_plants: '',
  })
  // Measure + declared plant count drive whether to render the
  // optional affected-plants field on the form. Area-wise crops hide
  // it entirely; the question is meaningless for them.
  const [measure, setMeasure] = useState<'PLANT_WISE' | 'AREA_WISE' | null>(null)
  const [numberOfPlants, setNumberOfPlants] = useState<number | null>(null)

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
        setClientName(sub.client_display_name || '—')
        setCropCoshId(sub.crop_cosh_id)
        api.get<Quota>(`/farmer/queries/quota?client_id=${sub.client_id}`)
          .then(qr => setQuota(qr.data))
          .catch(() => {})
      })
    // Eligibility ships measure + declared plant count too.
    api.get<{
      eligible: boolean
      measure?: 'PLANT_WISE' | 'AREA_WISE' | null
      number_of_plants?: number | null
    }>(`/diagnosis/eligibility/${subscriptionId}`)
      .then(r => {
        if (r.data.measure) setMeasure(r.data.measure)
        if (r.data.number_of_plants) setNumberOfPlants(r.data.number_of_plants)
      })
      .catch(() => { /* form still works without measure gating */ })
  }, [subscriptionId])

  // Parse + validate optional affected-plants input. Returns the number
  // if valid, null otherwise. Empty string is valid (means "skip").
  const parsedAffectedPlants: number | null = (() => {
    if (!form.affected_plants.trim()) return null
    const n = parseInt(form.affected_plants, 10)
    if (!Number.isFinite(n) || n < 1) return null
    if (numberOfPlants && n > numberOfPlants) return null
    return n
  })()
  const affectedPlantsInvalid = (
    form.affected_plants.trim() !== '' && parsedAffectedPlants === null
  )

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
      setError(extractMsg(err, t('errors.photoUploadFailed')))
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
      setError(extractMsg(err, t('errors.audioUploadFailed')))
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
      ...(parsedAffectedPlants !== null
        ? { affected_plants_count: parsedAffectedPlants }
        : {}),
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
      setError(extractMsg(err, t('errors.submitFailed')))
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
        description: t('razorpayDescription', { client: clientName }),
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
            setError(t('errors.paymentCancelled'))
          },
        },
      }
      new window.Razorpay(options).open()
    } catch (err: unknown) {
      setSubmitting(false)
      setError(extractMsg(err, t('errors.paymentStartFailed')))
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (form.photos.length < 1) {
      setError(t('errors.needOnePhoto'))
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
      setError(t('errors.needOnePhoto'))
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
      setError(extractMsg(err, t('errors.bypassFailed')))
    } finally { setSubmitting(false) }
  }

  if (done) return (
    <div className="min-h-screen bg-[#F5F0E8] flex flex-col items-center justify-center px-4 text-center">
      <span className="text-5xl mb-4">✅</span>
      <h1 className="text-xl font-bold text-[#6B3F1F]">{t('doneTitle')}</h1>
      <p className="text-[#7A8C7E] text-sm mt-2 max-w-xs">
        {t.rich('doneBody', { strong: chunks => <strong>{chunks}</strong> })}
      </p>
      <button onClick={() => router.push('/home')}
        className="mt-6 w-full max-w-xs py-3.5 rounded-2xl text-white font-semibold"
        style={{ background: '#3A7D44' }}>
        {t('backToHome')}
      </button>
      <button onClick={() => router.push(`/crop-detail/${subscriptionId}/queries`)}
        className="mt-2 w-full max-w-xs py-3.5 rounded-2xl border border-[#DDD0B8] text-[#6B3F1F] font-medium text-sm">
        {t('viewMyQueries')}
      </button>
    </div>
  )

  const canSubmit =
    !!form.query_type_cosh_id &&
    form.photos.length >= 1 &&
    !!form.severity &&
    !submitting &&
    !uploading &&
    !affectedPlantsInvalid

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      {/* Razorpay checkout — only needed when the quota is exhausted,
          but `Script` with lazyOnload is cheap to include unconditionally
          and matches the pattern used on /subscribe. */}
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <PWAHeader title={t('headerTitle')} activeRole="FARMER" back={`/crop-detail/${subscriptionId}`} />
      <div className="pt-16">
        <ClientCropChip subscriptionId={subscriptionId} />
      </div>
      <div className="pb-20 px-4">
        <div className="mt-4 mb-3">
          <p className="text-lg font-bold text-[#6B3F1F]">{t('describeYourIssue')}</p>
          <p className="text-[#7A8C7E] text-sm mt-0.5">{t('expertWithin2Days')}</p>
        </div>

        {/* Free-quota banner. Two shapes: still-have-free and exhausted.
            The exhausted version is the first place the farmer learns
            the 7th+ query is paid — and that rootsTALK.in (not the
            company) takes the payment. */}
        {quota && (
          quota.next_query_is_paid ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-4 text-sm">
              <p className="font-semibold text-amber-800">
                {t('quotaPaidTitle', { limit: quota.free_limit, client: clientName })}
              </p>
              <p className="text-amber-700 mt-1">
                {t.rich('quotaPaidBody', {
                  price: (quota.price_paise / 100).toFixed(0),
                  client: clientName,
                  strong: chunks => <strong>{chunks}</strong>,
                  em: chunks => <em>{chunks}</em>,
                })}
              </p>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-2.5 mb-4 text-sm text-emerald-800">
              {t.rich('quotaFreeRemaining', {
                remaining: quota.free_remaining,
                limit: quota.free_limit,
                client: clientName,
                strong: chunks => <strong>{chunks}</strong>,
              })}
            </div>
          )
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8] space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">
                {t('natureOfQueryLabel')} <span className="text-[#D4682E]">*</span>
              </label>
              <select value={form.query_type_cosh_id}
                onChange={e => setForm(f => ({ ...f, query_type_cosh_id: e.target.value }))}
                required
                className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="">{t('selectPlaceholder')}</option>
                {queryTypes.map(o => <option key={o.cosh_id} value={o.cosh_id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">{t('cropAgeLabel')}</label>
              <input value={form.crop_age} onChange={e => setForm(f => ({ ...f, crop_age: e.target.value }))}
                placeholder={t('cropAgePlaceholder')}
                className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
            </div>
            {/* 2026-06-30 — Optional affected-plants count for
                plant-wise crops. Hidden for area-wise. If filled, it
                propagates into a QA-triggered TriggeredCHAEntry so
                the dealer's order is sized for affected plants. */}
            {measure === 'PLANT_WISE' && (
              <div>
                <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">
                  {t('affectedPlantsLabel', { total: numberOfPlants ?? '?' })}
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={numberOfPlants ?? undefined}
                  value={form.affected_plants}
                  onChange={e => setForm(f => ({ ...f, affected_plants: e.target.value }))}
                  placeholder={t('affectedPlantsPlaceholder')}
                  className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm focus:outline-none"
                />
                <p className="mt-1 text-xs text-[#7A8C7E]">
                  {t('affectedPlantsHelp')}
                </p>
                {affectedPlantsInvalid && (
                  <p className="mt-1 text-xs text-red-600">
                    {numberOfPlants
                      ? t('affectedPlantsRange', { max: numberOfPlants })
                      : t('affectedPlantsMin')}
                  </p>
                )}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">{t('describeDetailLabel')}</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={4} placeholder={t('describeDetailPlaceholder')}
                className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm focus:outline-none resize-none" />
            </div>
          </div>

          {/* Photos — at least 1, up to 4. */}
          <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8]">
            <p className="text-sm font-medium text-[#6B3F1F] mb-2">
              {t('photographsLabel')} <span className="text-[#D4682E]">*</span>
              <span className="text-xs text-[#7A8C7E] font-normal ml-1">
                {t('photoCount', { count: form.photos.length, max: MAX_PHOTOS })}
              </span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              {form.photos.map((url, idx) => (
                <div key={idx} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt=""
                    className="w-full h-28 object-cover rounded-xl border border-[#DDD0B8]" />
                  <button type="button"
                    onClick={() => setForm(f => ({ ...f, photos: f.photos.filter((_, i) => i !== idx) }))}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs leading-none flex items-center justify-center"
                    aria-label={t('removePhotoAria')}>×</button>
                </div>
              ))}
              {form.photos.length < MAX_PHOTOS && (
                <label className="h-28 border-2 border-dashed border-[#DDD0B8] rounded-xl flex items-center justify-center cursor-pointer text-xs text-[#7A8C7E] hover:bg-[#F5F0E8]">
                  {uploading === 'photo' ? t('uploading') : t('addPhoto')}
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
              {t('voiceNoteLabel')}
            </p>
            {form.audio ? (
              <div className="bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl px-3 py-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-[#6B3F1F]">{t('voiceNoteAttached')}</span>
                  <button type="button"
                    onClick={() => setForm(f => ({ ...f, audio: null }))}
                    className="text-xs text-[#D4682E] font-medium">{t('remove')}</button>
                </div>
                <audio src={form.audio} controls className="w-full" />
              </div>
            ) : (
              <label className="block w-full py-2.5 border-2 border-dashed border-[#DDD0B8] rounded-xl text-center text-xs text-[#7A8C7E] cursor-pointer hover:bg-[#F5F0E8]">
                {uploading === 'audio' ? t('uploading') : t('addVoiceNote')}
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
            <p className="text-sm font-medium text-[#6B3F1F] mb-3">{t('howUrgentLabel')} <span className="text-[#D4682E]">*</span></p>
            <div className="space-y-2">
              {SEVERITY_KEYS.map(key => (
                <label key={key} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${form.severity === key ? 'border-green-500 bg-green-50' : 'border-transparent bg-[#F5F0E8]'}`}>
                  <input type="radio" name="severity" value={key}
                    checked={form.severity === key}
                    onChange={() => setForm(f => ({ ...f, severity: key }))} className="sr-only" />
                  <div>
                    <p className="text-sm font-medium text-[#6B3F1F]">{tSeverity(`${key}.label`)}</p>
                    <p className="text-xs text-[#7A8C7E]">{tSeverity(`${key}.desc`)}</p>
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
              ? (quota?.next_query_is_paid ? t('openingPayment') : t('submitting'))
              : (quota?.next_query_is_paid
                  ? t('payAndSubmit', { price: (quota.price_paise / 100).toFixed(0) })
                  : t('submitToExpert'))}
          </button>
          {isStaging && quota?.next_query_is_paid && (
            <button type="button" onClick={bypassSubmit} disabled={!canSubmit}
              className="w-full py-2.5 rounded-2xl text-xs font-semibold border border-dashed border-amber-400 text-amber-700 bg-amber-50 disabled:opacity-40">
              {t('stagingBypass')}
            </button>
          )}
          <p className="text-center text-xs text-[#7A8C7E]">
            {t('shareNotice')}
          </p>
        </form>
      </div>
    </div>
  )
}
