'use client'
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Script from 'next/script'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

// Cosh-driven location universe — same shape as onboarding /
// Profile. Used here so the farmer picks a real state/district
// by name (we send the cosh_id to /farmer/discover/* APIs).
type CoshDistrict = { cosh_id: string; name: string | null }
type CoshState    = { cosh_id: string; name: string | null; districts: CoshDistrict[] }
type CoshLocations = { states: CoshState[] }

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open(): void }
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Stage = 'location' | 'crop' | 'company' | 'guided' | 'confirm' | 'payment' | 'delegate' | 'delegate_sent' | 'done'

interface CompanyInfo {
  id: string
  display_name: string
  tagline: string | null
  logo_url: string | null
  primary_colour: string
}

interface GuidedStep {
  done: boolean
  package?: { id: string; name: string; description: string | null }
  parameter?: { id: string; name: string }
  variables?: { id: string; name: string }[]
  remaining_count?: number
  error?: string
}

// Crop label resolver lives in lib/crop-name. Pass the resolved
// name from the backend (preferred) plus the cosh_id as a fallback.

function ProgressBar({ stage }: { stage: Stage }) {
  const steps: Stage[] = ['location', 'crop', 'company', 'guided', 'confirm', 'payment', 'done']
  const idx = steps.indexOf(stage)
  return (
    <div className="flex gap-1 mb-6">
      {steps.map((s, i) => (
        <div
          key={s}
          className="flex-1 h-1 rounded-full"
          style={{ background: i <= idx ? '#3A7D44' : '#e7e5e4' }}
        />
      ))}
    </div>
  )
}

