'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

const COLOUR = '#085041'

type Stage = 'gate' | 'company' | 'phone' | 'confirm_farmer' | 'crop' | 'guided' | 'confirm' | 'done'

// Cosh-driven location universe — same shape as /subscribe.
type CoshDistrict = { cosh_id: string; name: string | null }
type CoshState = { cosh_id: string; name: string | null; districts: CoshDistrict[] }
type CoshLocations = { states: CoshState[] }

interface AllocationRow {
  client_id: string
  client_name: string
  units_balance: number
  allocated_total: number
  reclaimed_total: number
  consumed_total: number
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

function formatCropName(coshId: string, name?: string | null): string {
  return cropDisplayName(coshId, name)
}

function ProgressBar({ stage }: { stage: Stage }) {
  const steps: Stage[] = ['company', 'phone', 'confirm_farmer', 'crop', 'guided', 'confirm', 'done']
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

export default function DealerPromoterAssignPage() {
  const router = useRouter()
  const t = useTranslations('dealer.promoterAssign')
  const tCommon = useTranslations('common')
  const [stage, setStage] = useState<Stage>('gate')
  const [allocations, setAllocations] = useState<AllocationRow[] | null>(null)
  const [allocationsError, setAllocationsError] = useState<string | null>(null)
  const [selectedClientId, setSelectedClientId] = useState('')
  const [phone, setPhone] = useState('')
  const [farmer, setFarmer] = useState<FarmerInfo | null>(null)
  // Location typeahead state — mirrors /subscribe + F-P.
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
  const [answerHistory, setAnswerHistory] = useState<{ param: string; varName: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Multi-client kitty refresh. Dealer assignments span N companies,
  // so /promoter/me/allocations (not /promoter/me/kitty) is the source.
  const refreshAllocations = useCallback(async () => {
    try {
      const { data } = await api.get<AllocationRow[]>('/promoter/me/allocations')
      setAllocations(data)
      setAllocationsError(null)
    } catch {
      setAllocationsError(t('errors.kittiesLoad'))
      setAllocations([])
    }
  }, [t])

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    refreshAllocations().then(() => setStage(s => s === 'gate' ? 'company' : s))
    api.get<CoshLocations>('/cosh/locations/india')
      .then(r => setCoshLocations(r.data))
      .catch(() => { /* fall through */ })
  }, [refreshAllocations, router])

  useEffect(() => {
    function onVisibility() { if (!document.hidden) refreshAllocations() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [refreshAllocations])

  const spendable = (allocations || []).filter(a => a.units_balance > 0)
  const selectedRow = (allocations || []).find(a => a.client_id === selectedClientId) || null

  async function verifyPhone() {
    if (phone.length < 10) { setError(t('errors.phoneInvalid')); return }
    setError('')
    setLoading(true)
    try {
      const { data } = await api.get<FarmerInfo>(`/promoter/farmer-lookup?phone=%2B91${phone}`)
      setFarmer(data)
      setStateId(data.state_cosh_id || '')
      setDistrict(data.district_cosh_id || '')
      setEditingLocation(!data.district_cosh_id)
      setStateSearch('')
      setDistrictSearch('')
      setStage('confirm_farmer')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err?.response?.data?.detail || t('errors.phoneNotRegistered'))
    } finally { setLoading(false) }
  }

  async function continueToCrops() {
    if (!district) { setError(t('errors.districtRequired')); return }
    setError('')
    setLoading(true)
    try {
      const { data } = await api.get<CropOption[]>(
        `/promoter/crops?district_cosh_id=${encodeURIComponent(district)}&client_id=${encodeURIComponent(selectedClientId)}`
      )
      setCrops(data)
      setStage('crop')
    } catch {
      setError(t('errors.cropsLoad'))
    } finally { setLoading(false) }
  }

  async function selectCrop(cropId: string) {
    setSelectedCrop(cropId)
    setAnswers('')
    setAnswerHistory([])
    setLoading(true)
    try {
      const { data } = await api.get<GuidedStep>(
        `/promoter/packages/guided-step?crop_cosh_id=${encodeURIComponent(cropId)}&district_cosh_id=${encodeURIComponent(district)}&client_id=${encodeURIComponent(selectedClientId)}&answers=`
      )
      setGuidedStep(data)
      if (data.done && data.package) {
        setResolvedPackageId(data.package.id)
        setStage('confirm')
      } else {
        setStage('guided')
      }
    } catch {
      setError(t('errors.guidedStart'))
    } finally { setLoading(false) }
  }

  async function submitAnswer(paramId: string, varId: string, varName: string) {
    const newAnswers = answers ? `${answers},${paramId}:${varId}` : `${paramId}:${varId}`
    setAnswers(newAnswers)
    setAnswerHistory(prev => [...prev, { param: guidedStep?.parameter?.name || paramId, varName }])
    setLoading(true)
    try {
      const { data } = await api.get<GuidedStep>(
        `/promoter/packages/guided-step?crop_cosh_id=${encodeURIComponent(selectedCrop)}&district_cosh_id=${encodeURIComponent(district)}&client_id=${encodeURIComponent(selectedClientId)}&answers=${encodeURIComponent(newAnswers)}`
      )
      setGuidedStep(data)
      if (data.done && data.package) {
        setResolvedPackageId(data.package.id)
        setStage('confirm')
      }
    } catch {
      setError(t('errors.guidedNext'))
    } finally { setLoading(false) }
  }

  async function startOver() {
    if (!selectedCrop) return
    setError('')
    setResolvedPackageId('')
    await selectCrop(selectedCrop)
  }

  async function sendRequest() {
    setLoading(true)
    setError('')
    try {
      // 2026-05-30: farmer's farm area / plant count are no longer
      // collected during Promoter-assign — the farmer sets +
      // confirms them on their Crop Dashboard after accepting.
      const body: Record<string, unknown> = {
        farmer_phone: `+91${phone}`,
        client_id: selectedClientId,
        package_id: resolvedPackageId,
        promoter_type: 'DEALER',
      }
      await api.post('/promoter/assignments/initiate', body)
      await refreshAllocations()
      setStage('done')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string | { message?: string } } } }
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : detail?.message || t('errors.sendRequest')
      setError(msg)
    } finally { setLoading(false) }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (stage === 'gate') {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/home" />
        <div className="pt-16 px-4 max-w-lg mx-auto">
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-[#DDD0B8] border-t-[#085041] rounded-full animate-spin" />
          </div>
        </div>
      </div>
    )
  }

