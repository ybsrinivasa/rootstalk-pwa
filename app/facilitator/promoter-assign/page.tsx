'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

const COLOUR = '#7D4E00'

type Stage = 'gate' | 'phone' | 'confirm_farmer' | 'crop' | 'guided' | 'measure' | 'confirm' | 'done'

// Cosh-driven location universe — same shape as /subscribe.
type CoshDistrict = { cosh_id: string; name: string | null }
type CoshState = { cosh_id: string; name: string | null; districts: CoshDistrict[] }
type CoshLocations = { states: CoshState[] }

interface KittyInfo {
  client_id: string
  client_short_name: string
  client_display_name: string
  units_balance: number
}

interface FarmerInfo {
  id: string
  name: string | null
  phone: string
  state_cosh_id: string | null
  district_cosh_id: string | null
}

interface CropOption {
  crop_cosh_id: string
  name?: string | null
}

interface GuidedStep {
  done: boolean
  package?: { id: string; name: string; description: string | null }
  parameter?: { id: string; name: string }
  variables?: { id: string; name: string }[]
  remaining_count?: number
  error?: string
}

type Measure = 'AREA_WISE' | 'PLANT_WISE'

function formatCropName(coshId: string, name?: string | null): string {
  return cropDisplayName(coshId, name)
}

