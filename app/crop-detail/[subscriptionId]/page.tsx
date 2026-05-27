'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'
import PhoneVerify from '@/components/PhoneVerify'

interface CropAge {
  value: number
  unit: 'days' | 'years'
  source: 'START_DATE' | 'PLANTING_YEAR'
  // True when the farmer picked "Beyond 1970" — the displayed value
  // is the floor (current_year - 1970); UI renders "> N years".
  is_minimum?: boolean
}

const PLANTING_YEAR_FLOOR = 1970
const PLANTING_YEAR_BEYOND_SENTINEL = 1969   // matches backend's PLANTING_YEAR_FLOOR - 1

interface SubscriptionDetail {
  id: string; status: string; crop_start_date: string | null
  crop_start_date_first_set_at: string | null
  reference_number: string | null; client_id: string; package_id: string
  subscription_type?: string
  // Area-wise context — populated only when crop_measure is AREA_WISE
  // (legacy plant-wise subs may still carry it; see lenient migration).
  farm_area_acres: number | null
  area_unit: string | null
  farm_area_confirmed_at: string | null
  // Plant-wise context (2026-05-27)
  number_of_plants: number | null
  planting_year: number | null
  plant_count_confirmed_at: string | null
  // Live crop typing from Cosh. Untyped crops default to AREA_WISE.
  crop_measure: 'AREA_WISE' | 'PLANT_WISE'
  crop_age: CropAge | null
  crop_cosh_id?: string | null
  crop_name?: string | null
  package_name?: string | null
}
interface Branding {
  display_name: string; primary_colour: string; tagline: string | null; logo_url: string | null
}
interface PreStartInput {
  timeline_id: string; timeline_name: string
  days_before_sowing_from: number; days_before_sowing_to: number
  practices: { id: string; l0_type: string; l1_type: string | null; l2_type: string | null }[]
}
interface AlertPrefs {
  extra_phone: string | null
  extra_name: string | null
  source: 'override' | 'auto_promoter' | 'none'
}
interface ExpertSetting {
  mode: 'SPECIFIC' | 'PROMOTER_PUNDIT' | 'REGULAR_TEAM'
  preferred_pundit: { pundit_id: string; name: string | null; phone: string | null } | null
  promoter_pundit: { pundit_id: string; name: string | null; phone: string | null } | null
  company_experts: { pundit_id: string; name: string | null; phone: string | null; role: string }[]
}
interface SeedAvail { has_varieties: boolean; count: number }

// All advisory formulas (dosing, water volume, fertiliser) are
// calibrated for acres. Acreage is captured and stored in acres
// only — no unit dropdown. If a farmer thinks in hectares or
// bigha they convert before typing. V2 may introduce server-side
// conversion at the boundary.