  // No companies with spendable units → empty state. Cleaner than
  // letting the user pick a company and fail at initiate-time.
  if (allocationsError || spendable.length === 0) {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/home" />
        <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
          <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-base font-bold text-amber-900 mb-2">{t('noSubsTitle')}</p>
            <p className="text-sm text-amber-800 leading-relaxed">
              {allocationsError || t('noSubsBody')}
            </p>
          </div>
          <button
            onClick={refreshAllocations}
            className="mt-4 w-full py-3 rounded-2xl border border-[#DDD0B8] bg-white text-sm font-semibold text-[#6B3F1F]">
            {t('refresh')}
          </button>
          <button
            onClick={() => router.push('/dealer/promoter-assign/pending')}
            className="mt-3 w-full py-3 rounded-2xl border border-[#DDD0B8] bg-white text-sm font-semibold text-[#6B3F1F]">
            {t('viewPendingSent')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/home" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        <div className="mt-4">
          {/* Active-company chip — pinned across every stage past
              company-pick so the Dealer always sees which kitty
              they're spending from. */}
          {selectedRow && stage !== 'company' && stage !== 'done' && (
            <div className="flex items-center justify-between mb-4 px-3 py-2 rounded-full bg-emerald-50 border border-emerald-200">
              <span className="text-xs text-emerald-800 truncate">
                <span className="font-semibold">{selectedRow.units_balance.toLocaleString('en-IN')}</span>{' '}
                {t('kittyChipPrefix')}{' '}
                <span className="font-semibold">{selectedRow.client_name}</span>
              </span>
              <button
                onClick={() => router.push('/dealer/promoter-assign/pending')}
                className="text-xs font-semibold text-emerald-900 underline underline-offset-2 shrink-0 ml-2">
                {t('kittyChipLink')}
              </button>
            </div>
          )}

          <ProgressBar stage={stage} />

          {/* ── STAGE: company ── */}
          {stage === 'company' && (
            <div>
              <p className="text-xl font-bold text-[#6B3F1F] mb-1">{t('company.title')}</p>
              <p className="text-sm text-[#7A8C7E] mb-5">
                {t('company.subtitle')}
              </p>
              <div className="space-y-2 mb-5">
                {spendable.map(a => (
                  <button
                    key={a.client_id}
                    onClick={() => { setSelectedClientId(a.client_id); setStage('phone') }}
                    className="w-full flex items-center justify-between text-left px-4 py-3.5 rounded-xl border border-[#DDD0B8] bg-white hover:border-[#085041] transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#6B3F1F] truncate">{a.client_name}</p>
                      <p className="text-xs text-[#7A8C7E] mt-0.5">
                        {t('company.subsLeft', { count: a.units_balance })}
                      </p>
                    </div>
                    <span className="text-[#7A8C7E] text-sm" aria-hidden>›</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => router.push('/dealer/promoter-assign/pending')}
                className="w-full py-3 rounded-2xl border border-[#DDD0B8] bg-white text-sm font-semibold text-[#6B3F1F]">
                {t('company.pendingSentCta')}
              </button>
            </div>
          )}

          {/* ── STAGE: phone ── */}
          {stage === 'phone' && (
            <div>
              <p className="text-xl font-bold text-[#6B3F1F] mb-1">{t('phone.title')}</p>
              <p className="text-sm text-[#7A8C7E] mb-5">{t('phone.subtitle')}</p>
              <div className="flex items-center border border-[#DDD0B8] rounded-xl overflow-hidden bg-white">
                <span className="px-4 py-3.5 text-sm text-[#7A8C7E] bg-[#F5F0E8] border-r border-[#DDD0B8] shrink-0">+91</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setError('') }}
                  onKeyDown={e => e.key === 'Enter' && verifyPhone()}
                  placeholder={t('phone.placeholder')}
                  className="flex-1 px-4 py-3.5 text-sm focus:outline-none"
                />
              </div>
              {error && <p className="text-[#D4682E] text-xs mt-2">{error}</p>}
              <button
                onClick={verifyPhone}
                disabled={loading || phone.length < 10}
                className="mt-4 w-full py-3.5 rounded-2xl text-white font-semibold disabled:opacity-40"
                style={{ background: COLOUR }}>
                {loading ? t('phone.checking') : t('phone.verifyCta')}
              </button>
              <button onClick={() => setStage('company')} className="mt-3 w-full text-center text-sm text-[#7A8C7E]">
                {t('phone.changeCompany')}
              </button>
            </div>
          )}

          {/* ── STAGE: confirm_farmer ── */}
          {stage === 'confirm_farmer' && farmer && (() => {
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
                <p className="text-xl font-bold text-[#6B3F1F] mb-1">{t('confirmFarmer.title')}</p>
                <p className="text-sm text-[#7A8C7E] mb-5">{t('confirmFarmer.subtitle')}</p>

                <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4 mb-5">
                  <p className="font-semibold text-[#6B3F1F]">{farmer.name || t('confirmFarmer.unnamedFarmer')}</p>
                  <p className="text-sm text-[#7A8C7E] mt-0.5">+91{phone}</p>
                </div>

                <p className="text-sm font-semibold text-[#6B3F1F] mb-2">{t('confirmFarmer.locationLabel')}</p>
                {!coshLocations && (
                  <div className="flex items-center gap-3 text-[#7A8C7E] text-sm mb-3">
                    <div className="w-4 h-4 border-2 border-[#DDD0B8] border-t-[#085041] rounded-full animate-spin"/>
                    {t('confirmFarmer.loadingLocations')}
                  </div>
                )}

                {coshLocations && hasResolvedLocation && !editingLocation && (
                  <div className="mb-4 px-4 py-3 rounded-2xl border border-[#085041]/30 bg-[#085041]/10 flex items-start gap-3">
                    <span className="text-lg leading-none mt-0.5">📍</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] uppercase tracking-wide font-semibold text-[#085041]">{t('confirmFarmer.savedLabel')}</p>
                      <p className="text-[#6B3F1F] font-semibold text-[15px] mt-0.5">
                        {districtName} <span className="text-[#7A8C7E] font-normal">· {stateName || '—'}</span>
                      </p>
                    </div>
                    <button onClick={() => { setEditingLocation(true); setStateSearch(''); setDistrictSearch('') }}
                      className="text-[12px] text-[#085041] underline shrink-0">
                      {tCommon('change')}
                    </button>
                  </div>
                )}

                {coshLocations && (!hasResolvedLocation || editingLocation) && (
                  <div className="space-y-3 mb-4">
                    <div>
                      <label className="text-xs text-[#7A8C7E] font-medium mb-1 block">{t('confirmFarmer.stateLabel')}</label>
                      {stateId ? (
                        <div className="flex items-center gap-2">
                          <span className="bg-[#085041]/10 text-[#085041] text-sm font-medium px-3 py-1.5 rounded-full">
                            {stateName || t('confirmFarmer.unnamed')}
                          </span>
                          <button onClick={() => {
                              setStateId(''); setStateSearch('')
                              setDistrict(''); setDistrictSearch('')
                            }}
                            className="text-[11px] text-[#7A8C7E] underline">{tCommon('change')}</button>
                        </div>
                      ) : (
                        <>
                          <input value={stateSearch} onChange={e => setStateSearch(e.target.value)}
                            placeholder={t('confirmFarmer.searchState')}
                            className="w-full border border-[#DDD0B8] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#085041]/20"/>
                          {stateSearch && (
                            <div className="mt-1 border border-[#DDD0B8] rounded-xl overflow-hidden max-h-40 overflow-y-auto bg-white">
                              {filteredStates.length === 0
                                ? <p className="text-[#7A8C7E] text-sm px-4 py-3">{t('confirmFarmer.noStates')}</p>
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

                    {stateId && (
                      <div>
                        <label className="text-xs text-[#7A8C7E] font-medium mb-1 block">{t('confirmFarmer.districtLabel')}</label>
                        {district ? (
                          <div className="flex items-center gap-2">
                            <span className="bg-[#085041]/10 text-[#085041] text-sm font-medium px-3 py-1.5 rounded-full">
                              {districtName || t('confirmFarmer.unnamed')}
                            </span>
                            <button onClick={() => { setDistrict(''); setDistrictSearch('') }}
                              className="text-[11px] text-[#7A8C7E] underline">{tCommon('change')}</button>
                          </div>
                        ) : (
                          <>
                            <input value={districtSearch} onChange={e => setDistrictSearch(e.target.value)}
                              placeholder={t('confirmFarmer.searchDistrict')}
                              className="w-full border border-[#DDD0B8] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#085041]/20"/>
                            {(districtSearch || (selectedState?.districts.length || 0) <= 30) && (
                              <div className="mt-1 border border-[#DDD0B8] rounded-xl overflow-hidden max-h-40 overflow-y-auto bg-white">
                                {filteredDistricts.length === 0
                                  ? <p className="text-[#7A8C7E] text-sm px-4 py-3">{t('confirmFarmer.noDistricts')}</p>
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
                  {loading ? t('confirmFarmer.loadingCrops') : t('confirmFarmer.continueCta')}
                </button>
                <button onClick={() => setStage('phone')} className="mt-3 w-full text-center text-sm text-[#7A8C7E]">
                  {t('confirmFarmer.back')}
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
              <p className="text-xl font-bold text-[#6B3F1F] mb-1">{t('crop.title')}</p>
              <p className="text-sm text-[#7A8C7E] mb-5">
                {t('crop.subtitle', { company: selectedRow?.client_name || '', district: districtLabel })}
              </p>
              {crops.length === 0 ? (
                <p className="text-[#7A8C7E] text-sm py-6 text-center">
                  {t('crop.empty', { company: selectedRow?.client_name || '' })}
                </p>
              ) : (
                <div className="space-y-2">
                  {crops.map(c => (
                    <button
                      key={c.crop_cosh_id}
                      onClick={() => selectCrop(c.crop_cosh_id)}
                      disabled={loading}
                      className="w-full text-left px-4 py-3.5 rounded-xl border border-[#DDD0B8] bg-white text-sm font-medium text-[#6B3F1F] hover:border-[#085041] hover:text-[#085041] transition-colors disabled:opacity-40">
                      {formatCropName(c.crop_cosh_id, c.name)}
                    </button>
                  ))}
                </div>
              )}
              {loading && (
                <div className="flex justify-center py-6">
                  <div className="w-6 h-6 border-2 border-[#DDD0B8] border-t-[#085041] rounded-full animate-spin" />
                </div>
              )}
              <button onClick={() => setStage('confirm_farmer')} className="mt-4 w-full text-center text-sm text-[#7A8C7E]">
                {t('crop.back')}
              </button>
            </div>
            )
          })()}

          {/* ── STAGE: guided ── */}
          {stage === 'guided' && guidedStep && !guidedStep.done && (
            <div>
              <p className="text-xl font-bold text-[#6B3F1F] mb-1">
                {guidedStep.parameter?.name || t('guided.fallbackTitle')}
              </p>
              <p className="text-sm text-[#7A8C7E] mb-2">
                {t('guided.remaining', { count: guidedStep.remaining_count || 0 })}
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
                    className="w-full text-left px-4 py-3.5 rounded-xl border border-[#DDD0B8] bg-white text-sm font-medium text-[#6B3F1F] hover:border-[#085041] hover:text-[#085041] transition-colors disabled:opacity-40">
                    {v.name}
                  </button>
                ))}
              </div>

              {loading && (
                <div className="flex justify-center py-4">
                  <div className="w-6 h-6 border-2 border-[#DDD0B8] border-t-[#085041] rounded-full animate-spin" />
                </div>
              )}
              {error && <p className="text-[#D4682E] text-xs mt-2">{error}</p>}
              {answerHistory.length > 0 && (
                <button
                  onClick={startOver}
                  disabled={loading}
                  className="mt-5 w-full py-3 rounded-2xl text-[#7A8C7E] text-sm disabled:opacity-50">
                  {t('guided.startOver')}
                </button>
              )}
            </div>
          )}

          {/* ── STAGE: confirm ── */}
          {stage === 'confirm' && (
            <div>
              <p className="text-xl font-bold text-[#6B3F1F] mb-1">{t('confirm.title')}</p>
              <p className="text-sm text-[#7A8C7E] mb-5">{t('confirm.subtitle')}</p>

              <div className="bg-white rounded-2xl border border-[#DDD0B8] p-5 space-y-3 mb-5">
                <div>
                  <p className="text-xs text-[#7A8C7E] uppercase tracking-wide">{t('confirm.farmerLabel')}</p>
                  <p className="font-semibold text-[#6B3F1F]">{farmer?.name || t('confirm.farmerFallback')}</p>
                  <p className="text-sm text-[#7A8C7E]">+91{phone}</p>
                </div>
                <div className="border-t border-[#DDD0B8] pt-3">
                  <p className="text-xs text-[#7A8C7E] uppercase tracking-wide">{t('confirm.companyLabel')}</p>
                  <p className="font-semibold text-[#6B3F1F]">{selectedRow?.client_name}</p>
                </div>
                <div className="border-t border-[#DDD0B8] pt-3">
                  <p className="text-xs text-[#7A8C7E] uppercase tracking-wide">{t('confirm.cropLabel')}</p>
                  <p className="font-semibold text-[#6B3F1F]">{formatCropName(selectedCrop)}</p>
                </div>
                {answerHistory.length > 0 && (
                  <div className="border-t border-[#DDD0B8] pt-3">
                    <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-2">{t('confirm.selectionsLabel')}</p>
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
                {loading ? t('confirm.sending') : t('confirm.sendRequest')}
              </button>
              <button
                onClick={startOver}
                disabled={loading}
                className="mt-3 w-full text-center text-sm text-[#7A8C7E] disabled:opacity-50">
                {t('confirm.startOver')}
              </button>
            </div>
          )}

          {/* ── STAGE: done ── */}
          {stage === 'done' && (
            <div className="fixed inset-0 flex flex-col items-center justify-center px-8"
              style={{ background: COLOUR }}>
              <p className="text-4xl font-bold text-white mb-4">{t('done.title')}</p>
              <p className="text-white/80 text-center text-base leading-relaxed mb-8">
                <span className="font-semibold text-white">{farmer?.name || t('done.fallbackName')}</span>{' '}
                {t('done.bodySuffix')}
              </p>
              <div className="space-y-3 w-full max-w-xs">
                <button
                  onClick={() => router.push('/dealer/promoter-assign/pending')}
                  className="w-full py-3.5 px-8 rounded-2xl bg-white font-semibold"
                  style={{ color: COLOUR }}>
                  {t('done.viewPendingSent')}
                </button>
                <button
                  onClick={() => router.push('/dealer/promoted-farmers')}
                  className="w-full py-3 text-white text-sm underline underline-offset-2">
                  {t('done.backToFarmers')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