function ProgressBar({ stage }: { stage: Stage }) {
  const steps: Stage[] = ['phone', 'confirm_farmer', 'crop', 'guided', 'measure', 'confirm', 'done']
  const idx = steps.indexOf(stage)
  if (idx < 0) return null
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
  const [stage, setStage] = useState<Stage>('gate')
  const [kitty, setKitty] = useState<KittyInfo | null>(null)
  const [kittyError, setKittyError] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [farmer, setFarmer] = useState<FarmerInfo | null>(null)
  // Location typeahead state — mirrors /subscribe shape.
  const [coshLocations, setCoshLocations] = useState<CoshLocations | null>(null)
  const [stateId, setStateId] = useState('')
  const [stateSearch, setStateSearch] = useState('')
  const [district, setDistrict] = useState('')
  const [districtSearch, setDistrictSearch] = useState('')
  const [editingLocation, setEditingLocation] = useState(false)
  const [crops, setCrops] = useState<CropOption[]>([])
  const [selectedCrop, setSelectedCrop] = useState('')
  const [answers, setAnswers] = useState('')
  const [guidedStep, setGuidedStep] = useState<GuidedStep | null>(null)
  const [resolvedPackageId, setResolvedPackageId] = useState('')
  const [resolvedPackageName, setResolvedPackageName] = useState('')
  const [answerHistory, setAnswerHistory] = useState<{ param: string; varName: string }[]>([])
  // Measure step state (B2 contract — exactly one branch required).
  const [measure, setMeasure] = useState<Measure>('AREA_WISE')
  const [areaInput, setAreaInput] = useState('')
  const [plantsInput, setPlantsInput] = useState('')
  const [yearInput, setYearInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Single source of truth for the kitty gate. Called on mount, on
  // tab focus (visibilitychange), and after every send/cancel so the
  // chip never lies if the CA tops up or reclaims while the F-P is
  // in the flow.
  const refreshKitty = useCallback(async () => {
    try {
      const { data } = await api.get<KittyInfo>('/promoter/me/kitty')
      setKitty(data)
      setKittyError(null)
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { detail?: { code?: string } | string } } }
      const code = typeof err?.response?.data === 'object'
        ? (err.response.data as { detail?: { code?: string } }).detail?.code
        : null
      if (err?.response?.status === 403 && code === 'not_a_promoter') {
        setKittyError('You are not currently a Promoter for any company. Ask the company admin to invite you.')
      } else {
        setKittyError('Could not load your subscription kitty. Pull to retry.')
      }
      setKitty(null)
    }
  }, [])

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    refreshKitty().then(() => setStage(s => s === 'gate' ? 'phone' : s))
    api.get<CoshLocations>('/cosh/locations/india')
      .then(r => setCoshLocations(r.data))
      .catch(() => { /* network blip — typeahead just renders empty until retry */ })
  }, [refreshKitty, router])

  useEffect(() => {
    function onVisibility() {
      if (!document.hidden) refreshKitty()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [refreshKitty])

  async function verifyPhone() {
    if (phone.length < 10) { setError('Enter a valid 10-digit number'); return }
    setError('')
    setLoading(true)
    try {
      const { data } = await api.get<FarmerInfo>(`/promoter/farmer-lookup?phone=%2B91${phone}`)
      setFarmer(data)
      // Pre-fill state + district from the farmer's saved profile.
      // The F-P can tap Change to switch plots within the next stage.
      setStateId(data.state_cosh_id || '')
      setDistrict(data.district_cosh_id || '')
      setEditingLocation(!data.district_cosh_id)
      setStateSearch('')
      setDistrictSearch('')
      setStage('confirm_farmer')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err?.response?.data?.detail || 'This number is not registered in RootsTalk. Ask the farmer to register first.')
    } finally { setLoading(false) }
  }

  async function continueToCrops() {
    if (!district) { setError('Please pick the district where the farmland is'); return }
    setError('')
    setLoading(true)
    try {
      const { data } = await api.get<CropOption[]>(
        `/promoter/crops?district_cosh_id=${encodeURIComponent(district)}`
      )
      setCrops(data)
      setStage('crop')
    } catch {
      setError('Could not load crops. Pick a different district or try again.')
    } finally { setLoading(false) }
  }

  async function selectCrop(cropId: string) {
    setSelectedCrop(cropId)
    setAnswers('')
    setAnswerHistory([])
    setLoading(true)
    try {
      // /promoter/packages/guided-step — server derives client_id
      // from the F-P's locked binding, so no client_id query param.
      const { data } = await api.get<GuidedStep>(
        `/promoter/packages/guided-step?crop_cosh_id=${encodeURIComponent(cropId)}&district_cosh_id=${encodeURIComponent(district)}&answers=`
      )
      setGuidedStep(data)
      if (data.done && data.package) {
        setResolvedPackageId(data.package.id)
        setResolvedPackageName(data.package.name)
        setStage('measure')
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
        `/promoter/packages/guided-step?crop_cosh_id=${encodeURIComponent(selectedCrop)}&district_cosh_id=${encodeURIComponent(district)}&answers=${encodeURIComponent(newAnswers)}`
      )
      setGuidedStep(data)
      if (data.done && data.package) {
        setResolvedPackageId(data.package.id)
        setResolvedPackageName(data.package.name)
        setStage('measure')
      }
    } catch {
      setError('Error fetching next step.')
    } finally { setLoading(false) }
  }

  async function startOver() {
    if (!selectedCrop) return
    setError('')
    setResolvedPackageId('')
    setResolvedPackageName('')
    setAreaInput('')
    setPlantsInput('')
    setYearInput('')
    setMeasure('AREA_WISE')
    await selectCrop(selectedCrop)
  }

  function confirmMeasure() {
    setError('')
    if (measure === 'AREA_WISE') {
      const acres = parseFloat(areaInput)
      if (!Number.isFinite(acres) || acres <= 0) {
        setError('Enter the farm area in acres (e.g. 1.5).')
        return
      }
    } else {
      const n = parseInt(plantsInput, 10)
      const y = parseInt(yearInput, 10)
      if (!Number.isFinite(n) || n <= 0) {
        setError('Enter the number of plants.')
        return
      }
      if (!Number.isFinite(y) || y < 1900 || y > 2100) {
        setError('Enter the planting year (e.g. 2024).')
        return
      }
    }
    setStage('confirm')
  }

  async function sendRequest() {
    setLoading(true)
    setError('')
    try {
      const body: Record<string, unknown> = {
        farmer_phone: `+91${phone}`,
        package_id: resolvedPackageId,
        promoter_type: 'FACILITATOR',
      }
      if (measure === 'AREA_WISE') {
        body.farm_area_acres = parseFloat(areaInput)
      } else {
        body.number_of_plants = parseInt(plantsInput, 10)
        body.planting_year = parseInt(yearInput, 10)
      }
      await api.post('/promoter/assignments/initiate', body)
      // Kitty just dropped by 1 — re-fetch to reflect it.
      await refreshKitty()
      setStage('done')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string | { message?: string } } } }
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : detail?.message || 'Could not send request. Please try again.'
      setError(msg)
    } finally { setLoading(false) }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (stage === 'gate') {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title="Assign Advisory" activeRole="FACILITATOR" back="/facilitator/home" />
        <div className="pt-16 px-4 max-w-lg mx-auto">
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-[#DDD0B8] border-t-[#7D4E00] rounded-full animate-spin" />
          </div>
        </div>
      </div>
    )
  }

  // Empty-state when kitty is empty or F-P has no binding. Blocks
  // the entire flow per the B1 design — no point letting the F-P
  // type a phone number when we cannot accept their assignment.
  if (kittyError || (kitty && kitty.units_balance === 0)) {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title="Assign Advisory" activeRole="FACILITATOR" back="/facilitator/home" />
        <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
          <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-base font-bold text-amber-900 mb-2">No subscriptions available</p>
            <p className="text-sm text-amber-800 leading-relaxed">
              {kittyError ||
                'Your kitty is empty. Ask your company admin to allocate units to you before you assign advisories to farmers.'}
            </p>
            {kitty && (
              <p className="mt-3 text-xs text-amber-800/80">
                Company: <span className="font-semibold">{kitty.client_display_name}</span>
              </p>
            )}
          </div>
          <button
            onClick={refreshKitty}
            className="mt-4 w-full py-3 rounded-2xl border border-[#DDD0B8] bg-white text-sm font-semibold text-[#6B3F1F]">
            ↻ Refresh
          </button>
          <button
            onClick={() => router.push('/facilitator/promoter-assign/pending')}
            className="mt-3 w-full py-3 rounded-2xl border border-[#DDD0B8] bg-white text-sm font-semibold text-[#6B3F1F]">
            View pending sent →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Assign Advisory" activeRole="FACILITATOR" back="/facilitator/home" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        <div className="mt-4">
          {/* Refreshable kitty chip — pinned across every stage so the
              F-P always sees their remaining balance. */}
          {kitty && stage !== 'done' && (
            <div className="flex items-center justify-between mb-4 px-3 py-2 rounded-full bg-emerald-50 border border-emerald-200">
              <span className="text-xs text-emerald-800">
                <span className="font-semibold">{kitty.units_balance.toLocaleString('en-IN')}</span>{' '}
                subscription{kitty.units_balance === 1 ? '' : 's'} left for{' '}
                <span className="font-semibold">{kitty.client_display_name}</span>
              </span>
              <button
                onClick={() => router.push('/facilitator/promoter-assign/pending')}
                className="text-xs font-semibold text-emerald-900 underline underline-offset-2">
                Pending sent
              </button>
            </div>
          )}

          <ProgressBar stage={stage} />

          {/* ── STAGE: phone ── */}
          {stage === 'phone' && (
            <div>
              <p className="text-xl font-bold text-[#6B3F1F] mb-1">Enter farmer&apos;s number</p>
              <p className="text-sm text-[#7A8C7E] mb-5">The farmer must be registered in rootsTALK.in</p>
              <div className="flex items-center border border-[#DDD0B8] rounded-xl overflow-hidden bg-white">
                <span className="px-4 py-3.5 text-sm text-[#7A8C7E] bg-[#F5F0E8] border-r border-[#DDD0B8] shrink-0">+91</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setError('') }}
                  onKeyDown={e => e.key === 'Enter' && verifyPhone()}
                  placeholder="10-digit mobile number"
                  className="flex-1 px-4 py-3.5 text-sm focus:outline-none"
                />
              </div>
              {error && <p className="text-[#D4682E] text-xs mt-2">{error}</p>}
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
          {stage === 'confirm_farmer' && farmer && (() => {
            // Typeahead state — mirrors /subscribe so the F-P can override
            // the farmer's saved district (e.g. for a plot in a different
            // district than the farmer's home). The Package they end up
            // resolving carries its own PackageLocation, so the
            // Subscription's location is implicit in the Package.
            const coshStates = coshLocations?.states ?? []
            const selectedState = coshStates.find(s => s.cosh_id === stateId) || null
            const selectedDistrict = (selectedState?.districts ?? []).find(d => d.cosh_id === district) || null
            const stateName = selectedState?.name || ''
            const districtName = selectedDistrict?.name || ''
            const filteredStates = coshStates
              .filter(s => s.name)
              .filter(s => !stateSearch || (s.name || '').toLowerCase().includes(stateSearch.toLowerCase()))
            const filteredDistricts = (selectedState?.districts ?? [])
              .filter(d => d.name)
              .filter(d => !districtSearch || (d.name || '').toLowerCase().includes(districtSearch.toLowerCase()))
            const hasResolvedLocation = !!(district && districtName)

            return (
              <div>
                <p className="text-xl font-bold text-[#6B3F1F] mb-1">Farmer found</p>
                <p className="text-sm text-[#7A8C7E] mb-5">Confirm where the farmland is before picking the crop</p>

                <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4 mb-5">
                  <p className="font-semibold text-[#6B3F1F]">{farmer.name || 'Unnamed farmer'}</p>
                  <p className="text-sm text-[#7A8C7E] mt-0.5">+91{phone}</p>
                </div>

                <p className="text-sm font-semibold text-[#6B3F1F] mb-2">Farmland location</p>
                {!coshLocations && (
                  <div className="flex items-center gap-3 text-[#7A8C7E] text-sm mb-3">
                    <div className="w-4 h-4 border-2 border-[#DDD0B8] border-t-[#7D4E00] rounded-full animate-spin"/>
                    Loading states and districts…
                  </div>
                )}

                {/* Resolved-location chip. Tap Change to switch plots. */}
                {coshLocations && hasResolvedLocation && !editingLocation && (
                  <div className="mb-4 px-4 py-3 rounded-2xl border border-[#7D4E00]/30 bg-[#7D4E00]/10 flex items-start gap-3">
                    <span className="text-lg leading-none mt-0.5">📍</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] uppercase tracking-wide font-semibold text-[#7D4E00]">Farmland district</p>
                      <p className="text-[#6B3F1F] font-semibold text-[15px] mt-0.5">
                        {districtName} <span className="text-[#7A8C7E] font-normal">· {stateName || '—'}</span>
                      </p>
                    </div>
                    <button onClick={() => { setEditingLocation(true); setStateSearch(''); setDistrictSearch('') }}
                      className="text-[12px] text-[#7D4E00] underline shrink-0">
                      Change
                    </button>
                  </div>
                )}

                {coshLocations && (!hasResolvedLocation || editingLocation) && (
                  <div className="space-y-3 mb-4">
                    {/* State */}
                    <div>
                      <label className="text-xs text-[#7A8C7E] font-medium mb-1 block">State</label>
                      {stateId ? (
                        <div className="flex items-center gap-2">
                          <span className="bg-[#7D4E00]/10 text-[#7D4E00] text-sm font-medium px-3 py-1.5 rounded-full">
                            {stateName || '(unnamed)'}
                          </span>
                          <button onClick={() => {
                              setStateId(''); setStateSearch('')
                              setDistrict(''); setDistrictSearch('')
                            }}
                            className="text-[11px] text-[#7A8C7E] underline">Change</button>
                        </div>
                      ) : (
                        <>
                          <input value={stateSearch} onChange={e => setStateSearch(e.target.value)}
                            placeholder="Search state…"
                            className="w-full border border-[#DDD0B8] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#7D4E00]/20"/>
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

                    {/* District — bounded to the chosen state. */}
                    {stateId && (
                      <div>
                        <label className="text-xs text-[#7A8C7E] font-medium mb-1 block">District</label>
                        {district ? (
                          <div className="flex items-center gap-2">
                            <span className="bg-[#7D4E00]/10 text-[#7D4E00] text-sm font-medium px-3 py-1.5 rounded-full">
                              {districtName || '(unnamed)'}
                            </span>
                            <button onClick={() => { setDistrict(''); setDistrictSearch('') }}
                              className="text-[11px] text-[#7A8C7E] underline">Change</button>
                          </div>
                        ) : (
                          <>
                            <input value={districtSearch} onChange={e => setDistrictSearch(e.target.value)}
                              placeholder="Search district…"
                              className="w-full border border-[#DDD0B8] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#7D4E00]/20"/>
                            {(districtSearch || (selectedState?.districts.length || 0) <= 30) && (
                              <div className="mt-1 border border-[#DDD0B8] rounded-xl overflow-hidden max-h-40 overflow-y-auto bg-white">
                                {filteredDistricts.length === 0
                                  ? <p className="text-[#7A8C7E] text-sm px-4 py-3">No districts found</p>
                                  : filteredDistricts.map(d => (
                                    <button key={d.cosh_id}
                                      onClick={() => {
                                        setDistrict(d.cosh_id); setDistrictSearch('')
                                        setEditingLocation(false)
                                      }}
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
                  </div>
                )}

                {error && <p className="text-[#D4682E] text-xs mt-1 mb-2">{error}</p>}
                <button
                  onClick={continueToCrops}
                  disabled={loading || !district}
                  className="w-full py-3.5 rounded-2xl text-white font-semibold disabled:opacity-40"
                  style={{ background: COLOUR }}>
                  {loading ? 'Loading crops…' : 'Continue →'}
                </button>
                <button onClick={() => setStage('phone')} className="mt-3 w-full text-center text-sm text-[#7A8C7E]">
                  ← Back
                </button>
              </div>
            )
          })()}

          {/* ── STAGE: crop ── */}
          {stage === 'crop' && (() => {
            const stateRow = coshLocations?.states.find(s => s.cosh_id === stateId)
            const districtRow = stateRow?.districts.find(d => d.cosh_id === district)
            const districtLabel = districtRow?.name || district
            return (
            <div>
              <p className="text-xl font-bold text-[#6B3F1F] mb-1">Select crop</p>
              <p className="text-sm text-[#7A8C7E] mb-5">
                Crops available for {kitty?.client_display_name} in {districtLabel}
              </p>
              {crops.length === 0 ? (
                <p className="text-[#7A8C7E] text-sm py-6 text-center">
                  No crops available in this district for {kitty?.client_display_name}.
                </p>
              ) : (
                <div className="space-y-2">
                  {crops.map(c => (
                    <button
                      key={c.crop_cosh_id}
                      onClick={() => selectCrop(c.crop_cosh_id)}
                      disabled={loading}
                      className="w-full text-left px-4 py-3.5 rounded-xl border border-[#DDD0B8] bg-white text-sm font-medium text-[#6B3F1F] hover:border-[#7D4E00] hover:text-[#7D4E00] transition-colors disabled:opacity-40">
                      {formatCropName(c.crop_cosh_id, c.name)}
                    </button>
                  ))}
                </div>
              )}
              {loading && (
                <div className="flex justify-center py-6">
                  <div className="w-6 h-6 border-2 border-[#DDD0B8] border-t-[#7D4E00] rounded-full animate-spin" />
                </div>
              )}
              <button onClick={() => setStage('confirm_farmer')} className="mt-4 w-full text-center text-sm text-[#7A8C7E]">
                ← Back
              </button>
            </div>
            )
          })()}

          {/* ── STAGE: guided ── */}
          {stage === 'guided' && guidedStep && !guidedStep.done && (
            <div>
              <p className="text-xl font-bold text-[#6B3F1F] mb-1">
                {guidedStep.parameter?.name || 'Select option'}
              </p>
              <p className="text-sm text-[#7A8C7E] mb-2">
                {guidedStep.remaining_count} package{(guidedStep.remaining_count || 0) > 1 ? 's' : ''} remaining
              </p>

              {answerHistory.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {answerHistory.map((a, i) => (
                    <span key={i} className="text-xs bg-slate-100 text-[#6B3F1F] px-2 py-1 rounded-full">
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
                    className="w-full text-left px-4 py-3.5 rounded-xl border border-[#DDD0B8] bg-white text-sm font-medium text-[#6B3F1F] hover:border-[#7D4E00] hover:text-[#7D4E00] transition-colors disabled:opacity-40">
                    {v.name}
                  </button>
                ))}
              </div>

              {loading && (
                <div className="flex justify-center py-4">
                  <div className="w-6 h-6 border-2 border-[#DDD0B8] border-t-[#7D4E00] rounded-full animate-spin" />
                </div>
              )}
              {error && <p className="text-[#D4682E] text-xs mt-2">{error}</p>}
              {answerHistory.length > 0 && (
                <button
                  onClick={startOver}
                  disabled={loading}
                  className="mt-5 w-full py-3 rounded-2xl text-[#7A8C7E] text-sm disabled:opacity-50">
                  ↺ Start over
                </button>
              )}
            </div>
          )}

          {/* ── STAGE: measure (F-P B4) ── */}
          {stage === 'measure' && (
            <div>
              <p className="text-xl font-bold text-[#6B3F1F] mb-1">How is this farm measured?</p>
              <p className="text-sm text-[#7A8C7E] mb-5">
                Tell us so the advisory dosage and volume calculations match the farmer&apos;s plot.
              </p>

              <div className="flex gap-2 mb-5">
                <button
                  onClick={() => { setMeasure('AREA_WISE'); setError('') }}
                  className={`flex-1 px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                    measure === 'AREA_WISE'
                      ? 'border-[#7D4E00] bg-[#7D4E00]/5 text-[#7D4E00]'
                      : 'border-[#DDD0B8] bg-white text-[#6B3F1F]'
                  }`}>
                  Area-wise (acres)
                </button>
                <button
                  onClick={() => { setMeasure('PLANT_WISE'); setError('') }}
                  className={`flex-1 px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                    measure === 'PLANT_WISE'
                      ? 'border-[#7D4E00] bg-[#7D4E00]/5 text-[#7D4E00]'
                      : 'border-[#DDD0B8] bg-white text-[#6B3F1F]'
                  }`}>
                  Plant-wise (count)
                </button>
              </div>

              {measure === 'AREA_WISE' ? (
                <div className="mb-4">
                  <label className="text-sm font-semibold text-[#6B3F1F] mb-2 block">Farm area (acres)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min="0"
                    value={areaInput}
                    onChange={e => { setAreaInput(e.target.value); setError('') }}
                    placeholder="e.g. 1.5"
                    className="w-full border border-[#DDD0B8] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#7D4E00]/20"
                  />
                </div>
              ) : (
                <>
                  <div className="mb-4">
                    <label className="text-sm font-semibold text-[#6B3F1F] mb-2 block">Number of plants</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      value={plantsInput}
                      onChange={e => { setPlantsInput(e.target.value); setError('') }}
                      placeholder="e.g. 120"
                      className="w-full border border-[#DDD0B8] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#7D4E00]/20"
                    />
                  </div>
                  <div className="mb-4">
                    <label className="text-sm font-semibold text-[#6B3F1F] mb-2 block">Planting year</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1900"
                      max="2100"
                      value={yearInput}
                      onChange={e => { setYearInput(e.target.value); setError('') }}
                      placeholder="e.g. 2024"
                      className="w-full border border-[#DDD0B8] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#7D4E00]/20"
                    />
                  </div>
                </>
              )}

              {error && <p className="text-[#D4682E] text-xs mb-3">{error}</p>}
              <button
                onClick={confirmMeasure}
                className="w-full py-3.5 rounded-2xl text-white font-semibold"
                style={{ background: COLOUR }}>
                Review →
              </button>
              <button
                onClick={startOver}
                className="mt-3 w-full text-center text-sm text-[#7A8C7E]">
                ↺ Start over
              </button>
            </div>
          )}

          {/* ── STAGE: confirm ── */}
          {stage === 'confirm' && (
            <div>
              <p className="text-xl font-bold text-[#6B3F1F] mb-1">Confirm assignment</p>
              <p className="text-sm text-[#7A8C7E] mb-5">Review before sending</p>

              <div className="bg-white rounded-2xl border border-[#DDD0B8] p-5 space-y-3 mb-5">
                <div>
                  <p className="text-xs text-[#7A8C7E] uppercase tracking-wide">Farmer</p>
                  <p className="font-semibold text-[#6B3F1F]">{farmer?.name || 'Farmer'}</p>
                  <p className="text-sm text-[#7A8C7E]">+91{phone}</p>
                </div>
                <div className="border-t border-[#DDD0B8] pt-3">
                  <p className="text-xs text-[#7A8C7E] uppercase tracking-wide">Company</p>
                  <p className="font-semibold text-[#6B3F1F]">{kitty?.client_display_name}</p>
                </div>
                <div className="border-t border-[#DDD0B8] pt-3">
                  <p className="text-xs text-[#7A8C7E] uppercase tracking-wide">Crop</p>
                  <p className="font-semibold text-[#6B3F1F]">{formatCropName(selectedCrop)}</p>
                </div>
                <div className="border-t border-[#DDD0B8] pt-3">
                  <p className="text-xs text-[#7A8C7E] uppercase tracking-wide">Advisory Package</p>
                  <p className="font-semibold text-[#6B3F1F]">{resolvedPackageName}</p>
                </div>
                <div className="border-t border-[#DDD0B8] pt-3">
                  <p className="text-xs text-[#7A8C7E] uppercase tracking-wide">Measure</p>
                  <p className="font-semibold text-[#6B3F1F]">
                    {measure === 'AREA_WISE'
                      ? `${areaInput} acres`
                      : `${plantsInput} plants · planted ${yearInput}`}
                  </p>
                </div>
                {answerHistory.length > 0 && (
                  <div className="border-t border-[#DDD0B8] pt-3">
                    <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-2">Your selections</p>
                    <div className="flex flex-wrap gap-2">
                      {answerHistory.map((a, i) => (
                        <span key={i} className="text-xs bg-slate-100 text-[#6B3F1F] px-2 py-1 rounded-full">
                          {a.param}: <span className="font-medium">{a.varName}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {error && <p className="text-[#D4682E] text-xs mb-3">{error}</p>}
              <button
                onClick={sendRequest}
                disabled={loading}
                className="w-full py-3.5 rounded-2xl text-white font-semibold disabled:opacity-40"
                style={{ background: COLOUR }}>
                {loading ? 'Sending…' : 'Send advisory request →'}
              </button>
              <button
                onClick={() => setStage('measure')}
                disabled={loading}
                className="mt-3 w-full text-center text-sm text-[#7A8C7E] disabled:opacity-50">
                ← Edit measure
              </button>
            </div>
          )}

          {/* ── STAGE: done ── */}
          {stage === 'done' && (
            <div className="fixed inset-0 flex flex-col items-center justify-center px-8"
              style={{ background: COLOUR }}>
              <p className="text-4xl font-bold text-white mb-4">Request sent!</p>
              <p className="text-white/80 text-center text-base leading-relaxed mb-8">
                <span className="font-semibold text-white">{farmer?.name || 'The farmer'}</span> will receive a
                notification to approve the advisory. You can withdraw the offer from the &ldquo;Pending sent&rdquo; list
                until they respond.
              </p>
              <div className="space-y-3 w-full max-w-xs">
                <button
                  onClick={() => router.push('/facilitator/promoter-assign/pending')}
                  className="w-full py-3.5 px-8 rounded-2xl bg-white font-semibold"
                  style={{ color: COLOUR }}>
                  View pending sent →
                </button>
                <button
                  onClick={() => router.push('/facilitator/promoted-farmers')}
                  className="w-full py-3 text-white text-sm underline underline-offset-2">
                  Back to my promoted farmers
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
