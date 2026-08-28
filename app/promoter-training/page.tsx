'use client'

// Promoter Training Session invite flow — Commit K rewritten 2026-07-25
// per user's screenshot: crops/packages were coming up empty because
// the earlier version passed an empty district and hit the training
// child's client_id straight into `/promoter/crops`, which 403s
// (`_resolve_promoter_at_client` requires an ACTIVE ClientPromoter row,
// and training children have none — bindings live on the parent).
//
// New flow mirrors dealer/promoter-assign one-for-one, with three
// training-specific twists:
//   1. Session picker replaces company picker (auto-skipped when
//      only one training session is active for this promoter).
//   2. Discovery calls (crops / packages / guided-step) are pointed
//      at `session.parent_client_id`. The parent authors the real
//      Package catalogue, promoter's binding exists there. The
//      training child is only referenced at the final
//      `/promoter/training/{tid}/invite-farmer` POST.
//   3. Farmer district comes from their own profile — no manual
//      picker. If the district is missing, refuse hard with a copy
//      that asks the farmer to set it under Profile (option A per
//      user's 2026-07-25 call).
//
// The whole page wears an amber frame so the promoter always sees
// they're in training.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import api from '@/lib/api'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import { cropDisplayName } from '@/lib/crop-name'
import { digitsOnly } from '@/lib/input-normalization'

const COLOUR = '#B45309' // amber-700 — training-frame accent

type Stage =
  | 'loading'
  | 'session'
  | 'phone'
  | 'farmerCard'
  | 'crop'
  | 'guided'
  | 'confirm'
  | 'done'

interface TrainingSession {
  id: string
  parent_client_id: string
  parent_display_name: string
  display_name: string
  training_ends_at: string
  training_status: string
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: '2-digit', month: 'short',
  })
}

// Inline error extractor — backend refusal shape wraps human copy in
// detail.message (per the 2026-07-16 error-surfacing pattern used
// everywhere else in the app).
function extractErr(err: unknown, fallback: string): string {
  const e = err as {
    response?: { data?: { detail?: { message?: string } | string } }
    message?: string
  }
  const d = e?.response?.data?.detail
  if (typeof d === 'string') return d
  if (d && typeof d.message === 'string') return d.message
  return e?.message || fallback
}

function ProgressBar({ stage }: { stage: Stage }) {
  const steps: Stage[] = ['phone', 'farmerCard', 'crop', 'guided', 'confirm', 'done']
  const idx = steps.indexOf(stage)
  if (idx < 0) return null
  return (
    <div className="flex gap-1 mb-4">
      {steps.map((s, i) => (
        <div key={s} className="flex-1 h-1 rounded-full"
          style={{ background: i <= idx ? COLOUR : '#e7e5e4' }} />
      ))}
    </div>
  )
}

export default function PromoterTrainingInvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F5F0E8]" />}>
      <PromoterTrainingInviteInner />
    </Suspense>
  )
}

