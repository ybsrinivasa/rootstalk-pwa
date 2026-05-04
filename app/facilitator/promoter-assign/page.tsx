'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

const COLOUR = '#7D4E00'

type Stage = 'phone' | 'confirm_farmer' | 'crop' | 'guided' | 'confirm' | 'done'

interface FarmerInfo {
  id: string
  name: string | null
  phone: string
  state_cosh_id: string | null
  district_cosh_id: string | null
}

interface PromotedFarmer {
  subscription_id: string
  farmer_name: string | null
  farmer_phone: string | null
  client_id: string
  status: string
  reference_number: string | null
}

interface ClientInfo {
  id: string
  display_name: string
  primary_colour: string
  logo_url: string | null
}

interface CropOption {
  crop_cosh_id: string
}

interface GuidedStep {
  done: boolean
  package?: { id: string; name: string; description: string | null }
  parameter?: { id: string; name: string }
  variables?: { id: string; name: string }[]
  remaining_count?: number
  error?: string
}

function formatCropName(coshId: string): string {
  return coshId.replace(/^crop_/, '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function ProgressBar({ stage }: { stage: Stage }) {
  const steps: Stage[] = ['phone', 'confirm_farmer', 'crop', 'guided', 'confirm', 'done']
  const idx = steps.indexOf(stage)
  return (
    <div className="flex gap-1 mb-6">
      {steps.map((s, i) => (
        <div key={s} className="flex-1 h-1 rounded-full"
          style={{ background: i <= idx ? COLOUR : '#e7e5e4' }} />
      ))}
    </div>
  )
}

export default function FacilitatorPromoterAssignPage() {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('phone')
  const [phone, setPhone] = useState('')
  const [farmer, setFarmer] = useState<FarmerInfo | null>(null)
  const [farmerDistrict, setFarmerDistrict] = useState('')
  const [existingFarmers, setExistingFarmers] = useState<PromotedFarmer[]>([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null)
  const [availableClients, setAvailableClients] = useState<{ id: string; name: string }[]>([])
  const [crops, setCrops] = useState<CropOption[]>([])
  const [selectedCrop, setSelectedCrop] = useState('')
  const [answers, setAnswers] = useState('')
  const [guidedStep, setGuidedStep] = useState<GuidedStep | null>(null)
  const [resolvedPackageId, setResolvedPackageId] = useState('')
  const [resolvedPackageName, setResolvedPackageName] = useState('')
  const [answerHistory, setAnswerHistory] = useState<{ param: string; varName: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Pool guard — refreshed whenever the selected company changes.
  const [poolBalance, setPoolBalance] = useState<number | null>(null)
  const [poolChecking, setPoolChecking] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    // Load existing promoted farmers to know current company
    api.get<PromotedFarmer[]>('/facilitator/promoted-farmers')
      .then(r => {
        setExistingFarmers(r.data)
        // Extract unique client IDs from existing assignments
        const clientIds = [...new Set(r.data.map((f: PromotedFarmer) => f.client_id))]
        if (clientIds.length > 0) {
          // Pre-select the existing company (facilitator can only promote for one)
          setSelectedClientId(clientIds[0])
          // Fetch client info for each
          Promise.allSettled(
            clientIds.map(id => api.get<ClientInfo>(`/client/${id}/info`).then(res => ({ id, data: res.data })))
          ).then(results => {
            const clients: { id: string; name: string }[] = []
            results.forEach(r => {
              if (r.status === 'fulfilled') {
                clients.push({ id: r.value.id, name: r.value.data.display_name })
              }
            })
            setAvailableClients(clients)
          })
        }
      })
      .catch(() => {})
  }, [])

  // Load client info when company selected
  useEffect(() => {
    if (!selectedClientId) return
    api.get<ClientInfo>(`/client/${selectedClientId}/info`)
      .then(r => setClientInfo(r.data))
      .catch(() => {})
  }, [selectedClientId])

  // Whenever the promoter picks a company, ask whether that company has
  // pool balance to spend. Block the Continue button if not — saves the
  // promoter from walking the entire BL-01 flow only to be 422'd at
  // initiate-assignment.
  useEffect(() => {
    if (!selectedClientId) { setPoolBalance(null); return }
    setPoolChecking(true)
    api.get<{ available_units: number; can_assign: boolean }>(
      `/client/${selectedClientId}/subscription-pool/can-assign`,
    )
      .then(r => setPoolBalance(r.data.available_units))
      .catch(() => setPoolBalance(null))
      .finally(() => setPoolChecking(false))
  }, [selectedClientId])

  async function verifyPhone() {
    if (phone.length < 10) { setError('Enter a valid 10-digit number'); return }
    setError('')
    setLoading(true)
    try {
      const { data } = await api.get<FarmerInfo>(`/promoter/farmer-lookup?phone=%2B91${phone}`)
      setFarmer(data)
      setFarmerDistrict(data.district_cosh_id || '')
      setStage('confirm_farmer')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err?.response?.data?.detail || 'This number is not registered in RootsTalk. Ask the farmer to register first.')
    } finally { setLoading(false) }
  }

  async function continueTocrops() {
    if (!selectedClientId) { setError('Please select a company'); return }
    if (!farmerDistrict) { setError('Please enter farmer district'); return }
    setError('')

    // Facilitator: check one-company rule
    const otherCompanyIds = [...new Set(existingFarmers.map(f => f.client_id))].filter(id => id !== selectedClientId)
    if (otherCompanyIds.length > 0 && !existingFarmers.some(f => f.client_id === selectedClientId)) {
      const otherClientName = availableClients.find(c => c.id === otherCompanyIds[0])?.name || otherCompanyIds[0]
      setError(`You are already a Promoter for ${otherClientName}. A facilitator can only promote for one company at a time.`)
      return
    }

    setLoading(true)
    try {
      const { data } = await api.get<CropOption[]>(`/farmer/discover/crops?district_cosh_id=${encodeURIComponent(farmerDistrict)}`)
      setCrops(data)
      setStage('crop')
    } catch {
      setError('Could not load crops. Check the district ID.')
    } finally { setLoading(false) }
  }

  async function selectCrop(cropId: string) {
    setSelectedCrop(cropId)
    setAnswers('')
    setAnswerHistory([])
    setLoading(true)
    try {
      const { data } = await api.get<GuidedStep>(
        `/farmer/packages/guided-step?crop_cosh_id=${encodeURIComponent(cropId)}&district_cosh_id=${encodeURIComponent(farmerDistrict)}&client_id=${encodeURIComponent(selectedClientId)}&answers=`
      )
      setGuidedStep(data)
      if (data.done && data.package) {
        setResolvedPackageId(data.package.id)
        setResolvedPackageName(data.package.name)
        setStage('confirm')
      } else {
        setStage('guided')
      }
    } catch {
      setError('Could not start guided flow.')
    } finally { setLoading(false) }
  }

  async function submitAnswer(paramId: string, varId: string, varName: string) {
    const newAnswers = answers ? `${answers},${paramId}:${varId}` : `${paramId}:${varId}`
    setAnswers(newAnswers)
    setAnswerHistory(prev => [...prev, { param: guidedStep?.parameter?.name || paramId, varName }])
    setLoading(true)
    try {
      const { data } = await api.get<GuidedStep>(
        `/farmer/packages/guided-step?crop_cosh_id=${encodeURIComponent(selectedCrop)}&district_cosh_id=${encodeURIComponent(farmerDistrict)}&client_id=${encodeURIComponent(selectedClientId)}&answers=${encodeURIComponent(newAnswers)}`
      )
      setGuidedStep(data)
      if (data.done && data.package) {
        setResolvedPackageId(data.package.id)
        setResolvedPackageName(data.package.name)
        setStage('confirm')
      }
    } catch {
      setError('Error fetching next step.')
    } finally { setLoading(false) }
  }

  // Start over: reset answers and restart guided questions on the same
  // crop+company. Different intent from "← Back" (which moves stage).
  async function startOver() {
    if (!selectedCrop) return
    setError('')
    setResolvedPackageId('')
    setResolvedPackageName('')
    await selectCrop(selectedCrop)
  }

  async function sendRequest() {
    setLoading(true)
    setError('')
    try {
      await api.post('/promoter/assignments/initiate', {
        farmer_phone: `+91${phone}`,
        client_id: selectedClientId,
        package_id: resolvedPackageId,
        promoter_type: 'FACILITATOR',
      })
      setStage('done')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err?.response?.data?.detail || 'Could not send request. Please try again.')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Assign Advisory" activeRole="FACILITATOR" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        <div className="mt-4">
          <ProgressBar stage={stage} />

          {/* ── STAGE: phone ── */}
          {stage === 'phone' && (
            <div>
              <p className="text-xl font-bold text-slate-900 mb-1">Enter farmer&apos;s number</p>
              <p className="text-sm text-slate-500 mb-5">The farmer must be registered in rootsTALK.in</p>
              <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden bg-white">
                <span className="px-4 py-3.5 text-sm text-slate-500 bg-slate-50 border-r border-slate-200 shrink-0">+91</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setError('') }}
                  onKeyDown={e => e.key === 'Enter' && verifyPhone()}
                  placeholder="10-digit mobile number"
                  className="flex-1 px-4 py-3.5 text-sm focus:outline-none"
                />
              </div>
              {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
              <button
                onClick={verifyPhone}
                disabled={loading || phone.length < 10}
                className="mt-4 w-full py-3.5 rounded-2xl text-white font-semibold disabled:opacity-40"
                style={{ background: COLOUR }}>
                {loading ? 'Checking…' : 'Verify →'}
              </button>
            </div>
          )}

          {/* ── STAGE: confirm_farmer ── */}
          {stage === 'confirm_farmer' && farmer && (
            <div>
              <p className="text-xl font-bold text-slate-900 mb-1">Farmer found</p>
              <p className="text-sm text-slate-500 mb-5">Confirm details and select a company</p>

              <div className="bg-white rounded-2xl border border-slate-100 p-4 mb-5">
                <p className="font-semibold text-slate-900">{farmer.name || 'Unnamed farmer'}</p>
                <p className="text-sm text-slate-500 mt-0.5">+91{phone}</p>
                {farmer.district_cosh_id && (
                  <p className="text-xs text-slate-400 mt-0.5">District: {farmer.district_cosh_id}</p>
                )}
              </div>

              <p className="text-sm font-semibold text-slate-700 mb-2">Which company&apos;s advisory?</p>
              {availableClients.length > 0 ? (
                <div className="space-y-2 mb-4">
                  {availableClients.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedClientId(c.id)}
                      className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                        selectedClientId === c.id
                          ? 'border-[#7D4E00] bg-[#7D4E00]/5 text-[#7D4E00]'
                          : 'border-slate-200 bg-white text-slate-700'
                      }`}>
                      {c.name}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mb-4">
                  <input
                    value={selectedClientId}
                    onChange={e => setSelectedClientId(e.target.value.trim())}
                    placeholder="Enter company (client) ID"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#7D4E00]/20"
                  />
                  <p className="text-xs text-slate-400 mt-1">You have no existing promoted farmers. Enter a client ID to continue.</p>
                </div>
              )}

              <p className="text-sm font-semibold text-slate-700 mb-2">Farmer&apos;s district</p>
              <input
                value={farmerDistrict}
                onChange={e => setFarmerDistrict(e.target.value)}
                placeholder="e.g. dist_mh_pune"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#7D4E00]/20 mb-4"
              />

              {/* Pool-balance guard — block when company has 0 units. */}
              {selectedClientId && !poolChecking && poolBalance === 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 mb-3">
                  <span className="font-semibold">This company has no available subscriptions in their pool. </span>
                  Ask them to top up before assigning advisories to farmers. Otherwise the farmer would be left waiting indefinitely.
                </div>
              )}

              {error && <p className="text-red-600 text-xs mt-1 mb-2">{error}</p>}
              <button
                onClick={continueTocrops}
                disabled={loading || !selectedClientId || !farmerDistrict || poolBalance === 0 || poolChecking}
                className="w-full py-3.5 rounded-2xl text-white font-semibold disabled:opacity-40"
                style={{ background: COLOUR }}>
                {loading ? 'Loading crops…'
                  : poolChecking ? 'Checking pool…'
                  : poolBalance === 0 ? 'Pool empty — cannot assign'
                  : 'Continue →'}
              </button>
              <button onClick={() => setStage('phone')} className="mt-3 w-full text-center text-sm text-slate-400">
                ← Back
              </button>
            </div>
          )}

          {/* ── STAGE: crop ── */}
          {stage === 'crop' && (
            <div>
              <p className="text-xl font-bold text-slate-900 mb-1">Select crop</p>
              <p className="text-sm text-slate-500 mb-5">
                Crops available in {farmerDistrict.replace('dist_', '').replace(/_/g, ' ')}
              </p>
              {crops.length === 0 ? (
                <p className="text-slate-500 text-sm py-6 text-center">No crops available in this district for the selected company.</p>
              ) : (
                <div className="space-y-2">
                  {crops.map(c => (
                    <button
                      key={c.crop_cosh_id}
                      onClick={() => selectCrop(c.crop_cosh_id)}
                      disabled={loading}
                      className="w-full text-left px-4 py-3.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-800 hover:border-[#7D4E00] hover:text-[#7D4E00] transition-colors disabled:opacity-40">
                      {formatCropName(c.crop_cosh_id)}
                    </button>
                  ))}
                </div>
              )}
              {loading && (
                <div className="flex justify-center py-6">
                  <div className="w-6 h-6 border-2 border-slate-200 border-t-[#7D4E00] rounded-full animate-spin" />
                </div>
              )}
              <button onClick={() => setStage('confirm_farmer')} className="mt-4 w-full text-center text-sm text-slate-400">
                ← Back
              </button>
            </div>
          )}

          {/* ── STAGE: guided ── */}
          {stage === 'guided' && guidedStep && !guidedStep.done && (
            <div>
              <p className="text-xl font-bold text-slate-900 mb-1">
                {guidedStep.parameter?.name || 'Select option'}
              </p>
              <p className="text-sm text-slate-500 mb-2">
                {guidedStep.remaining_count} package{(guidedStep.remaining_count || 0) > 1 ? 's' : ''} remaining
              </p>

              {answerHistory.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {answerHistory.map((a, i) => (
                    <span key={i} className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
                      {a.param}: <span className="font-medium">{a.varName}</span>
                    </span>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                {guidedStep.variables?.map(v => (
                  <button
                    key={v.id}
                    onClick={() => submitAnswer(guidedStep.parameter!.id, v.id, v.name)}
                    disabled={loading}
                    className="w-full text-left px-4 py-3.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-800 hover:border-[#7D4E00] hover:text-[#7D4E00] transition-colors disabled:opacity-40">
                    {v.name}
                  </button>
                ))}
              </div>

              {loading && (
                <div className="flex justify-center py-4">
                  <div className="w-6 h-6 border-2 border-slate-200 border-t-[#7D4E00] rounded-full animate-spin" />
                </div>
              )}
              {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
              {answerHistory.length > 0 && (
                <button
                  onClick={startOver}
                  disabled={loading}
                  className="mt-5 w-full py-3 rounded-2xl text-slate-500 text-sm disabled:opacity-50">
                  ↺ Start over
                </button>
              )}
            </div>
          )}

          {/* ── STAGE: confirm ── */}
          {stage === 'confirm' && (
            <div>
              <p className="text-xl font-bold text-slate-900 mb-1">Confirm assignment</p>
              <p className="text-sm text-slate-500 mb-5">Review before sending</p>

              <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3 mb-5">
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide">Farmer</p>
                  <p className="font-semibold text-slate-900">{farmer?.name || 'Farmer'}</p>
                  <p className="text-sm text-slate-500">+91{phone}</p>
                </div>
                <div className="border-t border-slate-50 pt-3">
                  <p className="text-xs text-slate-400 uppercase tracking-wide">Company</p>
                  <p className="font-semibold text-slate-900">{clientInfo?.display_name || selectedClientId}</p>
                </div>
                <div className="border-t border-slate-50 pt-3">
                  <p className="text-xs text-slate-400 uppercase tracking-wide">Crop</p>
                  <p className="font-semibold text-slate-900">{formatCropName(selectedCrop)}</p>
                </div>
                <div className="border-t border-slate-50 pt-3">
                  <p className="text-xs text-slate-400 uppercase tracking-wide">Advisory Package</p>
                  <p className="font-semibold text-slate-900">{resolvedPackageName}</p>
                </div>
                {answerHistory.length > 0 && (
                  <div className="border-t border-slate-50 pt-3">
                    <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Your selections</p>
                    <div className="flex flex-wrap gap-2">
                      {answerHistory.map((a, i) => (
                        <span key={i} className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
                          {a.param}: <span className="font-medium">{a.varName}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {error && <p className="text-red-600 text-xs mb-3">{error}</p>}
              <button
                onClick={sendRequest}
                disabled={loading}
                className="w-full py-3.5 rounded-2xl text-white font-semibold disabled:opacity-40"
                style={{ background: COLOUR }}>
                {loading ? 'Sending…' : 'Send advisory request →'}
              </button>
              <button
                onClick={startOver}
                disabled={loading}
                className="mt-3 w-full text-center text-sm text-slate-400 disabled:opacity-50">
                ↺ Start over
              </button>
            </div>
          )}

          {/* ── STAGE: done ── */}
          {stage === 'done' && (
            <div className="fixed inset-0 flex flex-col items-center justify-center px-8"
              style={{ background: COLOUR }}>
              <p className="text-4xl font-bold text-white mb-4">Request sent!</p>
              <p className="text-white/80 text-center text-base leading-relaxed mb-8">
                <span className="font-semibold text-white">{farmer?.name || 'The farmer'}</span> will receive a notification to approve the advisory.
                Once approved, you&apos;ll be their Promoter.
              </p>
              <button
                onClick={() => router.push('/facilitator/promoted-farmers')}
                className="py-3.5 px-8 rounded-2xl bg-white font-semibold"
                style={{ color: COLOUR }}>
                Back to My Promoted Farmers →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