function CompanyLogo({ company }: { company: CompanyInfo }) {
  const colour = company.primary_colour || '#3A7D44'
  const initials = (company.display_name || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="flex items-center gap-3 px-4 py-4" style={{ background: colour }}>
      {company.logo_url ? (
        <img src={company.logo_url} alt={company.display_name}
          className="w-10 h-10 rounded-full object-contain bg-white p-1 shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shrink-0"
          style={{ color: colour }}>
          <span className="text-xs font-bold">{initials}</span>
        </div>
      )}
      <p className="text-white font-semibold text-base flex-1">{company.display_name}</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

// Next 16 requires components using useSearchParams to be wrapped
// in <Suspense> so the prerender can complete around them. The
// wrapper below is the page's default export; the real
// implementation moves to SubscribeFlow and runs client-only.
export default function SubscribePage() {
  return (
    <Suspense fallback={null}>
      <SubscribeFlow />
    </Suspense>
  )
}

function SubscribeFlow() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const user = getUser()
  const t = useTranslations('subscribe')
  const tLocation = useTranslations('location')
  const tCommon = useTranslations('common')

  const [stage, setStage] = useState<Stage>('location')

  // Delegate-success info populated by sendDelegateRequest() so the
  // 'delegate_sent' stage can render "Sent to <name> · <phone>"
  // instead of a misleading "You're subscribed!" screen.
  const [delegateSentInfo, setDelegateSentInfo] = useState<{
    name: string | null; phone: string | null; expiresAt: string | null;
  }>({ name: null, phone: null, expiresAt: null })

  // Location pickers — store real cosh_ids (sent to backend) and
  // resolved names (rendered). `district` (cosh_id) drives the
  // /farmer/discover/* API calls. Initial values come from the
  // user's saved profile; the "Use my saved location" chip and
  // the typeahead pickers both write into this same state.
  const [district, setDistrict] = useState('')           // district cosh_id
  const [districtName, setDistrictName] = useState('')   // resolved name
  const [stateId, setStateId] = useState('')             // state cosh_id
  const [stateName, setStateName] = useState('')         // resolved name
  const [stateSearch, setStateSearch] = useState('')
  const [districtSearch, setDistrictSearch] = useState('')
  const [editingLocation, setEditingLocation] = useState(false)
  const [coshLocations, setCoshLocations] = useState<CoshLocations | null>(null)

  // Discovery
  const [crops, setCrops] = useState<{ crop_cosh_id: string; name?: string | null }[]>([])
  const [companies, setCompanies] = useState<CompanyInfo[]>([])
  const [cropId, setCropId] = useState('')
  // Resolved crop display name — captured at crop-pick time so
  // every downstream stage (company, confirm, done) renders the
  // friendly label instead of the cosh_id.
  const [cropName, setCropName] = useState('')
  const [clientId, setClientId] = useState('')
  const [company, setCompany] = useState<CompanyInfo | null>(null)

  // Guided algorithm
  const [answers, setAnswers] = useState('')
  const [selectedVars, setSelectedVars] = useState<{ paramName: string; varName: string }[]>([])
  const [packageId, setPackageId] = useState('')
  // Package name + description captured at confirm-stage entry
  // so the Confirm card can show the SE's authored label and
  // optional description, not just the crop name. Both come from
  // guided-step's `package` payload.
  const [packageDescription, setPackageDescription] = useState<string | null>(null)
  const [guidedStep, setGuidedStep] = useState<GuidedStep | null>(null)
  const [guidedQuestionIndex, setGuidedQuestionIndex] = useState(0)

  // Subscription
  const [subscription, setSubscription] = useState<{ id: string } | null>(null)

  // Delegate payment
  const [delegatePhone, setDelegatePhone] = useState('')
  const [delegateRole, setDelegateRole] = useState<'DEALER' | 'FACILITATOR'>('DEALER')

  // Two-step Check → Send (2026-05-30). After the farmer types a
  // phone and hits Check, this holds the resolved delegate's profile
  // so the page can render a confirmation card. Cleared whenever the
  // phone input changes — the farmer must re-check before sending.
  type DelegateLookup = {
    user_id: string; name: string | null; phone: string;
    roles: ('FACILITATOR' | 'DEALER')[];
    affiliations: { role: 'FACILITATOR' | 'DEALER'; company_name: string; client_id: string }[];
  }
  const [delegateLookup, setDelegateLookup] = useState<DelegateLookup | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')

  // UI state
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // ── Auth guard + location preload ─────────────────────────────
  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    // Pre-fill from the user's saved profile location (cosh_ids).
    // Names get resolved once /cosh/locations/india lands below.
    api.get<{ state_cosh_id: string | null; district_cosh_id: string | null }>('/auth/me/location')
      .then(({ data }) => {
        if (data.state_cosh_id) setStateId(data.state_cosh_id)
        if (data.district_cosh_id) setDistrict(data.district_cosh_id)
      })
      .catch(() => { /* location not set — user picks via the typeahead */ })
    // Cosh universe powers the typeahead pickers AND resolves the
    // pre-filled cosh_ids to display names.
    api.get<CoshLocations>('/cosh/locations/india')
      .then(r => setCoshLocations(r.data))
      .catch(() => { /* picker shows a clear error state */ })
  }, [router])

  // Resolve names whenever the universe or the selected ids change.
  useEffect(() => {
    if (!coshLocations) return
    const s = coshLocations.states.find(x => x.cosh_id === stateId)
    setStateName(s?.name || '')
    const d = s?.districts.find(x => x.cosh_id === district)
    setDistrictName(d?.name || '')
  }, [coshLocations, stateId, district])

  // ?resume=<sub_id> — Home's Complete-payment CTA routes here so
  // the farmer jumps straight to the payment stage of the
  // existing WAITLISTED sub instead of restarting the flow (which
  // would create a duplicate WAITLISTED row). Loads the sub +
  // company info, populates the state the payment stage needs,
  // and skips ahead.
  useEffect(() => {
    const resumeId = searchParams?.get('resume')
    if (!resumeId || !getToken()) return
    let cancelled = false
    ;(async () => {
      try {
        type SubRow = {
          id: string; client_id: string; package_id: string
          status: string; crop_name?: string | null
          package_name?: string | null
        }
        const { data: subs } = await api.get<SubRow[]>('/farmer/my-subscriptions')
        const sub = subs.find(s => s.id === resumeId)
        if (!sub || cancelled) return
        if (sub.status !== 'WAITLISTED') {
          // Already paid (ACTIVE) or cancelled — bounce home.
          router.replace('/home')
          return
        }
        // Load the company for the payment-screen header + Razorpay
        // prefill context.
        try {
          const { data: info } = await api.get<CompanyInfo>(
            `/client/${sub.client_id}/info`,
          )
          if (cancelled) return
          setCompany(info)
        } catch { /* payment stage still works without company info */ }
        if (cancelled) return
        setSubscription({ id: sub.id })
        setClientId(sub.client_id)
        setPackageId(sub.package_id)
        setCropName(sub.crop_name || '')
        setStage('payment')
      } catch {
        // Resume failed — fall back to the normal flow start.
      }
    })()
    return () => { cancelled = true }
  }, [searchParams, router])

  // ── Stage: Location ────────────────────────────────────────────────────────
  async function proceedFromLocation() {
    if (!district) { setError(t('errors.pickDistrict')); return }
    setBusy(true); setError('')
    try {
      const { data } = await api.get<{ crop_cosh_id: string; name?: string | null }[]>('/farmer/discover/crops', {
        params: { district_cosh_id: district },
      })
      setCrops(data)
      setStage('crop')
    } catch { setError(t('errors.loadCrops')) }
    finally { setBusy(false) }
  }

  // ── Stage: Crop → Company ──────────────────────────────────────────────────
  async function selectCrop(cid: string) {
    setCropId(cid)
    const matched = crops.find(c => c.crop_cosh_id === cid)
    setCropName(cropDisplayName(cid, matched?.name))
    setBusy(true); setError('')
    try {
      const { data } = await api.get<CompanyInfo[]>('/farmer/discover/companies', {
        params: { crop_cosh_id: cid, district_cosh_id: district },
      })
      setCompanies(data)
      setStage('company')
    } catch { setError(t('errors.loadCompanies')) }
    finally { setBusy(false) }
  }

  // ── Stage: Company → Guided ────────────────────────────────────────────────
  async function selectCompany(c: CompanyInfo) {
    setCompany(c)
    setClientId(c.id)
    setAnswers('')
    setSelectedVars([])
    setGuidedQuestionIndex(0)
    setBusy(true); setError('')
    try {
      const { data } = await api.get<GuidedStep>('/farmer/packages/guided-step', {
        params: { crop_cosh_id: cropId, district_cosh_id: district, client_id: c.id, answers: '' },
      })
      setGuidedStep(data)
      if (data.done && data.package) {
        setPackageId(data.package.id)
        setPackageDescription(data.package.description)
        setStage('confirm')
      } else if (data.error) {
        setError(data.error)
      } else {
        setStage('guided')
      }
    } catch { setError(t('errors.startFinder')) }
    finally { setBusy(false) }
  }

  // ── Stage: Guided selection ────────────────────────────────────────────────
  async function selectVariable(paramId: string, varId: string, paramName: string, varName: string) {
    const newAnswers = answers ? `${answers},${paramId}:${varId}` : `${paramId}:${varId}`
    setAnswers(newAnswers)
    setSelectedVars(prev => [...prev, { paramName, varName }])
    setGuidedQuestionIndex(prev => prev + 1)
    setBusy(true); setError('')
    try {
      const { data } = await api.get<GuidedStep>('/farmer/packages/guided-step', {
        params: { crop_cosh_id: cropId, district_cosh_id: district, client_id: clientId, answers: newAnswers },
      })
      setGuidedStep(data)
      if (data.done && data.package) {
        setPackageId(data.package.id)
        setPackageDescription(data.package.description)
        setStage('confirm')
      } else if (data.error) {
        setError(data.error)
      }
    } catch { setError(t('errors.loadNextQuestion')) }
    finally { setBusy(false) }
  }

  // ── Stage: Confirm → Payment ───────────────────────────────────────────────
  async function proceedToPayment() {
    setBusy(true); setError('')
    try {
      const { data } = await api.post<{ id: string; status: string }>('/farmer/subscriptions', {
        package_id: packageId,
        client_id: clientId,
        subscription_type: 'SELF',
      })
      setSubscription(data)
      // Coaching sandbox: backend flips the sub straight to ACTIVE
      // for a student subscribing to their own workspace (no
      // Razorpay path exists for is_coaching clients). Skip the
      // payment stage entirely — otherwise the student sees a
      // confusing payment screen, taps the staging-bypass button,
      // and hits an error because the sub is already ACTIVE.
      setStage(data.status === 'ACTIVE' ? 'done' : 'payment')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || t('errors.createSub'))
    } finally { setBusy(false) }
  }

  // ── Razorpay payment ───────────────────────────────────────────────────────
  const openRazorpay = useCallback(async () => {
    if (!subscription) return
    setError('')
    try {
      const { data: order } = await api.post(`/farmer/subscriptions/${subscription.id}/payment/create-order`)
      const options = {
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        // Attribution must be visible in the Razorpay sheet itself —
        // the farmer is paying for the software infrastructure that
        // rootsTALK.in provides, NOT paying the company. Company
        // name appears in the description for the farmer's context.
        name: 'rootsTALK.in',
        description: company?.display_name
          ? t('razorpayDescriptionWithCompany', { company: company.display_name })
          : t('razorpayDescription'),
        order_id: order.razorpay_order_id,
        prefill: { name: user?.name || '', contact: user?.phone || '' },
        theme: { color: '#3A7D44' },
        handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          try {
            await api.post(`/farmer/subscriptions/${subscription.id}/payment/verify`, {
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_signature: response.razorpay_signature,
            })
            setStage('done')
          } catch { setError(t('errors.paymentVerifyFailed')) }
        },
      }
      new window.Razorpay(options).open()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || t('errors.paymentInit'))
    }
  }, [subscription, user, t])

  // ── Staging-only bypass — skip Razorpay entirely ────────────────────────────
  // Razorpay TEST mode rejects real UPI handles so demos can't flip
  // a sub to ACTIVE through the real checkout. Backend endpoint is
  // hard-gated to non-production; the button below is hidden on the
  // production PWA hostname so end users never see it.
  const isStaging = typeof window !== 'undefined'
    && /(?:^|\.)rstalk-pwa\.eywa\.farm$/i.test(window.location.hostname)
  const bypassPayment = useCallback(async () => {
    if (!subscription) return
    setError('')
    try {
      await api.post(`/farmer/subscriptions/${subscription.id}/payment/staging-bypass`)
      setStage('done')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || t('errors.stagingBypass'))
    }
  }, [subscription, t])

  // ── V1.1 share-payment-link (2026-05-29) ──────────────────────────────────
  // Anyone with the link/QR can pay via any UPI app; webhook reconciles.
  async function generateShareLink() {
    if (!subscription) return
    setBusy(true); setError('')
    try {
      const { data } = await api.post<{ payment_request_id: string }>(
        `/farmer/subscriptions/${subscription.id}/payment-link`,
      )
      router.push(`/share-link/${data.payment_request_id}`)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message
      setError(msg || t('errors.shareLinkFailed'))
    } finally { setBusy(false) }
  }

  // ── Delegate payment — two-step Check → Send ────────────────────────────
  async function checkDelegate() {
    if (!delegatePhone || delegatePhone.length < 10) return
    const fullPhone = `+91${delegatePhone.trim()}`
    if (user?.phone === fullPhone) {
      setCheckError(t('errors.selfPay'))
      return
    }
    setChecking(true); setCheckError(''); setDelegateLookup(null); setError('')
    try {
      const { data } = await api.get<DelegateLookup>(
        `/farmer/delegate-lookup?phone=${encodeURIComponent(fullPhone)}`,
      )
      setDelegateLookup(data)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message
            || t('errors.lookupFailed')
      setCheckError(msg)
    } finally { setChecking(false) }
  }

  async function sendDelegateRequest() {
    if (!subscription || !delegatePhone.trim()) return
    const fullPhone = `+91${delegatePhone.trim()}`
    if (user?.phone === fullPhone) {
      setError(t('errors.selfPay'))
      return
    }
    setBusy(true); setError('')
    try {
      const { data } = await api.post<{
        detail: string; expires_at: string;
        requested_from_name: string | null;
        requested_from_phone: string | null;
      }>(`/farmer/subscriptions/${subscription.id}/delegate-payment`, {
        delegate_phone: fullPhone,
        role: delegateRole,
      })
      setDelegateSentInfo({
        name: data.requested_from_name,
        phone: data.requested_from_phone,
        expiresAt: data.expires_at,
      })
      setStage('delegate_sent')
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message
            || t('errors.sendDelegateFailed')
      setError(msg)
    } finally { setBusy(false) }
  }

  // ── Start over: reset answers and restart guided questions on the same
  //     company. Different intent from goBack() (which exits the stage).
  async function startOver() {
    if (!company) return
    setError('')
    await selectCompany(company)
  }

  // ── Back navigation ────────────────────────────────────────────────────────
  function goBack() {
    setError('')
    if (stage === 'crop') setStage('location')
    else if (stage === 'company') setStage('crop')
    else if (stage === 'guided') {
      // reset guided state and go back to company selection
      setAnswers('')
      setSelectedVars([])
      setGuidedStep(null)
      setGuidedQuestionIndex(0)
      setStage('company')
    }
    else if (stage === 'confirm') {
      // Pre-fix this routed to 'guided' and re-called selectCompany,
      // which immediately re-resolved to 'confirm' in the single-
      // package case — felt like the Back button did nothing.
      // Cleanest exit: drop to the company picker so the user can
      // pick a different company or reset the crop.
      setAnswers('')
      setSelectedVars([])
      setGuidedStep(null)
      setGuidedQuestionIndex(0)
      setPackageId('')
      setPackageDescription(null)
      setStage('company')
    }
    else if (stage === 'payment') {
      // If the user arrived via ?resume=<id> (no crop pick), the
      // confirm stage has no data to render — bounce back to Home
      // instead of into a broken confirm screen.
      if (!cropId) router.replace('/home')
      else setStage('confirm')
    }
    else if (stage === 'delegate') setStage('payment')
  }

  // ── Heading by stage ───────────────────────────────────────────────────────
  const titles: Record<Stage, string> = {
    location: t('titles.location'),
    crop: t('titles.crop'),
    company: t('titles.company'),
    guided: t('titles.guided'),
    confirm: t('titles.confirm'),
    payment: t('titles.payment'),
    delegate: t('titles.delegate'),
    delegate_sent: t('titles.delegateSent'),
    done: t('titles.done'),
  }

  // Prefer the resolved name captured at selection time; fall
  // back to the shared resolver (which UUID-safes and de-slugs).
  const cropDisplay = cropId ? cropDisplayName(cropId, cropName) : ''

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <div className="min-h-screen bg-[#F5F0E8]">

        {/* Done stage: full-screen green */}
        {stage === 'done' ? (
          <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
            style={{ background: 'linear-gradient(160deg, #065f46, #3A7D44)' }}>
            <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center mb-6">
              <span className="text-3xl text-green-700">✓</span>
            </div>
            <h1 className="text-2xl font-bold text-white">{t('done.heading')}</h1>
            <p className="text-white/70 mt-2 max-w-[280px]">
              {t('done.body', { crop: cropDisplay, company: company?.display_name || '' })}
            </p>
            <p className="text-white/50 text-sm mt-3">
              {t('done.hint')}
            </p>
            <button
              onClick={() => router.replace('/home')}
              className="mt-10 py-4 px-10 rounded-2xl font-semibold bg-white"
              style={{ color: '#3A7D44' }}>
              {t('done.cta')}
            </button>
          </div>
        ) : stage === 'delegate_sent' ? (
          <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
            style={{ background: 'linear-gradient(160deg, #1e3a5f, #2a4d6f)' }}>
            <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center mb-6">
              <span className="text-3xl">📤</span>
            </div>
            <h1 className="text-2xl font-bold text-white">{t('delegateSent.heading')}</h1>
            {delegateSentInfo.name || delegateSentInfo.phone ? (
              <p className="text-white/85 mt-3 max-w-[280px]">
                {t('delegateSent.askedPrefix')}{' '}
                <strong>{delegateSentInfo.name || t('delegateSent.recipientFallback')}</strong>
                {delegateSentInfo.phone && (
                  <> (<span className="font-mono">{delegateSentInfo.phone}</span>)</>
                )}
                {' '}{t('delegateSent.askedToPay', { crop: cropDisplay, company: company?.display_name || '', price: user?.subscription_amount_inr ?? 199 })}
              </p>
            ) : (
              <p className="text-white/85 mt-3 max-w-[280px]">
                {t('delegateSent.bodyWithoutName', { crop: cropDisplay, company: company?.display_name || '', price: user?.subscription_amount_inr ?? 199 })}
              </p>
            )}
            <p className="text-white/60 text-sm mt-4 max-w-[280px]">
              {t('delegateSent.hint')}
            </p>
            <div className="flex flex-col gap-2 mt-10 w-full max-w-[280px]">
              <button
                onClick={() => router.replace('/home')}
                className="py-4 rounded-2xl font-semibold bg-white"
                style={{ color: '#1e3a5f' }}>
                {t('delegateSent.goHome')}
              </button>
              <button
                onClick={() => router.replace('/my-subscriptions')}
                className="py-3 rounded-2xl font-medium text-white/85 border border-white/30">
                {t('delegateSent.trackRequest')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <PWAHeader title={titles[stage]} activeRole="FARMER" back />
            <div className="pt-16 pb-24 px-4">

              {/* Back row — every stage has an exit. The location
                  stage is the flow's entry point, so back goes all
                  the way out to /home; subsequent stages cycle
                  back one step via goBack(). */}
              {stage === 'location' ? (
                <button onClick={() => router.replace('/home')}
                  className="mt-4 mb-2 flex items-center gap-1 text-[#7A8C7E] text-sm">
                  {t('backToHome')}
                </button>
              ) : (
                <button onClick={goBack}
                  className="mt-4 mb-2 flex items-center gap-1 text-[#7A8C7E] text-sm">
                  {t('backShort')}
                </button>
              )}

              <div className="bg-white rounded-2xl shadow-sm border border-[#DDD0B8] mt-2 p-5">
                <ProgressBar stage={stage} />

                {/* ── STAGE 1: Location ── */}
                {stage === 'location' && (() => {
                  const coshStates = coshLocations?.states ?? []
                  const filteredStates = coshStates
                    .filter(s => s.name)
                    .filter(s => !stateSearch || (s.name || '').toLowerCase().includes(stateSearch.toLowerCase()))
                  const selectedState = coshStates.find(s => s.cosh_id === stateId) || null
                  const filteredDistricts = (selectedState?.districts ?? [])
                    .filter(d => d.name)
                    .filter(d => !districtSearch || (d.name || '').toLowerCase().includes(districtSearch.toLowerCase()))
                  const hasSavedLocation = !!(district && districtName)

                  return (
                    <div>
                      <h2 className="text-lg font-bold text-[#6B3F1F]">{t('location.title')}</h2>
                      <p className="text-[#7A8C7E] text-sm mt-0.5 mb-5">
                        {t('location.subtitle')}
                      </p>

                      {!coshLocations && (
                        <div className="flex items-center gap-3 text-[#7A8C7E] text-sm mb-4">
                          <div className="w-4 h-4 border-2 border-[#DDD0B8] border-t-[#3A7D44] rounded-full animate-spin"/>
                          {tLocation('loading')}
                        </div>
                      )}

                      {/* Saved-location chip (collapsed view). Tap
                          Change to expand the typeahead pickers. */}
                      {coshLocations && hasSavedLocation && !editingLocation && (
                        <div className="mb-4 px-4 py-3 rounded-2xl border border-[#3A7D44]/30 bg-[#3A7D44]/10 flex items-start gap-3">
                          <span className="text-lg leading-none mt-0.5">📍</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] uppercase tracking-wide font-semibold text-[#3A7D44]">{t('location.savedLabel')}</p>
                            <p className="text-[#6B3F1F] font-semibold text-[15px] mt-0.5">
                              {districtName} <span className="text-[#7A8C7E] font-normal">· {stateName || '—'}</span>
                            </p>
                          </div>
                          <button onClick={() => { setEditingLocation(true); setStateSearch(''); setDistrictSearch('') }}
                            className="text-[12px] text-[#3A7D44] underline shrink-0">
                            {tCommon('change')}
                          </button>
                        </div>
                      )}

                      {/* Typeahead pickers — shown when no saved
                          location yet OR the user tapped Change. */}
                      {coshLocations && (!hasSavedLocation || editingLocation) && (
                        <div className="space-y-3 mb-2">
                          {/* State */}
                          <div>
                            <label className="text-xs text-[#7A8C7E] font-medium mb-1 block">{tLocation('stateLabel')}</label>
                            {stateId ? (
                              <div className="flex items-center gap-2">
                                <span className="bg-[#3A7D44]/10 text-[#3A7D44] text-sm font-medium px-3 py-1.5 rounded-full">
                                  {stateName || t('location.unnamed')}
                                </span>
                                <button onClick={() => {
                                    setStateId(''); setStateName(''); setStateSearch('')
                                    setDistrict(''); setDistrictName(''); setDistrictSearch('')
                                  }}
                                  className="text-[11px] text-[#7A8C7E] underline">{tCommon('change')}</button>
                              </div>
                            ) : (
                              <>
                                <input value={stateSearch} onChange={e => setStateSearch(e.target.value)}
                                  placeholder={tLocation('searchState')}
                                  className="w-full border border-[#DDD0B8] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3A7D44]/30 focus:border-[#3A7D44]"/>
                                {stateSearch && (
                                  <div className="mt-1 border border-[#DDD0B8] rounded-xl overflow-hidden max-h-40 overflow-y-auto bg-white">
                                    {filteredStates.length === 0
                                      ? <p className="text-[#7A8C7E] text-sm px-4 py-3">{tLocation('noStates')}</p>
                                      : filteredStates.map(s => (
                                        <button key={s.cosh_id}
                                          onClick={() => { setStateId(s.cosh_id); setStateSearch('') }}
                                          className="w-full text-left px-4 py-2.5 text-sm text-[#6B3F1F] hover:bg-[#F5F0E8] border-b border-[#DDD0B8] last:border-0">
                                          {s.name}
                                        </button>
                                      ))
                                    }
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          {/* District — bounded to the chosen state */}
                          {stateId && (
                            <div>
                              <label className="text-xs text-[#7A8C7E] font-medium mb-1 block">{tLocation('districtLabel')}</label>
                              {district ? (
                                <div className="flex items-center gap-2">
                                  <span className="bg-[#3A7D44]/10 text-[#3A7D44] text-sm font-medium px-3 py-1.5 rounded-full">
                                    {districtName || t('location.unnamed')}
                                  </span>
                                  <button onClick={() => { setDistrict(''); setDistrictName(''); setDistrictSearch('') }}
                                    className="text-[11px] text-[#7A8C7E] underline">{tCommon('change')}</button>
                                </div>
                              ) : (
                                <>
                                  <input value={districtSearch} onChange={e => setDistrictSearch(e.target.value)}
                                    placeholder={tLocation('searchDistrict')}
                                    className="w-full border border-[#DDD0B8] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3A7D44]/30 focus:border-[#3A7D44]"/>
                                  {(districtSearch || (selectedState?.districts.length || 0) <= 30) && (
                                    <div className="mt-1 border border-[#DDD0B8] rounded-xl overflow-hidden max-h-40 overflow-y-auto bg-white">
                                      {filteredDistricts.length === 0
                                        ? <p className="text-[#7A8C7E] text-sm px-4 py-3">{tLocation('noDistricts')}</p>
                                        : filteredDistricts.map(d => (
                                          <button key={d.cosh_id}
                                            onClick={() => { setDistrict(d.cosh_id); setDistrictSearch('') }}
                                            className="w-full text-left px-4 py-2.5 text-sm text-[#6B3F1F] hover:bg-[#F5F0E8] border-b border-[#DDD0B8] last:border-0">
                                            {d.name}
                                          </button>
                                        ))
                                      }
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}

                          {editingLocation && hasSavedLocation && (
                            <button onClick={() => setEditingLocation(false)}
                              className="text-[12px] text-[#7A8C7E] underline mt-1">
                              {t('location.useSaved')}
                            </button>
                          )}
                        </div>
                      )}

                      {error && <p className="text-sm text-[#D4682E] mt-3">{error}</p>}

                      <button
                        onClick={proceedFromLocation}
                        disabled={busy || !district || !stateId}
                        className="mt-5 w-full py-4 rounded-2xl text-white font-semibold text-sm disabled:opacity-50"
                        style={{ background: '#3A7D44' }}>
                        {busy ? t('location.loadingShort') : t('location.findAdvisories')}
                      </button>
                    </div>
                  )
                })()}

                {/* ── STAGE 2: Crop Selection ── */}
                {stage === 'crop' && (
                  <div>
                    <h2 className="text-lg font-bold text-[#6B3F1F]">{t('crop.title')}</h2>
                    <p className="text-[#7A8C7E] text-sm mt-0.5 mb-5">
                      {t('crop.subtitle')}
                    </p>

                    {crops.length === 0 ? (
                      <div className="text-center py-10">
                        <p className="text-[#7A8C7E] text-sm">
                          {t('crop.empty')}
                        </p>
                        <button onClick={() => setStage('location')}
                          className="mt-4 text-green-700 text-sm font-medium">
                          {t('crop.changeLocation')}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {crops.map(c => (
                          <button
                            key={c.crop_cosh_id}
                            onClick={() => selectCrop(c.crop_cosh_id)}
                            className="w-full text-left px-4 py-4 rounded-2xl border-2 border-[#DDD0B8] hover:border-green-200 hover:bg-green-50 transition-all active:scale-[0.98]">
                            <p className="font-medium text-[#6B3F1F]">{cropDisplayName(c.crop_cosh_id, c.name)}</p>
                          </button>
                        ))}
                      </div>
                    )}

                    {error && <p className="text-sm text-[#D4682E] mt-3">{error}</p>}
                    {busy && <div className="h-12 bg-[#F5F0E8] rounded-2xl animate-pulse mt-2" />}
                  </div>
                )}

                {/* ── STAGE 3: Company Selection ── */}
                {stage === 'company' && (
                  <div>
                    <h2 className="text-lg font-bold text-[#6B3F1F]">{t('company.title')}</h2>
                    <p className="text-[#7A8C7E] text-sm mt-0.5 mb-5">
                      {t('company.subtitle', { crop: cropDisplay })}
                    </p>

                    {busy ? (
                      <div className="space-y-3">
                        {[1, 2].map(i => <div key={i} className="h-20 bg-[#F5F0E8] rounded-2xl animate-pulse" />)}
                      </div>
                    ) : companies.length === 0 ? (
                      <div className="text-center py-10">
                        <p className="text-[#7A8C7E] text-sm">
                          {t('company.empty')}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {companies.map(c => (
                          <div key={c.id}
                            className="rounded-2xl overflow-hidden border border-[#DDD0B8] shadow-sm">
                            <CompanyLogo company={c} />
                            {c.tagline && (
                              <p className="text-[#7A8C7E] text-sm px-4 py-2">{c.tagline}</p>
                            )}
                            <div className="px-4 pb-4 pt-1">
                              <button
                                onClick={() => selectCompany(c)}
                                className="w-full py-3 rounded-xl text-white text-sm font-semibold"
                                style={{ background: c.primary_colour || '#3A7D44' }}>
                                {t('company.explore')}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {error && <p className="text-sm text-[#D4682E] mt-3">{error}</p>}
                  </div>
                )}

                {/* ── STAGE 4: Guided PoP Questions ── */}
                {stage === 'guided' && (
                  <div>
                    <h2 className="text-lg font-bold text-[#6B3F1F]">
                      {guidedQuestionIndex === 0 ? t('guided.firstTitle') : t('guided.followupTitle')}
                    </h2>
                    <p className="text-[#7A8C7E] text-sm mt-0.5 mb-5">
                      {t('guided.subtitle')}
                    </p>

                    {busy ? (
                      <div className="space-y-3">
                        <div className="h-6 w-2/3 bg-[#F5F0E8] rounded animate-pulse" />
                        <div className="grid grid-cols-2 gap-3">
                          {[1, 2, 3, 4].map(i => <div key={i} className="h-16 bg-[#F5F0E8] rounded-2xl animate-pulse" />)}
                        </div>
                      </div>
                    ) : guidedStep && !guidedStep.done && guidedStep.parameter ? (
                      <div>
                        {guidedStep.remaining_count != null && (
                          <p className="text-xs text-[#7A8C7E] mb-2">
                            {t('guided.narrowingFrom', { count: guidedStep.remaining_count })}
                          </p>
                        )}
                        <p className="text-[#6B3F1F] font-semibold text-lg mb-4">
                          {guidedStep.parameter.name}
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          {(guidedStep.variables || []).map(v => (
                            <button
                              key={v.id}
                              onClick={() => selectVariable(guidedStep.parameter!.id, v.id, guidedStep.parameter!.name, v.name)}
                              className="py-4 px-3 rounded-2xl border-2 border-[#DDD0B8] text-center text-sm font-medium text-[#6B3F1F] hover:border-green-400 hover:bg-green-50 transition-all active:scale-[0.97]">
                              {v.name}
                            </button>
                          ))}
                        </div>
                        {selectedVars.length > 0 && (
                          <button
                            onClick={startOver}
                            disabled={busy}
                            className="mt-5 w-full py-3 rounded-2xl text-[#7A8C7E] text-sm disabled:opacity-50">
                            {t('guided.startOver')}
                          </button>
                        )}
                      </div>
                    ) : guidedStep?.error ? (
                      <div className="text-center py-8">
                        <p className="text-[#D4682E] text-sm">{guidedStep.error}</p>
                        <button onClick={() => setStage('company')}
                          className="mt-4 text-green-700 text-sm font-medium">
                          {t('guided.differentCompany')}
                        </button>
                      </div>
                    ) : null}

                    {error && <p className="text-sm text-[#D4682E] mt-3">{error}</p>}
                  </div>
                )}

                {/* ── STAGE 5: Confirmation ── */}
                {stage === 'confirm' && company && (
                  <div>
                    <h2 className="text-lg font-bold text-[#6B3F1F]">{t('confirm.title')}</h2>
                    <p className="text-[#7A8C7E] text-sm mt-0.5 mb-5">
                      {selectedVars.length > 0
                        ? t('confirm.subtitleAnswers')
                        : t('confirm.subtitleOnly')}
                    </p>

                    <div className="rounded-2xl overflow-hidden border border-[#DDD0B8] mb-5">
                      <CompanyLogo company={company} />
                      <div className="p-4">
                        <p className="font-semibold text-[#6B3F1F] text-base">
                          {cropDisplay}
                        </p>
                        {packageDescription && (
                          <p className="text-sm text-[#6B3F1F] mt-2 mb-3 leading-relaxed"
                            style={{ whiteSpace: 'pre-wrap' }}>
                            {packageDescription}
                          </p>
                        )}
                        {selectedVars.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-[#DDD0B8] space-y-1">
                            <p className="text-[11px] uppercase tracking-wide text-[#7A8C7E] font-semibold mb-1">
                              {t('confirm.selectionsLabel')}
                            </p>
                            {selectedVars.map((sv, i) => (
                              <p key={i} className="text-sm text-[#6B3F1F]">
                                • {sv.paramName}: <span className="font-medium">{sv.varName}</span>
                              </p>
                            ))}
                          </div>
                        )}
                        <div className="mt-4 pt-4 border-t border-[#DDD0B8] flex items-center justify-between">
                          <span className="text-[#7A8C7E] text-sm">{t('confirm.priceLabel')}</span>
                          <span className="text-[#6B3F1F] font-bold text-lg">{t('confirm.priceAmount', { price: user?.subscription_amount_inr ?? 199 })}</span>
                        </div>
                      </div>
                    </div>

                    {error && <p className="text-sm text-[#D4682E] mb-3">{error}</p>}

                    <button
                      onClick={proceedToPayment}
                      disabled={busy}
                      className="w-full py-4 rounded-2xl text-white font-semibold text-sm disabled:opacity-50"
                      style={{ background: '#3A7D44' }}>
                      {busy ? t('confirm.settingUp') : t('confirm.proceedCta')}
                    </button>
                    <button
                      onClick={startOver}
                      disabled={busy}
                      className="w-full mt-2 py-3 rounded-2xl text-[#7A8C7E] text-sm disabled:opacity-50">
                      {t('guided.startOver')}
                    </button>
                  </div>
                )}

                {/* ── STAGE 6: Payment ── */}
                {stage === 'payment' && subscription && (
                  <div>
                    <h2 className="text-lg font-bold text-[#6B3F1F]">{t('payment.title')}</h2>
                    <p className="text-[#7A8C7E] text-sm mt-0.5 mb-3">
                      {t('payment.subtitle')}
                    </p>

                    {/* Payment attribution — the farmer is paying for
                        software infrastructure provided by rootsTALK.in,
                        not paying the company. Same disclaimer renders
                        on the Razorpay sheet description. */}
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4 text-xs text-amber-800">
                      {t('payment.attributionPrefix', { price: user?.subscription_amount_inr ?? 199 })} <strong>rootsTALK.in</strong> {t('payment.attributionMiddle')} <em>{t('payment.attributionNot')}</em> {t('payment.attributionSuffix', { company: company?.display_name || t('payment.attributionCompanyFallback') })}
                    </div>

                    <div className="space-y-3">
                      {/* Pay yourself */}
                      <div className="rounded-2xl border-2 border-[#DDD0B8] p-4">
                        <p className="font-semibold text-[#6B3F1F]">{t('payment.payNow', { price: user?.subscription_amount_inr ?? 199 })}</p>
                        <p className="text-[#7A8C7E] text-sm mt-0.5 mb-3">
                          {t('payment.payNowBody')}
                        </p>
                        <button
                          onClick={openRazorpay}
                          className="w-full py-3.5 rounded-xl text-white font-semibold text-sm"
                          style={{ background: '#3A7D44' }}>
                          {t('payment.payUpi')}
                        </button>
                        {isStaging && (
                          <button
                            onClick={bypassPayment}
                            className="w-full mt-2 py-2.5 rounded-xl text-xs font-semibold border border-dashed border-amber-400 text-amber-700 bg-amber-50">
                            {t('payment.stagingBypass')}
                          </button>
                        )}
                      </div>

                      {/* Ask a dealer */}
                      <div className="rounded-2xl border-2 border-[#DDD0B8] p-4">
                        <p className="font-semibold text-[#6B3F1F]">{t('payment.askDealer')}</p>
                        <p className="text-[#7A8C7E] text-sm mt-0.5 mb-3">
                          {t('payment.askDealerBody')}
                        </p>
                        <button
                          onClick={() => { setDelegateRole('DEALER'); setStage('delegate') }}
                          className="w-full py-3.5 rounded-xl text-white font-semibold text-sm"
                          style={{ background: '#3A7D44' }}>
                          {t('payment.selectDealer')}
                        </button>
                      </div>

                      {/* Ask a facilitator */}
                      <div className="rounded-2xl border-2 border-[#DDD0B8] p-4">
                        <p className="font-semibold text-[#6B3F1F]">{t('payment.askFacilitator')}</p>
                        <p className="text-[#7A8C7E] text-sm mt-0.5 mb-3">
                          {t('payment.askFacilitatorBody')}
                        </p>
                        <button
                          onClick={() => { setDelegateRole('FACILITATOR'); setStage('delegate') }}
                          className="w-full py-3.5 rounded-xl text-white font-semibold text-sm"
                          style={{ background: '#3A7D44' }}>
                          {t('payment.selectFacilitator')}
                        </button>
                      </div>

                      {/* Share a payment link / QR — V1.1 (2026-05-29).
                          Anyone (relative in a city, friend) can pay via
                          any UPI app. They don't need to be on RootsTalk. */}
                      <div className="rounded-2xl border-2 p-4"
                        style={{ borderColor: '#3A7D44', background: '#F0F9F2' }}>
                        <div className="flex items-start gap-2">
                          <span className="text-xl leading-none mt-0.5">🔗</span>
                          <div className="flex-1">
                            <p className="font-semibold text-[#6B3F1F]">
                              {t('payment.shareLink')}
                            </p>
                            <p className="text-[#7A8C7E] text-sm mt-0.5 mb-3">
                              {t('payment.shareLinkBody')}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={generateShareLink}
                          disabled={busy}
                          className="w-full py-3.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
                          style={{ background: '#3A7D44' }}>
                          {busy ? t('payment.generating') : t('payment.generateCta')}
                        </button>
                      </div>
                    </div>

                    {error && <p className="text-sm text-[#D4682E] mt-3">{error}</p>}
                  </div>
                )}

                {/* ── STAGE 7: Delegate payment ── */}
                {stage === 'delegate' && subscription && (
                  <div>
                    <h2 className="text-lg font-bold text-[#6B3F1F]">{t('delegate.title')}</h2>
                    <p className="text-[#7A8C7E] text-sm mt-0.5 mb-5">
                      {delegateRole === 'DEALER' ? t('delegate.subtitleDealer') : t('delegate.subtitleFacilitator')}
                    </p>

                    <div className="flex items-center border border-[#DDD0B8] rounded-xl overflow-hidden mb-3">
                      <span className="px-4 py-3 bg-[#F5F0E8] text-[#7A8C7E] text-sm font-mono border-r border-[#DDD0B8]">
                        +91
                      </span>
                      <input
                        value={delegatePhone}
                        onChange={e => {
                          setDelegatePhone(e.target.value.replace(/\D/g, '').slice(0, 10))
                          // Editing the phone invalidates any prior
                          // lookup — force a re-check before Send.
                          setDelegateLookup(null)
                          setCheckError('')
                          setError('')
                        }}
                        placeholder={t('delegate.phonePlaceholder')}
                        inputMode="numeric"
                        className="flex-1 px-4 py-3 text-sm focus:outline-none font-mono"
                      />
                    </div>

                    {/* Confirmation card after a successful Check. The
                        Send button only appears once a lookup has
                        verified the person is an onboarded
                        Facilitator/Dealer. */}
                    {delegateLookup && (
                      <div className="rounded-2xl border-2 p-4 mb-3"
                        style={{ borderColor: '#3A7D44', background: '#F0F9F2' }}>
                        <div className="flex items-start gap-2 mb-2">
                          <span className="text-xl leading-none mt-0.5">✓</span>
                          <div className="flex-1">
                            <p className="font-semibold text-[#3A7D44]">
                              {delegateLookup.name || t('delegate.registeredUser')}
                            </p>
                            <p className="text-[#7A8C7E] text-xs font-mono">
                              {delegateLookup.phone}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {delegateLookup.roles.map(r => (
                            <span key={r} className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                              style={{ background: '#3A7D44', color: 'white' }}>
                              {r === 'FACILITATOR' ? t('delegate.facilitatorChip') : t('delegate.dealerChip')}
                            </span>
                          ))}
                        </div>
                        <p className="text-[12px] text-[#6B3F1F]">
                          {delegateLookup.affiliations.length === 1
                            ? t('delegate.atSingle', { company: delegateLookup.affiliations[0].company_name })
                            : t('delegate.atMultiple', { companies: delegateLookup.affiliations.map(a => a.company_name).join(', ') })}
                        </p>
                      </div>
                    )}

                    {checkError && (
                      <div className="rounded-xl border border-[#D4682E] bg-red-50 p-3 mb-3">
                        <p className="text-sm text-[#D4682E] font-medium">{t('delegate.cannotSendTitle')}</p>
                        <p className="text-xs text-[#7A2F0F] mt-1">{checkError}</p>
                      </div>
                    )}

                    {error && <p className="text-sm text-[#D4682E] mb-3">{error}</p>}

                    {/* Step 1: Check */}
                    {!delegateLookup && (
                      <button
                        onClick={checkDelegate}
                        disabled={checking || delegatePhone.length < 10}
                        className="w-full py-4 rounded-2xl text-white font-semibold text-sm disabled:opacity-50"
                        style={{ background: '#3A7D44' }}>
                        {checking ? tCommon('working') : checkError ? t('delegate.checkAgain') : t('delegate.check')}
                      </button>
                    )}

                    {/* Step 2: Send (only after a successful Check) */}
                    {delegateLookup && (
                      <button
                        onClick={sendDelegateRequest}
                        disabled={busy}
                        className="w-full py-4 rounded-2xl text-white font-semibold text-sm disabled:opacity-50"
                        style={{ background: '#3A7D44' }}>
                        {busy
                          ? tCommon('saving')
                          : t('delegate.sendRequest', { name: delegateLookup.name || t('delegate.fallbackName') })}
                      </button>
                    )}

                    <button
                      onClick={() => setStage('payment')}
                      className="w-full mt-2 py-3 rounded-2xl text-[#7A8C7E] text-sm">
                      {t('delegate.payMyself')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
