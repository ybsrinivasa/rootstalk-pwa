'use client'
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
  const [packageName, setPackageName] = useState('')
  const [packageDescription, setPackageDescription] = useState<string | null>(null)
  const [guidedStep, setGuidedStep] = useState<GuidedStep | null>(null)
  const [guidedQuestionIndex, setGuidedQuestionIndex] = useState(0)

  // Subscription
  const [subscription, setSubscription] = useState<{ id: string } | null>(null)

  // Delegate payment
  const [delegatePhone, setDelegatePhone] = useState('')
  const [delegateRole, setDelegateRole] = useState<'DEALER' | 'FACILITATOR'>('DEALER')

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
        setPackageName(sub.package_name || '')
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
    if (!district) { setError('Please pick your district.'); return }
    setBusy(true); setError('')
    try {
      const { data } = await api.get<{ crop_cosh_id: string; name?: string | null }[]>('/farmer/discover/crops', {
        params: { district_cosh_id: district },
      })
      setCrops(data)
      setStage('crop')
    } catch { setError('Could not load crops for this area.') }
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
    } catch { setError('Could not load companies.') }
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
        setPackageName(data.package.name)
        setPackageDescription(data.package.description)
        setStage('confirm')
      } else if (data.error) {
        setError(data.error)
      } else {
        setStage('guided')
      }
    } catch { setError('Could not start the advisory finder.') }
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
        setPackageName(data.package.name)
        setPackageDescription(data.package.description)
        setStage('confirm')
      } else if (data.error) {
        setError(data.error)
      }
    } catch { setError('Could not load next question.') }
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
      setStage('payment')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Could not create subscription.')
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
        description: `Advisory subscription · paid to rootsTALK.in${company?.display_name ? ` (not to ${company.display_name})` : ''}`,
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
          } catch { setError('Payment verification failed. Contact support.') }
        },
      }
      new window.Razorpay(options).open()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Could not initiate payment.')
    }
  }, [subscription, user])

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
      setError(msg || 'Could not activate (staging bypass).')
    }
  }, [subscription])

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
      setError(msg || 'Could not generate the payment link. Please try again.')
    } finally { setBusy(false) }
  }

  // ── Delegate payment ───────────────────────────────────────────────────────
  async function sendDelegateRequest() {
    if (!subscription || !delegatePhone.trim()) return
    const fullPhone = `+91${delegatePhone.trim()}`
    if (user?.phone === fullPhone) {
      setError('You cannot ask yourself to pay. Please choose someone else.')
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
            || 'Could not send payment request. Check the phone number and try again.'
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
      setPackageName('')
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
    location: 'Find advisories',
    crop: 'Select crop',
    company: 'Choose company',
    guided: 'Find your advisory',
    confirm: 'Your advisory',
    payment: 'Almost there',
    delegate: 'Send request',
    delegate_sent: 'Request sent',
    done: 'Subscribed!',
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
            <h1 className="text-2xl font-bold text-white">You&apos;re subscribed!</h1>
            <p className="text-white/70 mt-2 max-w-[280px]">
              Your {cropDisplay} advisory from {company?.display_name} is now active.
            </p>
            <p className="text-white/50 text-sm mt-3">
              Set your sowing date to unlock the advisory.
            </p>
            <button
              onClick={() => router.replace('/home')}
              className="mt-10 py-4 px-10 rounded-2xl font-semibold bg-white"
              style={{ color: '#3A7D44' }}>
              Go to your advisory →
            </button>
          </div>
        ) : stage === 'delegate_sent' ? (
          <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
            style={{ background: 'linear-gradient(160deg, #1e3a5f, #2a4d6f)' }}>
            <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center mb-6">
              <span className="text-3xl">📤</span>
            </div>
            <h1 className="text-2xl font-bold text-white">Payment request sent</h1>
            {delegateSentInfo.name || delegateSentInfo.phone ? (
              <p className="text-white/85 mt-3 max-w-[280px]">
                Asked{' '}
                <strong>{delegateSentInfo.name || 'the recipient'}</strong>
                {delegateSentInfo.phone && (
                  <> (<span className="font-mono">{delegateSentInfo.phone}</span>)</>
                )}
                {' '}to pay ₹199 for your {cropDisplay} advisory from {company?.display_name}.
              </p>
            ) : (
              <p className="text-white/85 mt-3 max-w-[280px]">
                Your request to pay ₹199 for the {cropDisplay} advisory from {company?.display_name} has been sent.
              </p>
            )}
            <p className="text-white/60 text-sm mt-4 max-w-[280px]">
              You&apos;ll be notified the moment they pay. The request expires in 24 hours;
              your advisory goes active as soon as the payment is completed.
            </p>
            <div className="flex flex-col gap-2 mt-10 w-full max-w-[280px]">
              <button
                onClick={() => router.replace('/home')}
                className="py-4 rounded-2xl font-semibold bg-white"
                style={{ color: '#1e3a5f' }}>
                Go home
              </button>
              <button
                onClick={() => router.replace('/my-subscriptions')}
                className="py-3 rounded-2xl font-medium text-white/85 border border-white/30">
                Track this request →
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
                  ← Back to home
                </button>
              ) : (
                <button onClick={goBack}
                  className="mt-4 mb-2 flex items-center gap-1 text-[#7A8C7E] text-sm">
                  ← Back
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
                      <h2 className="text-lg font-bold text-[#6B3F1F]">Where is your farm?</h2>
                      <p className="text-[#7A8C7E] text-sm mt-0.5 mb-5">
                        We&apos;ll find advisories available in your area
                      </p>

                      {!coshLocations && (
                        <div className="flex items-center gap-3 text-[#7A8C7E] text-sm mb-4">
                          <div className="w-4 h-4 border-2 border-[#DDD0B8] border-t-[#3A7D44] rounded-full animate-spin"/>
                          Loading states and districts…
                        </div>
                      )}

                      {/* Saved-location chip (collapsed view). Tap
                          Change to expand the typeahead pickers. */}
                      {coshLocations && hasSavedLocation && !editingLocation && (
                        <div className="mb-4 px-4 py-3 rounded-2xl border border-[#3A7D44]/30 bg-[#3A7D44]/10 flex items-start gap-3">
                          <span className="text-lg leading-none mt-0.5">📍</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] uppercase tracking-wide font-semibold text-[#3A7D44]">Your location</p>
                            <p className="text-[#6B3F1F] font-semibold text-[15px] mt-0.5">
                              {districtName} <span className="text-[#7A8C7E] font-normal">· {stateName || '—'}</span>
                            </p>
                          </div>
                          <button onClick={() => { setEditingLocation(true); setStateSearch(''); setDistrictSearch('') }}
                            className="text-[12px] text-[#3A7D44] underline shrink-0">
                            Change
                          </button>
                        </div>
                      )}

                      {/* Typeahead pickers — shown when no saved
                          location yet OR the user tapped Change. */}
                      {coshLocations && (!hasSavedLocation || editingLocation) && (
                        <div className="space-y-3 mb-2">
                          {/* State */}
                          <div>
                            <label className="text-xs text-[#7A8C7E] font-medium mb-1 block">State</label>
                            {stateId ? (
                              <div className="flex items-center gap-2">
                                <span className="bg-[#3A7D44]/10 text-[#3A7D44] text-sm font-medium px-3 py-1.5 rounded-full">
                                  {stateName || '(unnamed)'}
                                </span>
                                <button onClick={() => {
                                    setStateId(''); setStateName(''); setStateSearch('')
                                    setDistrict(''); setDistrictName(''); setDistrictSearch('')
                                  }}
                                  className="text-[11px] text-[#7A8C7E] underline">Change</button>
                              </div>
                            ) : (
                              <>
                                <input value={stateSearch} onChange={e => setStateSearch(e.target.value)}
                                  placeholder="Search state…"
                                  className="w-full border border-[#DDD0B8] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3A7D44]/30 focus:border-[#3A7D44]"/>
                                {stateSearch && (
                                  <div className="mt-1 border border-[#DDD0B8] rounded-xl overflow-hidden max-h-40 overflow-y-auto bg-white">
                                    {filteredStates.length === 0
                                      ? <p className="text-[#7A8C7E] text-sm px-4 py-3">No states found</p>
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
                              <label className="text-xs text-[#7A8C7E] font-medium mb-1 block">District</label>
                              {district ? (
                                <div className="flex items-center gap-2">
                                  <span className="bg-[#3A7D44]/10 text-[#3A7D44] text-sm font-medium px-3 py-1.5 rounded-full">
                                    {districtName || '(unnamed)'}
                                  </span>
                                  <button onClick={() => { setDistrict(''); setDistrictName(''); setDistrictSearch('') }}
                                    className="text-[11px] text-[#7A8C7E] underline">Change</button>
                                </div>
                              ) : (
                                <>
                                  <input value={districtSearch} onChange={e => setDistrictSearch(e.target.value)}
                                    placeholder="Search district…"
                                    className="w-full border border-[#DDD0B8] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3A7D44]/30 focus:border-[#3A7D44]"/>
                                  {(districtSearch || (selectedState?.districts.length || 0) <= 30) && (
                                    <div className="mt-1 border border-[#DDD0B8] rounded-xl overflow-hidden max-h-40 overflow-y-auto bg-white">
                                      {filteredDistricts.length === 0
                                        ? <p className="text-[#7A8C7E] text-sm px-4 py-3">No districts found</p>
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
                              ↺ Use my saved location instead
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
                        {busy ? 'Loading…' : 'Find advisories →'}
                      </button>
                    </div>
                  )
                })()}

                {/* ── STAGE 2: Crop Selection ── */}
                {stage === 'crop' && (
                  <div>
                    <h2 className="text-lg font-bold text-[#6B3F1F]">Select your crop</h2>
                    <p className="text-[#7A8C7E] text-sm mt-0.5 mb-5">
                      Advisories available in your area
                    </p>

                    {crops.length === 0 ? (
                      <div className="text-center py-10">
                        <p className="text-[#7A8C7E] text-sm">
                          No advisories are available in your area yet. Check back soon.
                        </p>
                        <button onClick={() => setStage('location')}
                          className="mt-4 text-green-700 text-sm font-medium">
                          ← Change location
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
                    <h2 className="text-lg font-bold text-[#6B3F1F]">Choose a company</h2>
                    <p className="text-[#7A8C7E] text-sm mt-0.5 mb-5">
                      Companies offering {cropDisplay} advisories in your area
                    </p>

                    {busy ? (
                      <div className="space-y-3">
                        {[1, 2].map(i => <div key={i} className="h-20 bg-[#F5F0E8] rounded-2xl animate-pulse" />)}
                      </div>
                    ) : companies.length === 0 ? (
                      <div className="text-center py-10">
                        <p className="text-[#7A8C7E] text-sm">
                          No company is offering an advisory for this crop in your area yet.
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
                                Explore advisory →
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
                      {guidedQuestionIndex === 0 ? 'Tell us about your farm' : 'One more thing'}
                    </h2>
                    <p className="text-[#7A8C7E] text-sm mt-0.5 mb-5">
                      We&apos;ll find the right advisory for you
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
                            Narrowing from {guidedStep.remaining_count} options
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
                            ↺ Start over
                          </button>
                        )}
                      </div>
                    ) : guidedStep?.error ? (
                      <div className="text-center py-8">
                        <p className="text-[#D4682E] text-sm">{guidedStep.error}</p>
                        <button onClick={() => setStage('company')}
                          className="mt-4 text-green-700 text-sm font-medium">
                          ← Choose a different company
                        </button>
                      </div>
                    ) : null}

                    {error && <p className="text-sm text-[#D4682E] mt-3">{error}</p>}
                  </div>
                )}

                {/* ── STAGE 5: Confirmation ── */}
                {stage === 'confirm' && company && (
                  <div>
                    <h2 className="text-lg font-bold text-[#6B3F1F]">Your advisory</h2>
                    <p className="text-[#7A8C7E] text-sm mt-0.5 mb-5">
                      {selectedVars.length > 0
                        ? 'Based on your answers'
                        : 'The only advisory matching your area'}
                    </p>

                    <div className="rounded-2xl overflow-hidden border border-[#DDD0B8] mb-5">
                      <CompanyLogo company={company} />
                      <div className="p-4">
                        {/* Package label — SE-authored. Crop label
                            stays as a subtle sub-line so the user
                            still sees the crop context. */}
                        <p className="font-semibold text-[#6B3F1F] text-base">
                          {packageName || `${cropDisplay} advisory`}
                        </p>
                        {packageName && (
                          <p className="text-xs text-[#7A8C7E] mt-0.5 mb-2">{cropDisplay}</p>
                        )}
                        {packageDescription && (
                          <p className="text-sm text-[#6B3F1F] mt-2 mb-3 leading-relaxed"
                            style={{ whiteSpace: 'pre-wrap' }}>
                            {packageDescription}
                          </p>
                        )}
                        {selectedVars.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-[#DDD0B8] space-y-1">
                            <p className="text-[11px] uppercase tracking-wide text-[#7A8C7E] font-semibold mb-1">
                              Your selections
                            </p>
                            {selectedVars.map((sv, i) => (
                              <p key={i} className="text-sm text-[#6B3F1F]">
                                • {sv.paramName}: <span className="font-medium">{sv.varName}</span>
                              </p>
                            ))}
                          </div>
                        )}
                        <div className="mt-4 pt-4 border-t border-[#DDD0B8] flex items-center justify-between">
                          <span className="text-[#7A8C7E] text-sm">Subscription price</span>
                          <span className="text-[#6B3F1F] font-bold text-lg">Rs. 199</span>
                        </div>
                      </div>
                    </div>

                    {error && <p className="text-sm text-[#D4682E] mb-3">{error}</p>}

                    <button
                      onClick={proceedToPayment}
                      disabled={busy}
                      className="w-full py-4 rounded-2xl text-white font-semibold text-sm disabled:opacity-50"
                      style={{ background: '#3A7D44' }}>
                      {busy ? 'Setting up…' : 'Looks right — proceed to payment →'}
                    </button>
                    <button
                      onClick={startOver}
                      disabled={busy}
                      className="w-full mt-2 py-3 rounded-2xl text-[#7A8C7E] text-sm disabled:opacity-50">
                      ↺ Start over
                    </button>
                  </div>
                )}

                {/* ── STAGE 6: Payment ── */}
                {stage === 'payment' && subscription && (
                  <div>
                    <h2 className="text-lg font-bold text-[#6B3F1F]">Almost there!</h2>
                    <p className="text-[#7A8C7E] text-sm mt-0.5 mb-3">
                      Choose how to pay for your advisory
                    </p>

                    {/* Payment attribution — the farmer is paying for
                        software infrastructure provided by rootsTALK.in,
                        not paying the company. Same disclaimer renders
                        on the Razorpay sheet description. */}
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4 text-xs text-amber-800">
                      ₹199 is paid to <strong>rootsTALK.in</strong> for the software
                      infrastructure. It is <em>not</em> paid to {company?.display_name || 'the company'}.
                    </div>

                    <div className="space-y-3">
                      {/* Pay yourself */}
                      <div className="rounded-2xl border-2 border-[#DDD0B8] p-4">
                        <p className="font-semibold text-[#6B3F1F]">Pay Rs. 199 now</p>
                        <p className="text-[#7A8C7E] text-sm mt-0.5 mb-3">
                          Instant activation after payment
                        </p>
                        <button
                          onClick={openRazorpay}
                          className="w-full py-3.5 rounded-xl text-white font-semibold text-sm"
                          style={{ background: '#3A7D44' }}>
                          Pay with UPI →
                        </button>
                        {isStaging && (
                          <button
                            onClick={bypassPayment}
                            className="w-full mt-2 py-2.5 rounded-xl text-xs font-semibold border border-dashed border-amber-400 text-amber-700 bg-amber-50">
                            ⚙ Staging: skip Razorpay, activate now
                          </button>
                        )}
                      </div>

                      {/* Ask a dealer */}
                      <div className="rounded-2xl border-2 border-[#DDD0B8] p-4">
                        <p className="font-semibold text-[#6B3F1F]">Ask a dealer to pay</p>
                        <p className="text-[#7A8C7E] text-sm mt-0.5 mb-3">
                          They become your Promoter and receive your order alerts
                        </p>
                        <button
                          onClick={() => { setDelegateRole('DEALER'); setStage('delegate') }}
                          className="w-full py-3.5 rounded-xl text-white font-semibold text-sm"
                          style={{ background: '#3A7D44' }}>
                          Select dealer →
                        </button>
                      </div>

                      {/* Ask a facilitator */}
                      <div className="rounded-2xl border-2 border-[#DDD0B8] p-4">
                        <p className="font-semibold text-[#6B3F1F]">Ask a facilitator to pay</p>
                        <p className="text-[#7A8C7E] text-sm mt-0.5 mb-3">
                          They coordinate delivery and become your Promoter
                        </p>
                        <button
                          onClick={() => { setDelegateRole('FACILITATOR'); setStage('delegate') }}
                          className="w-full py-3.5 rounded-xl text-white font-semibold text-sm"
                          style={{ background: '#3A7D44' }}>
                          Select facilitator →
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
                              Share a payment link / QR
                            </p>
                            <p className="text-[#7A8C7E] text-sm mt-0.5 mb-3">
                              Send a link to anyone — your son in the city, a relative, a friend. They pay via any UPI app.
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={generateShareLink}
                          disabled={busy}
                          className="w-full py-3.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
                          style={{ background: '#3A7D44' }}>
                          {busy ? 'Generating…' : 'Generate link & QR →'}
                        </button>
                      </div>
                    </div>

                    {error && <p className="text-sm text-[#D4682E] mt-3">{error}</p>}
                  </div>
                )}

                {/* ── STAGE 7: Delegate payment ── */}
                {stage === 'delegate' && subscription && (
                  <div>
                    <h2 className="text-lg font-bold text-[#6B3F1F]">Send payment request</h2>
                    <p className="text-[#7A8C7E] text-sm mt-0.5 mb-5">
                      Enter the {delegateRole === 'DEALER' ? 'dealer' : 'facilitator'}&apos;s phone number
                    </p>

                    <div className="flex items-center border border-[#DDD0B8] rounded-xl overflow-hidden mb-3">
                      <span className="px-4 py-3 bg-[#F5F0E8] text-[#7A8C7E] text-sm font-mono border-r border-[#DDD0B8]">
                        +91
                      </span>
                      <input
                        value={delegatePhone}
                        onChange={e => setDelegatePhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        placeholder="10-digit mobile number"
                        inputMode="numeric"
                        className="flex-1 px-4 py-3 text-sm focus:outline-none font-mono"
                      />
                    </div>

                    {error && <p className="text-sm text-[#D4682E] mb-3">{error}</p>}

                    <button
                      onClick={sendDelegateRequest}
                      disabled={busy || delegatePhone.length < 10}
                      className="w-full py-4 rounded-2xl text-white font-semibold text-sm disabled:opacity-50"
                      style={{ background: '#3A7D44' }}>
                      {busy ? 'Sending…' : `Send to ${delegateRole === 'DEALER' ? 'dealer' : 'facilitator'} →`}
                    </button>

                    <button
                      onClick={() => setStage('payment')}
                      className="w-full mt-2 py-3 rounded-2xl text-[#7A8C7E] text-sm">
                      Pay myself instead
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