export default function CropDetailPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const router = useRouter()
  const [sub, setSub] = useState<SubscriptionDetail | null>(null)
  const [branding, setBranding] = useState<Branding | null>(null)
  const [preStart, setPreStart] = useState<PreStartInput[]>([])
  const [missedCount, setMissedCount] = useState(0)
  const [alertPrefs, setAlertPrefs] = useState<AlertPrefs | null>(null)
  const [expertSetting, setExpertSetting] = useState<ExpertSetting | null>(null)
  const [seedAvail, setSeedAvail] = useState<SeedAvail>({ has_varieties: false, count: 0 })
  const [me, setMe] = useState<{ name: string | null; phone: string | null } | null>(null)
  const [loading, setLoading] = useState(true)

  // Start date state
  const [startDate, setStartDate] = useState('')
  const [savingDate, setSavingDate] = useState(false)
  const [showStartDate, setShowStartDate] = useState(false)

  // Acreage state (area-wise crops)
  const [areaInput, setAreaInput] = useState('')
  const [savingArea, setSavingArea] = useState(false)

  // Plant-count state (plant-wise crops). Separate save buttons so
  // the farmer can update one field at a time — backend tolerates
  // a partial body with either field present.
  const [plantsInput, setPlantsInput] = useState('')
  const [yearInput, setYearInput] = useState('')
  const [savingPlants, setSavingPlants] = useState(false)

  // Bottom sheets
  const [orderSheet, setOrderSheet] = useState<{ open: boolean; category: 'PESTICIDE' | 'FERTILISER' | null }>({ open: false, category: null })
  const [orderBusy, setOrderBusy] = useState(false)
  const [orderSheetArea, setOrderSheetArea] = useState('')
  const [orderSheetEditingArea, setOrderSheetEditingArea] = useState(false)
  const [orderSuccess, setOrderSuccess] = useState<{ order_id: string; item_count: number } | null>(null)

  const [alertSheet, setAlertSheet] = useState(false)
  const [alertPhoneInput, setAlertPhoneInput] = useState('')
  const [alertNameInput, setAlertNameInput] = useState('')
  const [savingAlerts, setSavingAlerts] = useState(false)

  const [expertSheet, setExpertSheet] = useState(false)
  const [savingExpert, setSavingExpert] = useState(false)

  const [showNeedDateSheet, setShowNeedDateSheet] = useState<'advisory' | 'diagnose' | null>(null)

  const [diagnosisEligibility, setDiagnosisEligibility] = useState<{
    eligible: boolean
    reason_code?: string
    message?: string
  } | null>(null)

  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    const userJson = typeof window !== 'undefined' ? localStorage.getItem('rt_pwa_user') : null
    if (userJson) {
      try {
        const u = JSON.parse(userJson)
        setMe({ name: u.name || null, phone: u.phone || null })
      } catch {}
    }
    load()
  }, [subscriptionId])

  async function load() {
    try {
      const subs = await api.get<SubscriptionDetail[]>('/farmer/my-subscriptions')
      const found = subs.data.find(s => s.id === subscriptionId)
      if (!found) { router.replace('/home'); return }
      setSub(found)
      setStartDate(found.crop_start_date?.split('T')[0] || '')
      setAreaInput(found.farm_area_acres != null ? String(found.farm_area_acres) : '')
      setPlantsInput(found.number_of_plants != null ? String(found.number_of_plants) : '')
      setYearInput(found.planting_year != null ? String(found.planting_year) : '')

      // Diagnose-button gate: ClientCrop ∩ CropHealthCrop. Server
      // returns the reason when ineligible so the button greys with
      // an explanation. Failure is non-fatal — fallback assumes
      // eligible so the button still works in degraded mode.
      try {
        const elig = await api.get<{ eligible: boolean; reason_code?: string; message?: string }>(
          `/diagnosis/eligibility/${subscriptionId}`,
        )
        setDiagnosisEligibility(elig.data)
      } catch {
        setDiagnosisEligibility({ eligible: true })
      }

      const [brandRes, preStartRes, missedRes, alertsRes, expertRes, seedRes] = await Promise.allSettled([
        api.get<Branding>(`/client/${found.client_id}/info`),
        api.get<PreStartInput[]>(`/farmer/subscriptions/${subscriptionId}/pre-start-inputs`),
        api.get<{ count: number } | { timeline_id: string }[]>(`/farmer/subscriptions/${subscriptionId}/missed-items`),
        api.get<AlertPrefs>(`/farmer/subscriptions/${subscriptionId}/alert-preferences`),
        api.get<ExpertSetting>(`/farmer/subscriptions/${subscriptionId}/expert-setting`),
        api.get<SeedAvail>(`/farmer/subscriptions/${subscriptionId}/seed-availability`),
      ])

      if (brandRes.status === 'fulfilled') setBranding(brandRes.value.data)
      if (preStartRes.status === 'fulfilled') setPreStart(preStartRes.value.data)
      if (missedRes.status === 'fulfilled') {
        const d = missedRes.value.data
        setMissedCount(Array.isArray(d) ? d.length : (d as { count: number }).count)
      }
      if (alertsRes.status === 'fulfilled') {
        setAlertPrefs(alertsRes.value.data)
      }
      if (expertRes.status === 'fulfilled') setExpertSetting(expertRes.value.data)
      if (seedRes.status === 'fulfilled') setSeedAvail(seedRes.value.data)
    } finally { setLoading(false) }
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2400)
  }

  async function saveStartDate() {
    if (!startDate || !startDate.trim()) {
      showToast('Please choose a date. The start date cannot be removed once set.')
      return
    }
    setSavingDate(true)
    try {
      await api.put(`/farmer/subscriptions/${subscriptionId}/start-date`, {
        crop_start_date: new Date(startDate).toISOString(),
      })
      setSub(s => s ? { ...s, crop_start_date: new Date(startDate).toISOString() } : s)
      setShowStartDate(false)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      showToast(err.response?.data?.detail || 'Could not save start date')
    } finally { setSavingDate(false) }
  }

  async function saveArea() {
    if (!areaInput || isNaN(parseFloat(areaInput))) return
    setSavingArea(true)
    try {
      await api.put(`/farmer/subscriptions/${subscriptionId}/farm-area`, {
        farm_area_acres: parseFloat(areaInput),
        area_unit: 'acres',
      })
      setSub(s => s ? { ...s, farm_area_acres: parseFloat(areaInput), area_unit: 'acres' } : s)
      showToast('Farm area saved')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      const d = err.response?.data?.detail
      showToast(typeof d === 'string' ? d : (d as { message?: string } | undefined)?.message || 'Could not save')
    } finally { setSavingArea(false) }
  }

  async function savePlantContext() {
    // Tolerate partial save — backend accepts either field. We
    // refuse to send anything if BOTH are empty / invalid.
    const body: { number_of_plants?: number; planting_year?: number } = {}
    if (plantsInput) {
      const n = parseInt(plantsInput, 10)
      if (!Number.isNaN(n) && n > 0) body.number_of_plants = n
    }
    if (yearInput) {
      const y = parseInt(yearInput, 10)
      if (!Number.isNaN(y) && y >= 1900 && y <= 2100) body.planting_year = y
    }
    if (Object.keys(body).length === 0) return
    setSavingPlants(true)
    try {
      await api.put(`/farmer/subscriptions/${subscriptionId}/plant-count`, body)
      setSub(s => s ? {
        ...s,
        number_of_plants: body.number_of_plants ?? s.number_of_plants,
        planting_year: body.planting_year ?? s.planting_year,
      } : s)
      showToast('Saved')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string | { message?: string } } } }
      const d = err.response?.data?.detail
      showToast(typeof d === 'string' ? d : (d as { message?: string } | undefined)?.message || 'Could not save')
    } finally { setSavingPlants(false) }
  }

  function openOrderSheet(category: 'PESTICIDE' | 'FERTILISER') {
    setOrderSheet({ open: true, category })
    setOrderSuccess(null)
    setOrderSheetArea(sub?.farm_area_acres != null ? String(sub.farm_area_acres) : '')
    setOrderSheetEditingArea(!sub?.farm_area_acres)
  }

  function closeOrderSheet() {
    if (orderBusy) return
    setOrderSheet({ open: false, category: null })
    setOrderSuccess(null)
    setOrderSheetEditingArea(false)
  }

  async function placeBuyAllOrder() {
    if (!orderSheet.category || !sub) return
    // If acreage is not yet set OR farmer is editing, it must be valid
    const needsAreaInBody = !sub.farm_area_acres || orderSheetEditingArea
    if (needsAreaInBody) {
      if (!orderSheetArea || isNaN(parseFloat(orderSheetArea)) || parseFloat(orderSheetArea) <= 0) {
        showToast('Enter a valid farm area')
        return
      }
    }
    setOrderBusy(true)
    try {
      const body: Record<string, unknown> = { category: orderSheet.category }
      if (needsAreaInBody) {
        body.farm_area_acres = parseFloat(orderSheetArea)
        body.area_unit = 'acres'
      }
      const res = await api.post<{ order_id: string; item_count: number }>(
        `/farmer/subscriptions/${subscriptionId}/orders/buy-all-dbs`,
        body,
      )
      // Reflect soft-confirm in local sub
      setSub(s => s ? {
        ...s,
        farm_area_acres: needsAreaInBody ? parseFloat(orderSheetArea) : s.farm_area_acres,
        area_unit: needsAreaInBody ? 'acres' : s.area_unit,
      } : s)
      setOrderSuccess({ order_id: res.data.order_id, item_count: res.data.item_count })
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      showToast(err.response?.data?.detail || 'Could not create order')
    } finally { setOrderBusy(false) }
  }

  async function saveAlertPrefs() {
    setSavingAlerts(true)
    try {
      await api.post(`/farmer/subscriptions/${subscriptionId}/alert-preferences`, {
        extra_phone: alertPhoneInput.trim() || null,
        extra_name: alertNameInput.trim() || null,
      })
      const alertsRes = await api.get<AlertPrefs>(`/farmer/subscriptions/${subscriptionId}/alert-preferences`)
      setAlertPrefs(alertsRes.data)
      setAlertSheet(false)
      showToast('Alert preferences saved')
    } finally { setSavingAlerts(false) }
  }

  function openAlertSheet() {
    setAlertPhoneInput(alertPrefs?.extra_phone || '')
    setAlertNameInput(alertPrefs?.extra_name || '')
    setAlertSheet(true)
  }

  async function setExpert(punditId: string) {
    setSavingExpert(true)
    try {
      await api.post(`/farmer/subscriptions/${subscriptionId}/pundit-preference`, { pundit_id: punditId })
      const res = await api.get<ExpertSetting>(`/farmer/subscriptions/${subscriptionId}/expert-setting`)
      setExpertSetting(res.data)
      setExpertSheet(false)
      showToast('Expert preference saved')
    } finally { setSavingExpert(false) }
  }

  async function revertExpert() {
    setSavingExpert(true)
    try {
      await api.delete(`/farmer/subscriptions/${subscriptionId}/pundit-preference`)
      const res = await api.get<ExpertSetting>(`/farmer/subscriptions/${subscriptionId}/expert-setting`)
      setExpertSetting(res.data)
      showToast('Reverted to default')
    } finally { setSavingExpert(false) }
  }

  if (loading || !sub) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-green-700 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const colour = branding?.primary_colour || '#3A7D44'
  const hasStartDate = !!sub.crop_start_date

  // Pre-start visibility: only when today < start date or no start date set yet
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0)
  const startDateObj = sub.crop_start_date ? new Date(sub.crop_start_date) : null
  if (startDateObj) startDateObj.setHours(0, 0, 0, 0)
  const showPreStart = !startDateObj || todayMid < startDateObj

  // Pre-start practice categorisation
  const pestPractices = preStart.flatMap(tl =>
    tl.practices.filter(p => (p.l1_type || '').toLowerCase().includes('pest'))
  )
  const fertPractices = preStart.flatMap(tl =>
    tl.practices.filter(p => (p.l1_type || '').toLowerCase().includes('fert'))
  )

  // Acreage state — three-state policy (area-wise only)
  const areaHardLocked = !!sub.farm_area_confirmed_at
  const areaSoftSet = !areaHardLocked && sub.farm_area_acres != null
  const areaTentative = !areaHardLocked && sub.farm_area_acres == null

  // Plant-wise crop typing decides the input set the farmer sees.
  // Live read of Cosh's crop_area_plant_wise Connect; untyped crops
  // default to AREA_WISE so existing data renders unchanged.
  const isPlantWise = sub.crop_measure === 'PLANT_WISE'
  const plantsHardLocked = !!sub.plant_count_confirmed_at

  const isAssigned = sub.subscription_type === 'ASSIGNED'

  return (
    // overflow-x-hidden guards the whole page against horizontal
    // scroll. Some descendant (long font-mono reference number,
    // <input type=number> default min-width, or an alert
    // recipient line with no break opportunity) was nudging the
    // viewport wider than the device, leaving the user with a
    // visibly shifted layout.
    <div className="min-h-screen overflow-x-hidden bg-[#F5F0E8]">
      {/* Branded header — the page IS about this one crop, so the
          crop / package name is the most useful title. Brand
          identity already lives in the band colour. We don't wait
          on the branding fetch — the title comes from sub which
          has loaded by render time. */}
      <div className="sticky top-0 z-30 px-4 pt-safe" style={{ background: colour }}>
        <div className="flex items-center gap-3 py-3 min-w-0">
          <button onClick={() => router.push('/home')} className="text-white opacity-70 text-xl shrink-0">←</button>
          {branding?.logo_url ? (
            <img src={branding.logo_url} alt={branding.display_name}
              className="w-9 h-9 rounded-full object-contain p-0.5 shrink-0 bg-white/90" />
          ) : branding?.display_name ? (
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-white/90 text-[11px] font-bold"
              style={{ color: colour }}>
              {branding.display_name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
            </div>
          ) : null}
          <div className="flex-1 min-w-0 leading-tight">
            {branding?.display_name && (
              <p className="text-white text-[13px] font-semibold opacity-95 truncate">{branding.display_name}</p>
            )}
            <p className="text-white font-bold text-sm truncate">
              {cropDisplayName(sub.crop_cosh_id, sub.crop_name)}
            </p>
            {sub.package_name && sub.package_name.toLowerCase() !== cropDisplayName(sub.crop_cosh_id, sub.crop_name).toLowerCase() && (
              <p className="text-white text-[11px] opacity-70 truncate">{sub.package_name}</p>
            )}
          </div>
          {sub.reference_number && (
            <p className="text-white text-xs opacity-60 font-mono shrink-0">{sub.reference_number}</p>
          )}
        </div>
      </div>

      <div className="pb-28 px-4 pt-5 max-w-lg mx-auto">

        {/* Crop Age — surfaced from the backend's computed crop_age.
            AREA_WISE: days since start date. PLANT_WISE: years since
            planting year. `is_minimum=true` means the farmer picked
            "Beyond 1970"; render the value with a ">" prefix. */}
        {sub.crop_age && (
          <div className="bg-white border border-[#DDD0B8] rounded-2xl px-4 py-3 mb-4">
            <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest">Crop Age</p>
            <p className="font-semibold text-[#6B3F1F] mt-1">
              {sub.crop_age.is_minimum ? '> ' : ''}{sub.crop_age.value} {sub.crop_age.unit}
              <span className="text-xs text-[#7A8C7E] font-normal ml-2">
                {sub.crop_age.source === 'PLANTING_YEAR'
                  ? 'from planting year'
                  : 'from start date'}
              </span>
            </p>
          </div>
        )}

        {/* Area-wise crops → Farm Area card. Plant-wise crops → Number
            of Plants + Planting Year card pair. Crop typing comes from
            Cosh; untyped defaults to area-wise. */}
        {!isPlantWise ? (
          <>
            <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-3 mt-2 px-1">Farm Area</p>

            {areaTentative && (
              <div className="bg-white border border-[#DDD0B8] rounded-2xl p-4">
                <p className="text-sm font-semibold text-[#6B3F1F] mb-3">Farm area</p>
                <div className="flex gap-2">
                  <input
                    type="number" inputMode="decimal" step="0.01" min="0"
                    value={areaInput}
                    onChange={e => setAreaInput(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 min-w-0 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#3A7D44]"
                  />
                  <span className="flex items-center px-3 py-2 text-sm text-[#6B3F1F] bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl shrink-0">
                    acres
                  </span>
                  <button
                    onClick={saveArea}
                    disabled={savingArea || !areaInput}
                    className="px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                    style={{ background: colour }}
                  >
                    {savingArea ? '…' : 'Save'}
                  </button>
                </div>
                <p className="text-[#7A8C7E] text-xs mt-2">Tentative for now. Will be confirmed when you place your first order.</p>
              </div>
            )}

            {areaSoftSet && (
              <div className="bg-white border border-[#DDD0B8] rounded-2xl p-4">
                <p className="text-sm font-semibold text-[#6B3F1F] mb-3">Farm area · Tentative</p>
                <div className="flex gap-2">
                  <input
                    type="number" inputMode="decimal" step="0.01" min="0"
                    value={areaInput}
                    onChange={e => setAreaInput(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 min-w-0 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#3A7D44]"
                  />
                  <span className="flex items-center px-3 py-2 text-sm text-[#6B3F1F] bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl shrink-0">
                    acres
                  </span>
                  <button
                    onClick={saveArea}
                    disabled={savingArea || !areaInput}
                    className="px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                    style={{ background: colour }}
                  >
                    {savingArea ? '…' : 'Save'}
                  </button>
                </div>
                <p className="text-amber-700 bg-amber-50 px-3 py-2 rounded text-xs mt-3">
                  Currently set as your tentative area. You can revise it once more when you place your first DAS order at planting time.
                </p>
              </div>
            )}

            {areaHardLocked && (
              <div className="bg-white border border-[#DDD0B8] rounded-2xl px-4 py-3">
                <p className="text-sm font-semibold text-[#6B3F1F]">Farm area · Confirmed</p>
                <p className="font-semibold text-[#6B3F1F] mt-1">
                  {sub.farm_area_acres ?? '—'} acres
                </p>
                <p className="text-[#7A8C7E] text-xs mt-1">
                  Locked on {new Date(sub.farm_area_confirmed_at!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}. Volumes for all your inputs are calculated on this.
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-3 mt-2 px-1">Plant Count & Planting Year</p>
            {plantsHardLocked ? (
              <div className="bg-white border border-[#DDD0B8] rounded-2xl px-4 py-3">
                <p className="text-sm font-semibold text-[#6B3F1F]">Confirmed</p>
                <p className="font-semibold text-[#6B3F1F] mt-1">
                  {sub.number_of_plants ?? '—'} plants · planted{' '}
                  {sub.planting_year == null
                    ? '—'
                    : sub.planting_year < PLANTING_YEAR_FLOOR
                      ? `Beyond ${PLANTING_YEAR_FLOOR}`
                      : sub.planting_year}
                </p>
                <p className="text-[#7A8C7E] text-xs mt-1">
                  Locked on {new Date(sub.plant_count_confirmed_at!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}.
                </p>
              </div>
            ) : (
              <div className="bg-white border border-[#DDD0B8] rounded-2xl p-4 space-y-3">
                <div>
                  <label className="block text-sm font-semibold text-[#6B3F1F] mb-1.5">Number of Plants</label>
                  <input
                    type="number" inputMode="numeric" step="1" min="1"
                    value={plantsInput}
                    onChange={e => setPlantsInput(e.target.value)}
                    placeholder="e.g. 120"
                    className="w-full border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#3A7D44]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#6B3F1F] mb-1.5">Planting Year</label>
                  <select
                    value={yearInput}
                    onChange={e => setYearInput(e.target.value)}
                    className="w-full border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#3A7D44]"
                  >
                    <option value="">Select…</option>
                    {/* current year down to the floor; older than the
                        floor collapses to a single "Beyond" option
                        which stores the sentinel year. */}
                    {Array.from(
                      { length: new Date().getFullYear() - PLANTING_YEAR_FLOOR + 1 },
                      (_, i) => new Date().getFullYear() - i,
                    ).map(y => (
                      <option key={y} value={String(y)}>{y}</option>
                    ))}
                    <option value={String(PLANTING_YEAR_BEYOND_SENTINEL)}>
                      Beyond {PLANTING_YEAR_FLOOR}
                    </option>
                  </select>
                </div>
                <button
                  onClick={savePlantContext}
                  disabled={savingPlants || (!plantsInput && !yearInput)}
                  className="w-full py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                  style={{ background: colour }}
                >
                  {savingPlants ? 'Saving…' : 'Save'}
                </button>
                <p className="text-[#7A8C7E] text-xs">
                  Both are needed for the advisory to compute volumes correctly. Plant count locks when you place your first order.
                </p>
              </div>
            )}
          </>
        )}

        {/* Start date */}
        <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-3 mt-6 px-1">Start Date</p>
        {!hasStartDate ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <p className="font-bold text-amber-800">Set your start date</p>
            <p className="text-amber-600 text-xs mt-1">
              Advisory and Diagnosis unlock once you set the {isPlantWise ? 'season start date' : 'sowing date'}.
            </p>
            {showStartDate ? (
              <div className="mt-3 flex gap-2">
                <input type="date" value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="flex-1 border border-amber-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none" />
                <button onClick={saveStartDate} disabled={savingDate || !startDate}
                  className="px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                  style={{ background: colour }}>
                  {savingDate ? '…' : 'Set'}
                </button>
              </div>
            ) : (
              <button onClick={() => setShowStartDate(true)}
                className="mt-3 w-full py-2.5 rounded-xl text-white text-sm font-semibold"
                style={{ background: colour }}>
                Set Start Date
              </button>
            )}
          </div>
        ) : (() => {
          // 15-day edit window from first_set_at. Server enforces the
          // same rule (409 if expired). Legacy rows with no
          // first_set_at are grandfathered as still editable.
          const firstSet = sub.crop_start_date_first_set_at ? new Date(sub.crop_start_date_first_set_at) : null
          let daysLeft: number | null = null
          let lockedAt: Date | null = null
          if (firstSet) {
            const firstSetMid = new Date(firstSet); firstSetMid.setHours(0, 0, 0, 0)
            const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0)
            const elapsed = Math.floor((todayMid.getTime() - firstSetMid.getTime()) / 86400000)
            daysLeft = 15 - elapsed
            lockedAt = new Date(firstSetMid.getTime() + 16 * 86400000)
          }
          const editable = daysLeft === null || daysLeft >= 0
          return (
            <>
              <div className="bg-white rounded-2xl border border-[#DDD0B8] px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-[#7A8C7E]">Start date</p>
                  <p className="font-semibold text-[#6B3F1F]">{new Date(sub.crop_start_date!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                  {editable && daysLeft !== null && (
                    <p className="text-[#7A8C7E] text-xs mt-1">
                      You can change this for {daysLeft === 0 ? 'one more day' : `${daysLeft} more day${daysLeft === 1 ? '' : 's'}`}.
                    </p>
                  )}
                  {!editable && lockedAt && (
                    <p className="text-[#7A8C7E] text-xs mt-1">
                      Locked on {lockedAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}.
                    </p>
                  )}
                </div>
                {editable && (
                  <button onClick={() => setShowStartDate(!showStartDate)}
                    className="text-xs text-[#7A8C7E] underline shrink-0">change</button>
                )}
              </div>
              {editable && showStartDate && (
                <div className="mt-3 bg-white rounded-2xl border border-[#DDD0B8] p-4 flex gap-2">
                  <input type="date" value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="flex-1 min-w-0 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none" />
                  <button onClick={saveStartDate} disabled={savingDate || !startDate}
                    className="px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                    style={{ background: colour }}>
                    {savingDate ? '…' : 'Update'}
                  </button>
                </div>
              )}
            </>
          )
        })()}

        {/* Three action tiles */}
        <div className="grid grid-cols-3 gap-3 mt-6">
          <button
            onClick={() => hasStartDate ? router.push(`/advisory/${subscriptionId}`) : setShowNeedDateSheet('advisory')}
            className={`rounded-2xl p-4 text-center border shadow-sm transition-all ${hasStartDate ? 'bg-white border-[#DDD0B8] active:scale-95' : 'bg-stone-100 border-[#DDD0B8] opacity-60'}`}>
            <span className="text-3xl block mb-2">🌿</span>
            <p className="text-xs font-bold text-[#6B3F1F]">Advisory</p>
            {!hasStartDate && <p className="text-xs text-amber-600 mt-0.5">Set date first</p>}
          </button>

          <button
            onClick={() => {
              if (!hasStartDate) { setShowNeedDateSheet('diagnose'); return }
              if (diagnosisEligibility && !diagnosisEligibility.eligible) {
                setToast(diagnosisEligibility.message || 'Diagnosis is not available for this crop right now.')
                return
              }
              router.push(`/advisory/${subscriptionId}/diagnose`)
            }}
            className={`rounded-2xl p-4 text-center border shadow-sm transition-all ${
              hasStartDate && (!diagnosisEligibility || diagnosisEligibility.eligible)
                ? 'bg-white border-[#DDD0B8] active:scale-95'
                : 'bg-stone-100 border-[#DDD0B8] opacity-60'
            }`}>
            <span className="text-3xl block mb-2">🔬</span>
            <p className="text-xs font-bold text-[#6B3F1F]">Diagnose</p>
            {!hasStartDate && <p className="text-xs text-amber-600 mt-0.5">Set date first</p>}
            {hasStartDate && diagnosisEligibility && !diagnosisEligibility.eligible && (
              <p className="text-xs text-[#7A8C7E] mt-0.5">Not available</p>
            )}
          </button>

          <button
            onClick={() => router.push(`/ask-expert/${subscriptionId}`)}
            className="bg-white rounded-2xl p-4 text-center border border-[#DDD0B8] shadow-sm active:scale-95">
            <span className="text-3xl block mb-2">🎓</span>
            <p className="text-xs font-bold text-[#6B3F1F]">Ask Expert</p>
          </button>
        </div>

        {/* Missed items link */}
        {missedCount > 0 && (
          <button onClick={() => router.push(`/missed-items/${subscriptionId}`)}
            className="mt-4 w-full bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <p className="text-sm text-amber-700 font-medium">
              {missedCount} missed item{missedCount > 1 ? 's' : ''} — application window passed
            </p>
            <span className="text-amber-500 text-sm">View →</span>
          </button>
        )}

        {/* Pre-Start section */}
        {showPreStart && (seedAvail.has_varieties || pestPractices.length > 0 || fertPractices.length > 0) && (
          <>
            <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-3 mt-6 px-1">Prepare for Sowing</p>

            {seedAvail.has_varieties && (
              <button
                onClick={() => router.push(`/subscribe/seed-varieties/${subscriptionId}`)}
                className="w-full bg-white rounded-2xl border border-[#DDD0B8] px-4 py-4 flex items-center justify-between active:scale-98 transition-transform mb-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🌾</span>
                  <div className="text-left">
                    <p className="font-semibold text-[#6B3F1F] text-sm">Seeds &amp; Seedlings</p>
                    <p className="text-xs text-[#7A8C7E]">Browse and order recommended varieties</p>
                  </div>
                </div>
                <span className="text-[#DDD0B8] text-xl">›</span>
              </button>
            )}

            {pestPractices.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4 mb-3">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">🧪</span>
                  <div>
                    <p className="font-semibold text-[#6B3F1F] text-sm">Pre-Start Pesticides</p>
                    <p className="text-xs text-[#7A8C7E]">{pestPractices.length} item{pestPractices.length > 1 ? 's' : ''} recommended before sowing</p>
                  </div>
                </div>
                <button
                  onClick={() => openOrderSheet('PESTICIDE')}
                  className="w-full py-2.5 rounded-xl text-white text-sm font-semibold"
                  style={{ background: colour }}
                >
                  Order all pesticides →
                </button>
              </div>
            )}

            {fertPractices.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4 mb-3">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">🌱</span>
                  <div>
                    <p className="font-semibold text-[#6B3F1F] text-sm">Pre-Start Fertilisers</p>
                    <p className="text-xs text-[#7A8C7E]">{fertPractices.length} item{fertPractices.length > 1 ? 's' : ''} recommended before sowing</p>
                  </div>
                </div>
                <button
                  onClick={() => openOrderSheet('FERTILISER')}
                  className="w-full py-2.5 rounded-xl text-white text-sm font-semibold"
                  style={{ background: colour }}
                >
                  Order all fertilisers →
                </button>
              </div>
            )}
          </>
        )}

        {/* Alerts — farmer is always notified via push; this card
            captures one optional extra recipient (dealer / facilitator
            / anyone). ASSIGNED subs prefill from the promoter; SELF
            subs start blank. Either way the farmer can edit. */}
        <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-3 mt-6 px-1">Alerts</p>
        <div className="bg-white border border-[#DDD0B8] rounded-2xl p-4">
          <p className="text-sm text-[#6B3F1F]">
            <span className="font-semibold">You</span> will always receive alerts in this app.
          </p>
          {alertPrefs && alertPrefs.extra_phone && (
            <p className="text-sm text-[#6B3F1F] mt-2">
              Also sent to: <span className="font-semibold">{alertPrefs.extra_name || 'Extra contact'}</span>
              <span className="text-[#7A8C7E]"> ({alertPrefs.extra_phone})</span>
              {alertPrefs.source === 'auto_promoter' && (
                <span className="text-[#7A8C7E] text-xs ml-1">— from your promoter</span>
              )}
            </p>
          )}
          {alertPrefs && !alertPrefs.extra_phone && (
            <p className="text-sm text-[#7A8C7E] mt-2 italic">No extra recipient set.</p>
          )}
          <button
            onClick={openAlertSheet}
            className="w-full mt-3 py-2 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium"
          >
            {alertPrefs?.extra_phone ? 'Change extra recipient' : 'Add a dealer or facilitator'}
          </button>
        </div>

        {/* Ask Expert preference */}
        <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-3 mt-6 px-1">Ask Expert</p>
        <div className="bg-white border border-[#DDD0B8] rounded-2xl p-4">
          {!expertSetting ? (
            <p className="text-sm text-[#7A8C7E] italic">Loading…</p>
          ) : expertSetting.mode === 'SPECIFIC' && expertSetting.preferred_pundit ? (
            <>
              <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-1">Currently</p>
              <p className="text-sm font-semibold text-[#6B3F1F]">
                {expertSetting.preferred_pundit.name || 'Selected Expert'}
                {expertSetting.preferred_pundit.phone && (
                  <span className="text-[#7A8C7E] font-normal ml-2">({expertSetting.preferred_pundit.phone})</span>
                )}
              </p>
              <p className="text-xs text-[#7A8C7E] mt-1">Your queries go directly to this expert.</p>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <button
                  onClick={() => setExpertSheet(true)}
                  className="py-2 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium"
                >Change</button>
                <button
                  onClick={revertExpert}
                  disabled={savingExpert}
                  className="py-2 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium disabled:opacity-40"
                >Revert to default</button>
              </div>
            </>
          ) : expertSetting.mode === 'PROMOTER_PUNDIT' && expertSetting.promoter_pundit ? (
            <>
              <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-1">Currently</p>
              <p className="text-sm font-semibold text-[#6B3F1F]">
                {expertSetting.promoter_pundit.name || 'Promoter-Expert'}
                {expertSetting.promoter_pundit.phone && (
                  <span className="text-[#7A8C7E] font-normal ml-2">({expertSetting.promoter_pundit.phone})</span>
                )}
              </p>
              <p className="text-xs text-[#7A8C7E] mt-1">
                Your Promoter is also an Expert. Queries go to them by default.
              </p>
              <button
                onClick={() => setExpertSheet(true)}
                className="mt-3 w-full py-2 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium"
              >Choose a different expert</button>
            </>
          ) : (
            <>
              <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-1">Currently</p>
              <p className="text-sm font-semibold text-[#6B3F1F]">Regular team routing</p>
              <p className="text-xs text-[#7A8C7E] mt-1">
                {expertSetting.company_experts.length > 0
                  ? "Queries go to your company's regular Expert team."
                  : "Your company has no specific experts available yet. Queries will go to the regular team."}
              </p>
              {expertSetting.company_experts.length > 0 && (
                <button
                  onClick={() => setExpertSheet(true)}
                  className="mt-3 w-full py-2 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium"
                >Choose a specific expert</button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Order bottom sheet */}
      {orderSheet.open && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-end" onClick={closeOrderSheet}>
          <div className="bg-white w-full rounded-t-3xl p-5 max-w-lg mx-auto" onClick={e => e.stopPropagation()}>
            {orderSuccess ? (
              <>
                <p className="font-bold text-[#6B3F1F] text-base">Order created</p>
                <p className="text-sm text-[#6B3F1F] mt-2">
                  {orderSuccess.item_count} item{orderSuccess.item_count !== 1 ? 's' : ''} added to a single order. You can pick a dealer on the order screen.
                </p>
                <div className="grid grid-cols-2 gap-3 mt-5">
                  <button
                    onClick={closeOrderSheet}
                    className="py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-semibold"
                  >Close</button>
                  <button
                    onClick={() => router.push(`/orders/${orderSuccess.order_id}`)}
                    className="py-3 rounded-xl text-white text-sm font-semibold"
                    style={{ background: colour }}
                  >Take me to order</button>
                </div>
              </>
            ) : (
              <>
                {/* State A: tentative (no acreage set) — entry first */}
                {!sub.farm_area_acres && !sub.farm_area_confirmed_at && (
                  <>
                    <p className="font-bold text-[#6B3F1F] text-base">Confirm your tentative area</p>
                    <p className="text-xs text-[#7A8C7E] mt-1">
                      Volumes for these inputs are calculated on this. You can revise it once more at planting.
                    </p>
                    <div className="flex gap-2 mt-4">
                      <input
                        type="number" inputMode="decimal" step="0.01" min="0"
                        value={orderSheetArea}
                        onChange={e => setOrderSheetArea(e.target.value)}
                        placeholder="0.00"
                        className="flex-1 min-w-0 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#3A7D44]"
                      />
                      <span className="flex items-center px-3 py-2 text-sm text-[#6B3F1F] bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl shrink-0">
                        acres
                      </span>
                    </div>
                  </>
                )}

                {/* State B: soft set (tentative value exists, not yet locked) */}
                {sub.farm_area_acres != null && !sub.farm_area_confirmed_at && (
                  <>
                    <p className="font-bold text-[#6B3F1F] text-base">
                      Order DBS {orderSheet.category === 'PESTICIDE' ? 'pesticides' : 'fertilisers'}
                    </p>
                    {orderSheetEditingArea ? (
                      <>
                        <p className="text-xs text-[#7A8C7E] mt-2">Update tentative area:</p>
                        <div className="flex gap-2 mt-2">
                          <input
                            type="number" inputMode="decimal" step="0.01" min="0"
                            value={orderSheetArea}
                            onChange={e => setOrderSheetArea(e.target.value)}
                            placeholder="0.00"
                            className="flex-1 min-w-0 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#3A7D44]"
                          />
                          <span className="flex items-center px-3 py-2 text-sm text-[#6B3F1F] bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl shrink-0">
                            acres
                          </span>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-[#6B3F1F] mt-3">
                        Current tentative area: <span className="font-semibold">{sub.farm_area_acres} acres</span>{' '}
                        <button
                          onClick={() => setOrderSheetEditingArea(true)}
                          className="ml-1 text-xs underline"
                          style={{ color: colour }}
                        >Change</button>
                      </p>
                    )}
                    <p className="text-amber-700 bg-amber-50 px-3 py-2 rounded text-xs mt-3">
                      We'll use this for volume. You can revise once more at planting.
                    </p>
                  </>
                )}

                {/* State C: hard locked */}
                {sub.farm_area_confirmed_at && (
                  <>
                    <p className="font-bold text-[#6B3F1F] text-base">
                      Order DBS {orderSheet.category === 'PESTICIDE' ? 'pesticides' : 'fertilisers'}
                    </p>
                    <p className="text-sm text-[#6B3F1F] mt-3">
                      Area: <span className="font-semibold">{sub.farm_area_acres} acres</span>{' '}
                      <span className="text-xs text-[#7A8C7E]">(locked)</span>
                    </p>
                    <p className="text-[#7A8C7E] text-xs mt-2">
                      Locked at planting. Volumes are calculated on this.
                    </p>
                  </>
                )}

                <div className="grid grid-cols-2 gap-3 mt-5">
                  <button
                    onClick={closeOrderSheet}
                    disabled={orderBusy}
                    className="py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-semibold disabled:opacity-40"
                  >Cancel</button>
                  <button
                    onClick={placeBuyAllOrder}
                    disabled={orderBusy}
                    className="py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                    style={{ background: colour }}
                  >
                    {orderBusy ? '…' : (sub.farm_area_confirmed_at ? 'Place order' : 'Confirm and order')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Alerts bottom sheet — single extra-recipient editor.
          Farmer always gets alerts; this captures one phone. Empty
          phone == clear. ASSIGNED case shows a hint that the promoter
          will auto-prefill on next reload if cleared. */}
      {alertSheet && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-end" onClick={() => !savingAlerts && setAlertSheet(false)}>
          <div className="bg-white w-full rounded-t-3xl p-5 max-w-lg mx-auto" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F] text-base">Extra alert recipient</p>
            <p className="text-xs text-[#7A8C7E] mt-1">
              Enter a dealer or facilitator who should also receive alerts about this crop. You can edit this any time.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <p className="text-xs text-[#7A8C7E] mb-1">Phone number</p>
                <input
                  type="tel" inputMode="tel"
                  value={alertPhoneInput}
                  onChange={e => setAlertPhoneInput(e.target.value)}
                  placeholder="+91 XXXXX XXXXX"
                  className="w-full border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#3A7D44]"
                />
                {/* Verify chip — auto-fills the name field with the
                    looked-up name so the farmer can see who they're
                    about to add before tapping Save. */}
                <PhoneVerify
                  phone={alertPhoneInput}
                  onResolve={r => {
                    if (r?.found && r.name && !alertNameInput.trim()) {
                      setAlertNameInput(r.name)
                    }
                  }}
                />
              </div>
              <div>
                <p className="text-xs text-[#7A8C7E] mb-1">Name (optional)</p>
                <input
                  type="text"
                  value={alertNameInput}
                  onChange={e => setAlertNameInput(e.target.value)}
                  placeholder="Dealer / facilitator name"
                  className="w-full border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#3A7D44]"
                />
              </div>
              {isAssigned && (
                <p className="text-xs text-[#7A8C7E]">
                  Tip: leave blank to fall back to your promoter's number automatically.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-5">
              <button
                onClick={() => setAlertSheet(false)}
                disabled={savingAlerts}
                className="py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-semibold disabled:opacity-40"
              >Cancel</button>
              <button
                onClick={saveAlertPrefs}
                disabled={savingAlerts}
                className="py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                style={{ background: colour }}
              >{savingAlerts ? '…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Expert picker bottom sheet */}
      {expertSheet && expertSetting && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-end" onClick={() => !savingExpert && setExpertSheet(false)}>
          <div className="bg-white w-full rounded-t-3xl p-5 max-w-lg mx-auto max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F] text-base">Choose your expert</p>
            <p className="text-xs text-[#7A8C7E] mt-1">Your queries will be routed to this expert directly.</p>
            <div className="mt-4 space-y-2">
              {expertSetting.company_experts.length === 0 ? (
                <p className="text-sm text-[#7A8C7E] italic py-4 text-center">No specific experts available.</p>
              ) : (
                expertSetting.company_experts.map(exp => {
                  const isCurrent = expertSetting.preferred_pundit?.pundit_id === exp.pundit_id
                  return (
                    <button
                      key={exp.pundit_id}
                      onClick={() => setExpert(exp.pundit_id)}
                      disabled={savingExpert}
                      className={`w-full text-left rounded-xl px-4 py-3 border ${isCurrent ? 'border-[#6B3F1F] bg-[#F5F0E8]' : 'border-[#DDD0B8]'} disabled:opacity-40`}
                    >
                      <p className="text-sm font-semibold text-[#6B3F1F]">{exp.name || 'Expert'}</p>
                      <p className="text-xs text-[#7A8C7E]">
                        {exp.role}{exp.phone ? ` · ${exp.phone}` : ''}
                      </p>
                      {isCurrent && <p className="text-xs mt-1" style={{ color: colour }}>Current selection</p>}
                    </button>
                  )
                })
              )}
            </div>
            <button
              onClick={() => setExpertSheet(false)}
              disabled={savingExpert}
              className="mt-4 w-full py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-semibold disabled:opacity-40"
            >Close</button>
          </div>
        </div>
      )}

      {/* Need start date — friendly bottom sheet */}
      {showNeedDateSheet && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setShowNeedDateSheet(null)}>
          <div className="bg-white rounded-t-2xl w-full pb-8 px-6 pt-6 max-w-lg mx-auto" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto -mt-3 mb-5" />
            <div className="flex items-center justify-center w-12 h-12 rounded-2xl mb-4 mx-auto" style={{ background: colour + '20' }}>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" style={{ color: colour }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/>
              </svg>
            </div>
            <h3 className="text-[#6B3F1F] font-semibold text-lg text-center">
              {showNeedDateSheet === 'advisory' ? 'Set your start date' : 'Set your start date'}
            </h3>
            <p className="text-[#7A8C7E] text-sm text-center mt-2 leading-relaxed">
              {showNeedDateSheet === 'advisory'
                ? 'Once you set when you sowed or transplanted, we will show you today\'s recommended practices.'
                : 'We need to know when you sowed to help you diagnose any crop issues.'}
            </p>
            <button
              onClick={() => { setShowNeedDateSheet(null); setShowStartDate(true) }}
              className="w-full mt-6 py-3.5 rounded-xl text-white font-semibold text-sm"
              style={{ background: colour }}>
              Set start date now
            </button>
            <button
              onClick={() => setShowNeedDateSheet(null)}
              className="w-full mt-2 py-2 text-[#7A8C7E] text-sm">
              Maybe later
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-stone-800 text-white text-sm px-4 py-2.5 rounded-full shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
