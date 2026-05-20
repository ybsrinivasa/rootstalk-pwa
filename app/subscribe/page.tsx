'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open(): void }
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Stage = 'location' | 'crop' | 'company' | 'guided' | 'confirm' | 'payment' | 'delegate' | 'done'

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCropName(coshId: string): string {
  return coshId.replace(/^crop_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

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

export default function SubscribePage() {
  const router = useRouter()
  const user = getUser()

  const [stage, setStage] = useState<Stage>('location')

  // Location
  const [district, setDistrict] = useState('')
  const [stateName, setStateName] = useState('')
  const [districtName, setDistrictName] = useState('')

  // Discovery
  const [crops, setCrops] = useState<{ crop_cosh_id: string }[]>([])
  const [companies, setCompanies] = useState<CompanyInfo[]>([])
  const [cropId, setCropId] = useState('')
  const [clientId, setClientId] = useState('')
  const [company, setCompany] = useState<CompanyInfo | null>(null)

  // Guided algorithm
  const [answers, setAnswers] = useState('')
  const [selectedVars, setSelectedVars] = useState<{ paramName: string; varName: string }[]>([])
  const [packageId, setPackageId] = useState('')
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

  // ── Auth guard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    // Pre-fill location from user profile
    api.get<{ state_cosh_id: string | null; district_cosh_id: string | null }>('/auth/me/location')
      .then(({ data }) => {
        if (data.state_cosh_id) setStateName(data.state_cosh_id)
        if (data.district_cosh_id) {
          setDistrict(data.district_cosh_id)
          setDistrictName(data.district_cosh_id)
        }
      })
      .catch(() => { /* location not set — user fills manually */ })
  }, [router])

  // ── Stage: Location ────────────────────────────────────────────────────────
  async function proceedFromLocation() {
    if (!district.trim()) { setError('Please enter your district.'); return }
    setBusy(true); setError('')
    try {
      const { data } = await api.get<{ crop_cosh_id: string }[]>('/farmer/discover/crops', {
        params: { district_cosh_id: district.trim() },
      })
      setCrops(data)
      setStage('crop')
    } catch { setError('Could not load crops for this area.') }
    finally { setBusy(false) }
  }

  // ── Stage: Crop → Company ──────────────────────────────────────────────────
  async function selectCrop(cid: string) {
    setCropId(cid)
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
        name: 'RootsTalk',
        description: 'Crop Advisory Subscription',
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
      await api.post(`/farmer/subscriptions/${subscription.id}/delegate-payment`, {
        delegate_phone: fullPhone,
        role: delegateRole,
      })
      setStage('done')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Could not send payment request. Check the phone number and try again.')
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
      setAnswers('')
      setSelectedVars([])
      setGuidedStep(null)
      setGuidedQuestionIndex(0)
      setStage('guided')
      // Restart guided from beginning
      selectCompany(company!)
    }
    else if (stage === 'payment') setStage('confirm')
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
    done: 'Subscribed!',
  }

  const cropDisplay = cropId ? formatCropName(cropId) : ''

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
        ) : (
          <>
            <PWAHeader title={titles[stage]} activeRole="FARMER" />
            <div className="pt-16 pb-24 px-4">

              {/* Back button */}
              {stage !== 'location' && (
                <button onClick={goBack}
                  className="mt-4 mb-2 flex items-center gap-1 text-[#7A8C7E] text-sm">
                  ← Back
                </button>
              )}

              <div className="bg-white rounded-2xl shadow-sm border border-[#DDD0B8] mt-2 p-5">
                <ProgressBar stage={stage} />

                {/* ── STAGE 1: Location ── */}
                {stage === 'location' && (
                  <div>
                    <h2 className="text-lg font-bold text-[#6B3F1F]">Where is your farm?</h2>
                    <p className="text-[#7A8C7E] text-sm mt-0.5 mb-5">
                      We&apos;ll find advisories available in your area
                    </p>

                    {/* Pre-filled chip */}
                    {districtName && (
                      <button
                        onClick={() => { setDistrict(districtName); setError('') }}
                        className="mb-4 flex items-center gap-2 px-3 py-2 rounded-xl border border-green-200 bg-green-50 text-sm text-green-800 w-full text-left">
                        <span className="text-green-600">📍</span>
                        <span>Use my location: <strong>{districtName.replace(/_/g, ' ')}</strong>
                          {stateName ? `, ${stateName.replace(/_/g, ' ')}` : ''}</span>
                      </button>
                    )}

                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-[#7A8C7E] font-medium mb-1 block">State</label>
                        <input
                          value={stateName}
                          onChange={e => setStateName(e.target.value)}
                          placeholder="e.g. odisha"
                          className="w-full border border-[#DDD0B8] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[#7A8C7E] font-medium mb-1 block">District</label>
                        <input
                          value={district}
                          onChange={e => setDistrict(e.target.value)}
                          placeholder="e.g. cuttack"
                          className="w-full border border-[#DDD0B8] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                      </div>
                    </div>

                    {error && <p className="text-sm text-[#D4682E] mt-3">{error}</p>}

                    <button
                      onClick={proceedFromLocation}
                      disabled={busy || !district.trim()}
                      className="mt-5 w-full py-4 rounded-2xl text-white font-semibold text-sm disabled:opacity-50"
                      style={{ background: '#3A7D44' }}>
                      {busy ? 'Loading…' : 'Find advisories →'}
                    </button>
                  </div>
                )}

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
                            <p className="font-medium text-[#6B3F1F]">{formatCropName(c.crop_cosh_id)}</p>
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
                    <p className="text-[#7A8C7E] text-sm mt-0.5 mb-5">Based on your answers</p>

                    <div className="rounded-2xl overflow-hidden border border-[#DDD0B8] mb-5">
                      <CompanyLogo company={company} />
                      <div className="p-4">
                        <p className="font-semibold text-[#6B3F1F] text-base mb-3">
                          {cropDisplay} advisory
                        </p>
                        {selectedVars.map((sv, i) => (
                          <p key={i} className="text-sm text-[#6B3F1F] mb-1">
                            • {sv.paramName}: <span className="font-medium">{sv.varName}</span>
                          </p>
                        ))}
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
                    <p className="text-[#7A8C7E] text-sm mt-0.5 mb-5">
                      Choose how to pay for your advisory
                    </p>

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