function PromoterTrainingInviteInner() {
  const router = useRouter()
  const params = useSearchParams()
  const tTrain = useTranslations('training')
  const role = (params.get('role') || 'DEALER').toUpperCase() as 'DEALER' | 'FACILITATOR'
  const activeRole = role === 'DEALER' ? 'DEALER' : 'FACILITATOR'

  const [stage, setStage] = useState<Stage>('loading')
  const [sessions, setSessions] = useState<TrainingSession[]>([])
  const [pickedSession, setPickedSession] = useState<TrainingSession | null>(null)
  const [phone, setPhone] = useState('')
  const [farmer, setFarmer] = useState<FarmerInfo | null>(null)
  const [crops, setCrops] = useState<CropOption[]>([])
  const [selectedCrop, setSelectedCrop] = useState('')
  const [answers, setAnswers] = useState('')
  const [answerHistory, setAnswerHistory] = useState<{ param: string; varName: string }[]>([])
  const [guidedStep, setGuidedStep] = useState<GuidedStep | null>(null)
  const [resolvedPackageId, setResolvedPackageId] = useState('')
  const [districtName, setDistrictName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 1. Load available sessions on mount. Auto-pick when there's only
  //    one (F-P case; D-P may have several).
  useEffect(() => {
    if (!getToken()) { router.replace('/'); return }
    api.get<TrainingSession[]>('/promoter/training/available-clients')
      .then(r => {
        setSessions(r.data)
        if (r.data.length === 1) {
          setPickedSession(r.data[0])
          setStage('phone')
        } else if (r.data.length > 1) {
          setStage('session')
        } else {
          setStage('session') // empty state renders inside 'session'
        }
      })
      .catch(() => {
        setError(tTrain('invite.genericLoadError'))
        setStage('session')
      })
  }, [router, tTrain])

  // 2. Verify phone → fetch farmer's saved district. Refuse hard if
  //    district is missing (option A per user's 2026-07-25 call).
  const verifyPhone = useCallback(async () => {
    if (phone.length < 10) { setError(tTrain('invite.errors.phoneInvalid')); return }
    setError('')
    setLoading(true)
    try {
      const { data } = await api.get<FarmerInfo>(
        `/promoter/farmer-lookup?phone=%2B91${phone}`,
      )
      setFarmer(data)
      setStage('farmerCard')
    } catch (err) {
      setError(extractErr(err, tTrain('invite.errors.phoneNotRegistered')))
    } finally {
      setLoading(false)
    }
  }, [phone, tTrain])

  // 3. From the farmer card, continue to crops. Uses parent_client_id
  //    (not the training child) so the promoter's ACTIVE binding at
  //    the parent satisfies `_resolve_promoter_at_client`. Package
  //    lookups are naturally against the parent's catalogue then.
  const continueToCrops = useCallback(async () => {
    if (!pickedSession || !farmer?.district_cosh_id) return
    setError('')
    setLoading(true)
    try {
      const { data } = await api.get<{ crop_cosh_id: string; name: string }[]>(
        `/promoter/crops?client_id=${encodeURIComponent(pickedSession.parent_client_id)}`
        + `&district_cosh_id=${encodeURIComponent(farmer.district_cosh_id)}`,
      )
      setCrops(data.map(c => ({
        crop_cosh_id: c.crop_cosh_id,
        name: cropDisplayName(c.crop_cosh_id, c.name),
      })))
      setStage('crop')
    } catch {
      setError(tTrain('invite.errors.cropsLoad'))
    } finally {
      setLoading(false)
    }
  }, [pickedSession, farmer, tTrain])

  // 4. Crop → first guided step. Same endpoint the real dealer flow
  //    uses; runs BL-01 elimination in-district against parent's
  //    Packages.
  const selectCrop = useCallback(async (cropId: string) => {
    if (!pickedSession || !farmer?.district_cosh_id) return
    setSelectedCrop(cropId)
    setAnswers('')
    setAnswerHistory([])
    setError('')
    setLoading(true)
    try {
      const { data } = await api.get<GuidedStep>(
        `/promoter/packages/guided-step?crop_cosh_id=${encodeURIComponent(cropId)}`
        + `&district_cosh_id=${encodeURIComponent(farmer.district_cosh_id)}`
        + `&client_id=${encodeURIComponent(pickedSession.parent_client_id)}`
        + `&answers=`,
      )
      setGuidedStep(data)
      if (data.done && data.package) {
        setResolvedPackageId(data.package.id)
        setStage('confirm')
      } else {
        setStage('guided')
      }
    } catch {
      setError(tTrain('invite.errors.guidedStart'))
    } finally {
      setLoading(false)
    }
  }, [pickedSession, farmer, tTrain])

  // 5. Answer a guided question and load the next step. On done →
  //    resolved package + jump to confirm.
  const submitAnswer = useCallback(async (
    paramId: string, varId: string, varName: string,
  ) => {
    if (!pickedSession || !farmer?.district_cosh_id) return
    const newAnswers = answers ? `${answers},${paramId}:${varId}` : `${paramId}:${varId}`
    setAnswers(newAnswers)
    setAnswerHistory(prev => [
      ...prev,
      { param: guidedStep?.parameter?.name || paramId, varName },
    ])
    setError('')
    setLoading(true)
    try {
      const { data } = await api.get<GuidedStep>(
        `/promoter/packages/guided-step?crop_cosh_id=${encodeURIComponent(selectedCrop)}`
        + `&district_cosh_id=${encodeURIComponent(farmer.district_cosh_id)}`
        + `&client_id=${encodeURIComponent(pickedSession.parent_client_id)}`
        + `&answers=${encodeURIComponent(newAnswers)}`,
      )
      setGuidedStep(data)
      if (data.done && data.package) {
        setResolvedPackageId(data.package.id)
        setStage('confirm')
      }
    } catch {
      setError(tTrain('invite.errors.guidedNext'))
    } finally {
      setLoading(false)
    }
  }, [pickedSession, farmer, answers, guidedStep, selectedCrop, tTrain])

  const startOver = useCallback(async () => {
    if (!selectedCrop) return
    setError('')
    setResolvedPackageId('')
    await selectCrop(selectedCrop)
  }, [selectCrop, selectedCrop])

  // 6. Send invite. Only THIS call uses the training child's client
  //    id — the endpoint URL carries training_client_id and the
  //    endpoint itself resolves parent + validates promoter binding
  //    there via `_assert_promoter_at_parent`.
  const sendRequest = useCallback(async () => {
    if (!pickedSession || !resolvedPackageId) return
    setLoading(true); setError('')
    try {
      await api.post(
        `/promoter/training/${pickedSession.id}/invite-farmer`,
        {
          farmer_phone: `+91${phone}`,
          package_id: resolvedPackageId,
          promoter_type: role,
        },
      )
      setStage('done')
    } catch (err) {
      setError(extractErr(err, tTrain('invite.genericError')))
    } finally {
      setLoading(false)
    }
  }, [pickedSession, phone, resolvedPackageId, role, tTrain])

  // 7. Resolve district name for display (best-effort — the crops
  //    endpoint doesn't return district names, so we ping the shared
  //    cosh locations endpoint and pluck the matching label).
  useEffect(() => {
    const districtId = farmer?.district_cosh_id
    if (!districtId) { setDistrictName(''); return }
    let cancelled = false
    interface CoshDistrict { cosh_id: string; name: string | null }
    interface CoshState { cosh_id: string; name: string | null; districts: CoshDistrict[] }
    api.get<{ states: CoshState[] }>('/cosh/locations/india')
      .then(r => {
        if (cancelled) return
        for (const s of r.data.states || []) {
          const d = (s.districts || []).find(x => x.cosh_id === districtId)
          if (d) { setDistrictName(d.name || districtId); return }
        }
        setDistrictName(districtId)
      })
      .catch(() => setDistrictName(districtId))
    return () => { cancelled = true }
  }, [farmer])

  const canSubmit = useMemo(() => !!(pickedSession && resolvedPackageId && !loading), [pickedSession, resolvedPackageId, loading])

  // ── Render ─────────────────────────────────────────────────────

  const header = (
    <PWAHeader
      title={tTrain('invite.headerTitle')}
      activeRole={activeRole}
      back={role === 'DEALER' ? '/dealer/home' : '/facilitator/home'}
    />
  )

  if (stage === 'loading') {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        {header}
        <div className="pt-16 flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-[#DDD0B8] border-t-amber-500 rounded-full animate-spin"/>
        </div>
        <BottomNav color={role === 'DEALER' ? '#7D4196' : '#7D4E00'} activeRole={activeRole} />
      </div>
    )
  }

  const frame = (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3 mb-4">
      <p className="text-amber-900 font-semibold text-sm">{tTrain('invite.frameTitle')}</p>
      <p className="text-amber-800 text-xs mt-1 leading-relaxed">
        {tTrain('invite.frameBody')}
      </p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      {header}
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        {frame}

        {/* Session pill — pinned once picked so the promoter always
            sees which parent client they're practising with. */}
        {pickedSession && stage !== 'session' && stage !== 'done' && (
          <div className="mb-4 px-3 py-2 rounded-full bg-amber-100 border border-amber-300 text-xs text-amber-900">
            {pickedSession.parent_display_name}
            <span className="text-amber-700"> · {tTrain('invite.endsPrefix', { date: formatDate(pickedSession.training_ends_at) })}</span>
          </div>
        )}

        {stage !== 'session' && stage !== 'done' && <ProgressBar stage={stage} />}

        {/* ── STAGE: session ── */}
        {stage === 'session' && (
          sessions.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#DDD0B8] px-4 py-8 text-center">
              <p className="text-[#6B3F1F] font-semibold">{tTrain('invite.noSessionsTitle')}</p>
              <p className="text-xs text-[#7A8C7E] mt-2">{tTrain('invite.noSessionsBody')}</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4">
              <p className="text-xs font-semibold text-[#6B3F1F] mb-2">{tTrain('invite.pickSession')}</p>
              <div className="space-y-2">
                {sessions.map(s => (
                  <button key={s.id}
                    onClick={() => { setPickedSession(s); setStage('phone') }}
                    className="w-full text-left px-3 py-2 rounded-lg border bg-white border-[#DDD0B8]">
                    <p className="text-sm font-semibold text-[#6B3F1F]">
                      {s.parent_display_name}
                    </p>
                    <p className="text-[11px] text-[#7A8C7E] mt-0.5">
                      {tTrain('invite.endsPrefix', { date: formatDate(s.training_ends_at) })}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )
        )}

        {/* ── STAGE: phone ── */}
        {stage === 'phone' && (
          <div>
            <p className="text-xl font-bold text-[#6B3F1F] mb-1">{tTrain('invite.phone.title')}</p>
            <p className="text-sm text-[#7A8C7E] mb-5">{tTrain('invite.phone.subtitle')}</p>
            <div className="flex items-center border border-[#DDD0B8] rounded-xl overflow-hidden bg-white">
              <span className="px-4 py-3.5 text-sm text-[#7A8C7E] bg-[#F5F0E8] border-r border-[#DDD0B8] shrink-0">+91</span>
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={e => { setPhone(digitsOnly(e.target.value, 10)); setError('') }}
                onKeyDown={e => e.key === 'Enter' && verifyPhone()}
                placeholder={tTrain('invite.phone.placeholder')}
                className="flex-1 px-4 py-3.5 text-sm focus:outline-none"
              />
            </div>
            {error && <p className="text-[#D4682E] text-xs mt-2">{error}</p>}
            <button
              onClick={verifyPhone}
              disabled={loading || phone.length < 10}
              className="mt-4 w-full py-3.5 rounded-2xl text-white font-semibold disabled:opacity-40"
              style={{ background: COLOUR }}>
              {loading ? tTrain('invite.phone.checking') : tTrain('invite.phone.verifyCta')}
            </button>
          </div>
        )}

        {/* ── STAGE: farmerCard ── */}
        {stage === 'farmerCard' && farmer && (
          <div>
            <p className="text-xl font-bold text-[#6B3F1F] mb-1">{tTrain('invite.farmerCard.title')}</p>

            <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4 my-4">
              <p className="font-semibold text-[#6B3F1F]">{farmer.name || '—'}</p>
              <p className="text-sm text-[#7A8C7E] mt-0.5">+91{phone}</p>
            </div>

            {/* District — either show it in an amber chip (district
                on file), or refuse hard with option-A copy asking
                the farmer to update their profile. */}
            {farmer.district_cosh_id ? (
              <div className="mb-4 px-4 py-3 rounded-2xl border border-amber-300 bg-amber-50 flex items-start gap-3">
                <span className="text-lg leading-none mt-0.5">📍</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] uppercase tracking-wide font-semibold text-amber-800">{tTrain('invite.farmerCard.districtLabel')}</p>
                  <p className="text-[#6B3F1F] font-semibold text-[15px] mt-0.5">
                    {districtName || farmer.district_cosh_id}
                  </p>
                </div>
              </div>
            ) : (
              <div className="mb-4 px-4 py-3 rounded-2xl border border-red-200 bg-red-50">
                <p className="text-red-800 text-xs leading-relaxed">
                  {tTrain('invite.farmerCard.districtMissing')}
                </p>
              </div>
            )}

            {error && <p className="text-[#D4682E] text-xs mb-2">{error}</p>}
            <button
              onClick={continueToCrops}
              disabled={loading || !farmer.district_cosh_id}
              className="w-full py-3.5 rounded-2xl text-white font-semibold disabled:opacity-40"
              style={{ background: COLOUR }}>
              {loading ? tTrain('invite.farmerCard.loadingCrops') : tTrain('invite.farmerCard.continueCta')}
            </button>
            <button onClick={() => { setStage('phone'); setError('') }}
              className="mt-3 w-full text-center text-sm text-[#7A8C7E]">
              {tTrain('invite.farmerCard.back')}
            </button>
          </div>
        )}

        {/* ── STAGE: crop ── */}
        {stage === 'crop' && (
          <div>
            <p className="text-xl font-bold text-[#6B3F1F] mb-1">{tTrain('invite.crop.title')}</p>
            <p className="text-sm text-[#7A8C7E] mb-5">
              {tTrain('invite.crop.subtitleWith', {
                company: pickedSession?.parent_display_name || '',
                district: districtName || farmer?.district_cosh_id || '—',
              })}
            </p>
            {crops.length === 0 ? (
              <p className="text-[#7A8C7E] text-sm py-6 text-center">
                {tTrain('invite.crop.empty', {
                  company: pickedSession?.parent_display_name || '',
                  district: districtName || farmer?.district_cosh_id || '—',
                })}
              </p>
            ) : (
              <div className="space-y-2">
                {crops.map(c => (
                  <button key={c.crop_cosh_id}
                    onClick={() => selectCrop(c.crop_cosh_id)}
                    disabled={loading}
                    className="w-full text-left px-4 py-3.5 rounded-xl border border-[#DDD0B8] bg-white text-sm font-medium text-[#6B3F1F] hover:border-amber-500 hover:text-amber-800 transition-colors disabled:opacity-40">
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            {loading && (
              <div className="flex justify-center py-6">
                <div className="w-6 h-6 border-2 border-[#DDD0B8] border-t-amber-500 rounded-full animate-spin"/>
              </div>
            )}
            {error && <p className="text-[#D4682E] text-xs mt-2">{error}</p>}
            <button onClick={() => setStage('farmerCard')}
              className="mt-4 w-full text-center text-sm text-[#7A8C7E]">
              {tTrain('invite.crop.back')}
            </button>
          </div>
        )}

        {/* ── STAGE: guided ── */}
        {stage === 'guided' && guidedStep && !guidedStep.done && (
          <div>
            <p className="text-xl font-bold text-[#6B3F1F] mb-1">
              {guidedStep.parameter?.name || tTrain('invite.guided.fallbackTitle')}
            </p>
            <p className="text-sm text-[#7A8C7E] mb-2">
              {tTrain('invite.guided.remaining', { count: guidedStep.remaining_count || 0 })}
            </p>

            {answerHistory.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {answerHistory.map((a, i) => (
                  <span key={i} className="text-xs bg-amber-100 text-amber-900 px-2 py-1 rounded-full">
                    {a.param}: <span className="font-medium">{a.varName}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="space-y-2">
              {guidedStep.variables?.map(v => (
                <button key={v.id}
                  onClick={() => submitAnswer(guidedStep.parameter!.id, v.id, v.name)}
                  disabled={loading}
                  className="w-full text-left px-4 py-3.5 rounded-xl border border-[#DDD0B8] bg-white text-sm font-medium text-[#6B3F1F] hover:border-amber-500 hover:text-amber-800 transition-colors disabled:opacity-40">
                  {v.name}
                </button>
              ))}
            </div>

            {loading && (
              <div className="flex justify-center py-4">
                <div className="w-6 h-6 border-2 border-[#DDD0B8] border-t-amber-500 rounded-full animate-spin"/>
              </div>
            )}
            {error && <p className="text-[#D4682E] text-xs mt-2">{error}</p>}
            {answerHistory.length > 0 && (
              <button onClick={startOver}
                disabled={loading}
                className="mt-5 w-full py-3 rounded-2xl text-[#7A8C7E] text-sm disabled:opacity-50">
                {tTrain('invite.guided.startOver')}
              </button>
            )}
          </div>
        )}

        {/* ── STAGE: confirm ── */}
        {stage === 'confirm' && (
          <div>
            <p className="text-xl font-bold text-[#6B3F1F] mb-1">{tTrain('invite.confirm.title')}</p>
            <p className="text-sm text-[#7A8C7E] mb-5">{tTrain('invite.confirm.subtitle')}</p>

            <div className="bg-white rounded-2xl border border-[#DDD0B8] p-5 space-y-3 mb-5">
              <div>
                <p className="text-xs text-[#7A8C7E] uppercase tracking-wide">{tTrain('invite.confirm.farmerLabel')}</p>
                <p className="font-semibold text-[#6B3F1F]">{farmer?.name || '—'}</p>
                <p className="text-sm text-[#7A8C7E]">+91{phone}</p>
              </div>
              <div className="border-t border-[#DDD0B8] pt-3">
                <p className="text-xs text-[#7A8C7E] uppercase tracking-wide">{tTrain('invite.confirm.sessionLabel')}</p>
                <p className="font-semibold text-[#6B3F1F]">{pickedSession?.parent_display_name}</p>
              </div>
              <div className="border-t border-[#DDD0B8] pt-3">
                <p className="text-xs text-[#7A8C7E] uppercase tracking-wide">{tTrain('invite.confirm.cropLabel')}</p>
                <p className="font-semibold text-[#6B3F1F]">{cropDisplayName(selectedCrop, crops.find(c => c.crop_cosh_id === selectedCrop)?.name)}</p>
              </div>
              {answerHistory.length > 0 && (
                <div className="border-t border-[#DDD0B8] pt-3">
                  <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-2">{tTrain('invite.confirm.selectionsLabel')}</p>
                  <div className="flex flex-wrap gap-2">
                    {answerHistory.map((a, i) => (
                      <span key={i} className="text-xs bg-amber-100 text-amber-900 px-2 py-1 rounded-full">
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
              disabled={!canSubmit}
              className="w-full py-3.5 rounded-2xl text-white font-semibold disabled:opacity-40"
              style={{ background: COLOUR }}>
              {loading ? tTrain('invite.confirm.sending') : tTrain('invite.confirm.sendRequest')}
            </button>
            <button onClick={startOver}
              disabled={loading}
              className="mt-3 w-full text-center text-sm text-[#7A8C7E] disabled:opacity-50">
              {tTrain('invite.confirm.startOver')}
            </button>
          </div>
        )}

        {/* ── STAGE: done ── */}
        {stage === 'done' && (
          <div className="fixed inset-0 flex flex-col items-center justify-center px-8"
            style={{ background: COLOUR }}>
            <p className="text-4xl font-bold text-white mb-4">{tTrain('invite.done.title')}</p>
            <p className="text-white/80 text-center text-base leading-relaxed mb-8">
              <span className="font-semibold text-white">{farmer?.name || '—'}</span>{' '}
              {tTrain('invite.done.bodySuffix')}
            </p>
            <div className="space-y-3 w-full max-w-xs">
              <button
                onClick={() => router.push(role === 'DEALER' ? '/dealer/home' : '/facilitator/home')}
                className="w-full py-3.5 px-8 rounded-2xl bg-white font-semibold"
                style={{ color: COLOUR }}>
                {tTrain('invite.done.backHome')}
              </button>
            </div>
          </div>
        )}
      </div>
      <BottomNav color={role === 'DEALER' ? '#7D4196' : '#7D4E00'} activeRole={activeRole} />
    </div>
  )
}
