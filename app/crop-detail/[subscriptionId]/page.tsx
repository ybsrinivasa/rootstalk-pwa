'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
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
  // True iff the client has at least one ACTIVE PRIMARY pundit. Drives
  // the Ask Expert button + Diagnose-IDK gateway "Ask Expert" path.
  client_has_primary_expert: boolean
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
  source: 'override' | 'auto_promoter' | 'disabled' | 'none'
  disabled: boolean
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
  const t = useTranslations('crop')
  const tCommon = useTranslations('common')
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
  const [alertDisabled, setAlertDisabled] = useState(false)
  const [alertError, setAlertError] = useState<string | null>(null)
  const [savingAlerts, setSavingAlerts] = useState(false)

  const [expertSheet, setExpertSheet] = useState(false)
  const [expertPhoneInput, setExpertPhoneInput] = useState('')
  const [expertError, setExpertError] = useState<string | null>(null)
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
      showToast(t('toast.dateRequired'))
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
      showToast(err.response?.data?.detail || t('toast.startDateSaveFailed'))
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
      showToast(t('toast.areaSaved'))
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      const d = err.response?.data?.detail
      showToast(typeof d === 'string' ? d : (d as { message?: string } | undefined)?.message || t('toast.saveFailed'))
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
      showToast(t('toast.saved'))
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string | { message?: string } } } }
      const d = err.response?.data?.detail
      showToast(typeof d === 'string' ? d : (d as { message?: string } | undefined)?.message || t('toast.saveFailed'))
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
        showToast(t('toast.invalidArea'))
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
      showToast(err.response?.data?.detail || t('toast.orderFailed'))
    } finally { setOrderBusy(false) }
  }

  async function saveAlertPrefs() {
    setSavingAlerts(true)
    setAlertError(null)
    try {
      const body: { extra_phone?: string | null; disabled?: boolean } =
        alertDisabled
          ? { disabled: true }
          : { extra_phone: alertPhoneInput.trim() || null }
      await api.post(`/farmer/subscriptions/${subscriptionId}/alert-preferences`, body)
      const alertsRes = await api.get<AlertPrefs>(`/farmer/subscriptions/${subscriptionId}/alert-preferences`)
      setAlertPrefs(alertsRes.data)
      setAlertSheet(false)
      showToast(t('toast.alertsSaved'))
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: { code?: string; message?: string } | string } } }
      const detail = err?.response?.data?.detail
      const code = typeof detail === 'object' ? detail?.code : null
      const msg = typeof detail === 'string'
        ? detail
        : detail?.message ||
          (code === 'user_not_found'
            ? t('toast.userNotFoundForAlert')
            : code === 'not_a_dealer_or_facilitator'
              ? t('toast.notDealerOrFacilitator')
              : t('toast.alertsSaveFailed'))
      setAlertError(msg)
    } finally { setSavingAlerts(false) }
  }

  function openAlertSheet() {
    setAlertPhoneInput(alertPrefs?.extra_phone || '')
    setAlertNameInput(alertPrefs?.extra_name || '')
    setAlertDisabled(alertPrefs?.disabled ?? false)
    setAlertError(null)
    setAlertSheet(true)
  }

  async function setExpertByPhone(phone: string) {
    setSavingExpert(true)
    setExpertError(null)
    try {
      await api.post(`/farmer/subscriptions/${subscriptionId}/pundit-preference`, { phone })
      const res = await api.get<ExpertSetting>(`/farmer/subscriptions/${subscriptionId}/expert-setting`)
      setExpertSetting(res.data)
      setExpertSheet(false)
      showToast(t('toast.expertSaved'))
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: { code?: string; message?: string } | string } } }
      const detail = err?.response?.data?.detail
      const code = typeof detail === 'object' ? detail?.code : null
      const msg = typeof detail === 'string'
        ? detail
        : detail?.message ||
          (code === 'user_not_found'
            ? t('toast.userNotFoundForExpert')
            : code === 'not_a_promoter_pundit'
              ? t('toast.notPromoterPundit')
              : t('toast.expertSaveFailed'))
      setExpertError(msg)
    } finally { setSavingExpert(false) }
  }

  async function revertExpert() {
    setSavingExpert(true)
    try {
      await api.delete(`/farmer/subscriptions/${subscriptionId}/pundit-preference`)
      const res = await api.get<ExpertSetting>(`/farmer/subscriptions/${subscriptionId}/expert-setting`)
      setExpertSetting(res.data)
      showToast(t('toast.revertedToDefault'))
    } finally { setSavingExpert(false) }
  }

  function openExpertSheet() {
    // Pre-fill with whichever phone is currently effective — the
    // farmer's saved override, or the auto-promoter-pundit fall-back.
    // If neither, leave empty so the placeholder shows.
    setExpertPhoneInput(
      expertSetting?.preferred_pundit?.phone ||
      expertSetting?.promoter_pundit?.phone ||
      ''
    )
    setExpertError(null)
    setExpertSheet(true)
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
            <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest">{t('age.label')}</p>
            <p className="font-semibold text-[#6B3F1F] mt-1">
              {sub.crop_age.is_minimum ? '> ' : ''}{sub.crop_age.value} {sub.crop_age.unit}
              <span className="text-xs text-[#7A8C7E] font-normal ml-2">
                {sub.crop_age.source === 'PLANTING_YEAR'
                  ? t('age.fromPlantingYear')
                  : t('age.fromStartDate')}
              </span>
            </p>
          </div>
        )}

        {/* Area-wise crops → Farm Area card. Plant-wise crops → Number
            of Plants + Planting Year card pair. Crop typing comes from
            Cosh; untyped defaults to area-wise. */}
        {!isPlantWise ? (
          <>
            <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-3 mt-2 px-1">{t('area.sectionHeader')}</p>

            {areaTentative && (
              <div className="bg-white border border-[#DDD0B8] rounded-2xl p-4">
                <p className="text-sm font-semibold text-[#6B3F1F] mb-3">{t('area.label')}</p>
                <div className="flex gap-2">
                  <input
                    type="number" inputMode="decimal" step="0.01" min="0"
                    value={areaInput}
                    onChange={e => setAreaInput(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 min-w-0 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#3A7D44]"
                  />
                  <span className="flex items-center px-3 py-2 text-sm text-[#6B3F1F] bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl shrink-0">
                    {t('area.unitAcres')}
                  </span>
                  <button
                    onClick={saveArea}
                    disabled={savingArea || !areaInput}
                    className="px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                    style={{ background: colour }}
                  >
                    {savingArea ? '…' : tCommon('save')}
                  </button>
                </div>
                <p className="text-[#7A8C7E] text-xs mt-2">{t('area.tentativeNote')}</p>
              </div>
            )}

            {areaSoftSet && (
              <div className="bg-white border border-[#DDD0B8] rounded-2xl p-4">
                <p className="text-sm font-semibold text-[#6B3F1F] mb-3">{t('area.softSetLabel')}</p>
                <div className="flex gap-2">
                  <input
                    type="number" inputMode="decimal" step="0.01" min="0"
                    value={areaInput}
                    onChange={e => setAreaInput(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 min-w-0 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#3A7D44]"
                  />
                  <span className="flex items-center px-3 py-2 text-sm text-[#6B3F1F] bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl shrink-0">
                    {t('area.unitAcres')}
                  </span>
                  <button
                    onClick={saveArea}
                    disabled={savingArea || !areaInput}
                    className="px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                    style={{ background: colour }}
                  >
                    {savingArea ? '…' : tCommon('save')}
                  </button>
                </div>
                <p className="text-amber-700 bg-amber-50 px-3 py-2 rounded text-xs mt-3">
                  {t('area.softSetNote')}
                </p>
              </div>
            )}

            {areaHardLocked && (
              <div className="bg-white border border-[#DDD0B8] rounded-2xl px-4 py-3">
                <p className="text-sm font-semibold text-[#6B3F1F]">{t('area.confirmedLabel')}</p>
                <p className="font-semibold text-[#6B3F1F] mt-1">
                  {sub.farm_area_acres ?? '—'} {t('area.unitAcres')}
                </p>
                <p className="text-[#7A8C7E] text-xs mt-1">
                  {t('area.lockedNote', { date: new Date(sub.farm_area_confirmed_at!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) })}
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-3 mt-2 px-1">{t('plants.sectionHeader')}</p>
            {plantsHardLocked ? (
              <div className="bg-white border border-[#DDD0B8] rounded-2xl px-4 py-3">
                <p className="text-sm font-semibold text-[#6B3F1F]">{t('plants.confirmed')}</p>
                <p className="font-semibold text-[#6B3F1F] mt-1">
                  {sub.number_of_plants ?? '—'} {t('plants.plantedPrefix')}{' '}
                  {sub.planting_year == null
                    ? '—'
                    : sub.planting_year < PLANTING_YEAR_FLOOR
                      ? t('plants.beyondYear', { year: PLANTING_YEAR_FLOOR })
                      : sub.planting_year}
                </p>
                <p className="text-[#7A8C7E] text-xs mt-1">
                  {t('plants.lockedNote', { date: new Date(sub.plant_count_confirmed_at!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) })}
                </p>
              </div>
            ) : (
              <div className="bg-white border border-[#DDD0B8] rounded-2xl p-4 space-y-3">
                <div>
                  <label className="block text-sm font-semibold text-[#6B3F1F] mb-1.5">{t('plants.plantsLabel')}</label>
                  <input
                    type="number" inputMode="numeric" step="1" min="1"
                    value={plantsInput}
                    onChange={e => setPlantsInput(e.target.value)}
                    placeholder={t('plants.plantsPlaceholder')}
                    className="w-full border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#3A7D44]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#6B3F1F] mb-1.5">{t('plants.yearLabel')}</label>
                  <select
                    value={yearInput}
                    onChange={e => setYearInput(e.target.value)}
                    className="w-full border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#3A7D44]"
                  >
                    <option value="">{t('plants.selectYearPlaceholder')}</option>
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
                      {t('plants.beyondYear', { year: PLANTING_YEAR_FLOOR })}
                    </option>
                  </select>
                </div>
                <button
                  onClick={savePlantContext}
                  disabled={savingPlants || (!plantsInput && !yearInput)}
                  className="w-full py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                  style={{ background: colour }}
                >
                  {savingPlants ? tCommon('saving') : tCommon('save')}
                </button>
                <p className="text-[#7A8C7E] text-xs">
                  {t('plants.helpText')}
                </p>
              </div>
            )}
          </>
        )}

        {/* Start date */}
        <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-3 mt-6 px-1">{t('startDate.sectionHeader')}</p>
        {!hasStartDate ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <p className="font-bold text-amber-800">{t('startDate.title')}</p>
            <p className="text-amber-600 text-xs mt-1">
              {isPlantWise ? t('startDate.unlockPlantWise') : t('startDate.unlockAreaWise')}
            </p>
            {showStartDate ? (
              <div className="mt-3 flex gap-2">
                <input type="date" value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="flex-1 border border-amber-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none" />
                <button onClick={saveStartDate} disabled={savingDate || !startDate}
                  className="px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                  style={{ background: colour }}>
                  {savingDate ? '…' : t('startDate.setShort')}
                </button>
              </div>
            ) : (
              <button onClick={() => setShowStartDate(true)}
                className="mt-3 w-full py-2.5 rounded-xl text-white text-sm font-semibold"
                style={{ background: colour }}>
                {t('startDate.setCta')}
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
                  <p className="text-xs text-[#7A8C7E]">{t('startDate.label')}</p>
                  <p className="font-semibold text-[#6B3F1F]">{new Date(sub.crop_start_date!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                  {editable && daysLeft !== null && (
                    <p className="text-[#7A8C7E] text-xs mt-1">
                      {t('startDate.editWindow', { days: daysLeft })}
                    </p>
                  )}
                  {!editable && lockedAt && (
                    <p className="text-[#7A8C7E] text-xs mt-1">
                      {t('startDate.lockedNote', { date: lockedAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) })}
                    </p>
                  )}
                </div>
                {editable && (
                  <button onClick={() => setShowStartDate(!showStartDate)}
                    className="text-xs text-[#7A8C7E] underline shrink-0">{t('startDate.changeBtn')}</button>
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
                    {savingDate ? '…' : t('startDate.updateCta')}
                  </button>
                </div>
              )}
            </>
          )
        })()}

        {/* Four action tiles (2026-06-02): Orders joins as a sibling
            to Advisory / Diagnose / Ask Expert. Advisory is "what to
            do", Orders is "what to procure" — different mental
            contexts; keeping them separate makes the hub readable. */}
        <div className="grid grid-cols-2 gap-3 mt-6">
          <button
            onClick={() => hasStartDate ? router.push(`/advisory/${subscriptionId}`) : setShowNeedDateSheet('advisory')}
            className={`rounded-2xl p-4 text-center border shadow-sm transition-all ${hasStartDate ? 'bg-white border-[#DDD0B8] active:scale-95' : 'bg-stone-100 border-[#DDD0B8] opacity-60'}`}>
            <span className="text-3xl block mb-2">🌿</span>
            <p className="text-xs font-bold text-[#6B3F1F]">{t('tiles.advisoryTitle')}</p>
            {!hasStartDate && <p className="text-xs text-amber-600 mt-0.5">{t('tiles.setDateFirst')}</p>}
          </button>

          <button
            onClick={() => {
              if (!hasStartDate) { setShowNeedDateSheet('diagnose'); return }
              if (diagnosisEligibility && !diagnosisEligibility.eligible) {
                setToast(diagnosisEligibility.message || t('toast.diagnoseUnavailable'))
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
            <p className="text-xs font-bold text-[#6B3F1F]">{t('tiles.diagnoseTitle')}</p>
            {!hasStartDate && <p className="text-xs text-amber-600 mt-0.5">{t('tiles.setDateFirst')}</p>}
            {hasStartDate && diagnosisEligibility && !diagnosisEligibility.eligible && (
              <p className="text-xs text-[#7A8C7E] mt-0.5">{t('tiles.notAvailable')}</p>
            )}
          </button>

          <button
            onClick={() => {
              if (!sub.client_has_primary_expert) {
                showToast(t('toast.noPrimaryExpert'))
                return
              }
              router.push(`/ask-expert/${subscriptionId}`)
            }}
            disabled={!sub.client_has_primary_expert}
            className="bg-white rounded-2xl p-4 text-center border border-[#DDD0B8] shadow-sm active:scale-95 disabled:opacity-50 disabled:active:scale-100">
            <span className="text-3xl block mb-2">🎓</span>
            <p className="text-xs font-bold text-[#6B3F1F]">{t('tiles.askExpertTitle')}</p>
            {!sub.client_has_primary_expert && (
              <p className="text-xs text-[#7A8C7E] mt-0.5">{t('tiles.noExpertYet')}</p>
            )}
          </button>

          {/* Orders — entry to the three-tab Orders page. Always
              enabled (the farmer can browse the Order tab to see
              what they could buy even before setting a start date,
              though specific accordions may gate themselves). */}
          <button
            onClick={() => router.push(`/crop-detail/${subscriptionId}/orders`)}
            className="bg-white rounded-2xl p-4 text-center border border-[#DDD0B8] shadow-sm active:scale-95">
            <span className="text-3xl block mb-2">📦</span>
            <p className="text-xs font-bold text-[#6B3F1F]">{t('tiles.ordersTitle')}</p>
          </button>
        </div>

        {/* Missed items link */}
        {missedCount > 0 && (
          <button onClick={() => router.push(`/missed-items/${subscriptionId}`)}
            className="mt-4 w-full bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <p className="text-sm text-amber-700 font-medium">
              {t('missedItems.label', { count: missedCount })}
            </p>
            <span className="text-amber-500 text-sm">{t('missedItems.cta')}</span>
          </button>
        )}

        {/* Pre-Start section */}
        {showPreStart && (seedAvail.has_varieties || pestPractices.length > 0 || fertPractices.length > 0) && (
          <>
            <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-3 mt-6 px-1">{t('preStart.sectionHeader')}</p>

            {seedAvail.has_varieties && (
              <button
                onClick={() => router.push(`/subscribe/seed-varieties/${subscriptionId}`)}
                className="w-full bg-white rounded-2xl border border-[#DDD0B8] px-4 py-4 flex items-center justify-between active:scale-98 transition-transform mb-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🌾</span>
                  <div className="text-left">
                    <p className="font-semibold text-[#6B3F1F] text-sm">{t('preStart.seedsTitle')}</p>
                    <p className="text-xs text-[#7A8C7E]">{t('preStart.seedsBody')}</p>
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
                    <p className="font-semibold text-[#6B3F1F] text-sm">{t('preStart.pesticidesTitle')}</p>
                    <p className="text-xs text-[#7A8C7E]">{t('preStart.itemsRecommended', { count: pestPractices.length })}</p>
                  </div>
                </div>
                <button
                  onClick={() => openOrderSheet('PESTICIDE')}
                  className="w-full py-2.5 rounded-xl text-white text-sm font-semibold"
                  style={{ background: colour }}
                >
                  {t('preStart.pesticidesCta')}
                </button>
              </div>
            )}

            {fertPractices.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4 mb-3">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">🌱</span>
                  <div>
                    <p className="font-semibold text-[#6B3F1F] text-sm">{t('preStart.fertilisersTitle')}</p>
                    <p className="text-xs text-[#7A8C7E]">{t('preStart.itemsRecommended', { count: fertPractices.length })}</p>
                  </div>
                </div>
                <button
                  onClick={() => openOrderSheet('FERTILISER')}
                  className="w-full py-2.5 rounded-xl text-white text-sm font-semibold"
                  style={{ background: colour }}
                >
                  {t('preStart.fertilisersCta')}
                </button>
              </div>
            )}
          </>
        )}

        {/* Alerts — farmer is always notified via push; this card
            captures one optional extra recipient (dealer / facilitator
            / anyone). ASSIGNED subs prefill from the promoter; SELF
            subs start blank. Either way the farmer can edit. */}
        <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-3 mt-6 px-1">{t('alerts.sectionHeader')}</p>
        <div className="bg-white border border-[#DDD0B8] rounded-2xl p-4">
          <p className="text-sm text-[#6B3F1F]">
            <span className="font-semibold">{t('alerts.youAlwaysPrefix')}</span> {t('alerts.youAlwaysSuffix')}
          </p>
          {alertPrefs && alertPrefs.extra_phone && (
            <p className="text-sm text-[#6B3F1F] mt-2">
              {t('alerts.alsoSentTo')} <span className="font-semibold">{alertPrefs.extra_name || t('alerts.extraContactFallback')}</span>
              <span className="text-[#7A8C7E]"> ({alertPrefs.extra_phone})</span>
              {alertPrefs.source === 'auto_promoter' && (
                <span className="text-[#7A8C7E] text-xs ml-1">{t('alerts.fromPromoter')}</span>
              )}
            </p>
          )}
          {alertPrefs && !alertPrefs.extra_phone && (
            <p className="text-sm text-[#7A8C7E] mt-2 italic">{t('alerts.noExtra')}</p>
          )}
          <button
            onClick={openAlertSheet}
            className="w-full mt-3 py-2 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium"
          >
            {alertPrefs?.extra_phone ? t('alerts.changeRecipient') : t('alerts.addRecipient')}
          </button>
        </div>

        {/* Ask Expert preference */}
        <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-3 mt-6 px-1">{t('expert.sectionHeader')}</p>
        <div className="bg-white border border-[#DDD0B8] rounded-2xl p-4">
          {!expertSetting ? (
            <p className="text-sm text-[#7A8C7E] italic">{tCommon('loading')}</p>
          ) : expertSetting.mode === 'SPECIFIC' && expertSetting.preferred_pundit ? (
            <>
              <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-1">{t('expert.currentlyLabel')}</p>
              <p className="text-sm font-semibold text-[#6B3F1F]">
                {expertSetting.preferred_pundit.name || t('expert.selectedFallback')}
                {expertSetting.preferred_pundit.phone && (
                  <span className="text-[#7A8C7E] font-normal ml-2">({expertSetting.preferred_pundit.phone})</span>
                )}
              </p>
              <p className="text-xs text-[#7A8C7E] mt-1">{t('expert.specificHint')}</p>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <button
                  onClick={openExpertSheet}
                  className="py-2 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium"
                >{tCommon('change')}</button>
                <button
                  onClick={revertExpert}
                  disabled={savingExpert}
                  className="py-2 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium disabled:opacity-40"
                >{t('expert.revertToDefault')}</button>
              </div>
            </>
          ) : expertSetting.mode === 'PROMOTER_PUNDIT' && expertSetting.promoter_pundit ? (
            <>
              <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-1">{t('expert.currentlyLabel')}</p>
              <p className="text-sm font-semibold text-[#6B3F1F]">
                {expertSetting.promoter_pundit.name || t('expert.promoterFallback')}
                {expertSetting.promoter_pundit.phone && (
                  <span className="text-[#7A8C7E] font-normal ml-2">({expertSetting.promoter_pundit.phone})</span>
                )}
              </p>
              <p className="text-xs text-[#7A8C7E] mt-1">
                {t('expert.promoterHint')}
              </p>
              <button
                onClick={openExpertSheet}
                className="mt-3 w-full py-2 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium"
              >{t('expert.chooseDifferent')}</button>
            </>
          ) : (
            <>
              <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-1">{t('expert.currentlyLabel')}</p>
              <p className="text-sm font-semibold text-[#6B3F1F]">{t('expert.teamLabel')}</p>
              <p className="text-xs text-[#7A8C7E] mt-1">
                {expertSetting.company_experts.length > 0
                  ? t('expert.teamHint')
                  : t('expert.noExpertsHint')}
              </p>
              {expertSetting.company_experts.length > 0 && (
                <button
                  onClick={openExpertSheet}
                  className="mt-3 w-full py-2 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium"
                >{t('expert.chooseSpecific')}</button>
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
                <p className="font-bold text-[#6B3F1F] text-base">{t('orderSheet.successTitle')}</p>
                <p className="text-sm text-[#6B3F1F] mt-2">
                  {t('orderSheet.successBody', { count: orderSuccess.item_count })}
                </p>
                <div className="grid grid-cols-2 gap-3 mt-5">
                  <button
                    onClick={closeOrderSheet}
                    className="py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-semibold"
                  >{t('orderSheet.close')}</button>
                  <button
                    onClick={() => router.push(`/orders/${orderSuccess.order_id}`)}
                    className="py-3 rounded-xl text-white text-sm font-semibold"
                    style={{ background: colour }}
                  >{t('orderSheet.takeMe')}</button>
                </div>
              </>
            ) : (
              <>
                {/* State A: tentative (no acreage set) — entry first */}
                {!sub.farm_area_acres && !sub.farm_area_confirmed_at && (
                  <>
                    <p className="font-bold text-[#6B3F1F] text-base">{t('orderSheet.confirmAreaTitle')}</p>
                    <p className="text-xs text-[#7A8C7E] mt-1">
                      {t('orderSheet.confirmAreaBody')}
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
                        {t('area.unitAcres')}
                      </span>
                    </div>
                  </>
                )}

                {/* State B: soft set (tentative value exists, not yet locked) */}
                {sub.farm_area_acres != null && !sub.farm_area_confirmed_at && (
                  <>
                    <p className="font-bold text-[#6B3F1F] text-base">
                      {orderSheet.category === 'PESTICIDE' ? t('orderSheet.orderDbsPesticides') : t('orderSheet.orderDbsFertilisers')}
                    </p>
                    {orderSheetEditingArea ? (
                      <>
                        <p className="text-xs text-[#7A8C7E] mt-2">{t('orderSheet.updateAreaLabel')}</p>
                        <div className="flex gap-2 mt-2">
                          <input
                            type="number" inputMode="decimal" step="0.01" min="0"
                            value={orderSheetArea}
                            onChange={e => setOrderSheetArea(e.target.value)}
                            placeholder="0.00"
                            className="flex-1 min-w-0 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#3A7D44]"
                          />
                          <span className="flex items-center px-3 py-2 text-sm text-[#6B3F1F] bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl shrink-0">
                            {t('area.unitAcres')}
                          </span>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-[#6B3F1F] mt-3">
                        {t('orderSheet.currentAreaPrefix')} <span className="font-semibold">{sub.farm_area_acres} {t('area.unitAcres')}</span>{' '}
                        <button
                          onClick={() => setOrderSheetEditingArea(true)}
                          className="ml-1 text-xs underline"
                          style={{ color: colour }}
                        >{tCommon('change')}</button>
                      </p>
                    )}
                    <p className="text-amber-700 bg-amber-50 px-3 py-2 rounded text-xs mt-3">
                      {t('orderSheet.willUseForVolume')}
                    </p>
                  </>
                )}

                {/* State C: hard locked */}
                {sub.farm_area_confirmed_at && (
                  <>
                    <p className="font-bold text-[#6B3F1F] text-base">
                      {orderSheet.category === 'PESTICIDE' ? t('orderSheet.orderDbsPesticides') : t('orderSheet.orderDbsFertilisers')}
                    </p>
                    <p className="text-sm text-[#6B3F1F] mt-3">
                      {t('orderSheet.areaPrefix')} <span className="font-semibold">{sub.farm_area_acres} {t('area.unitAcres')}</span>{' '}
                      <span className="text-xs text-[#7A8C7E]">{t('orderSheet.areaLockedSuffix')}</span>
                    </p>
                    <p className="text-[#7A8C7E] text-xs mt-2">
                      {t('orderSheet.lockedAtPlanting')}
                    </p>
                  </>
                )}

                <div className="grid grid-cols-2 gap-3 mt-5">
                  <button
                    onClick={closeOrderSheet}
                    disabled={orderBusy}
                    className="py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-semibold disabled:opacity-40"
                  >{tCommon('cancel')}</button>
                  <button
                    onClick={placeBuyAllOrder}
                    disabled={orderBusy}
                    className="py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                    style={{ background: colour }}
                  >
                    {orderBusy ? '…' : (sub.farm_area_confirmed_at ? t('orderSheet.placeOrder') : t('orderSheet.confirmAndOrder'))}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Alerts bottom sheet — single extra-recipient editor.
          Farmer always gets alerts; this captures one phone OR an
          explicit "nobody extra" opt-out. ASSIGNED case shows a hint
          that the promoter auto-prefills if neither is set. */}
      {alertSheet && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-end" onClick={() => !savingAlerts && setAlertSheet(false)}>
          <div className="bg-white w-full rounded-t-3xl p-5 max-w-lg mx-auto" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F] text-base">{t('alertsSheet.title')}</p>
            <p className="text-xs text-[#7A8C7E] mt-1">
              {t('alertsSheet.body')}
            </p>

            {/* Opt-out toggle. When ON, the phone input is collapsed
                and Save persists `disabled: true`. */}
            <label className="mt-4 flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[#DDD0B8] bg-[#F5F0E8]/60 cursor-pointer">
              <input
                type="checkbox"
                checked={alertDisabled}
                onChange={e => { setAlertDisabled(e.target.checked); setAlertError(null) }}
                className="w-4 h-4"
              />
              <span className="text-sm text-[#6B3F1F]">{t('alertsSheet.optOut')}</span>
            </label>

            {!alertDisabled && (
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-xs text-[#7A8C7E] mb-1">{t('alertsSheet.phoneLabel')}</p>
                  <input
                    type="tel" inputMode="tel"
                    value={alertPhoneInput}
                    onChange={e => { setAlertPhoneInput(e.target.value); setAlertError(null) }}
                    placeholder={t('alertsSheet.phonePlaceholder')}
                    className="w-full border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#3A7D44]"
                  />
                  {/* Verify chip — looks the phone up so the farmer can
                      see who they're about to add. The backend re-verifies
                      and refuses if not a Dealer/Facilitator. */}
                  <PhoneVerify
                    phone={alertPhoneInput}
                    onResolve={r => {
                      if (r?.found && r.name && !alertNameInput.trim()) {
                        setAlertNameInput(r.name)
                      }
                    }}
                  />
                </div>
                {isAssigned && (
                  <p className="text-xs text-[#7A8C7E]">
                    {t('alertsSheet.assignedHint')}
                  </p>
                )}
              </div>
            )}

            {alertError && (
              <p className="mt-3 text-xs text-[#D4682E] bg-[#D4682E]/10 border border-[#D4682E]/30 rounded-lg px-3 py-2">
                {alertError}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3 mt-5">
              <button
                onClick={() => setAlertSheet(false)}
                disabled={savingAlerts}
                className="py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-semibold disabled:opacity-40"
              >{tCommon('cancel')}</button>
              <button
                onClick={saveAlertPrefs}
                disabled={savingAlerts}
                className="py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                style={{ background: colour }}
              >{savingAlerts ? '…' : tCommon('save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Expert picker bottom sheet */}
      {expertSheet && expertSetting && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-end" onClick={() => !savingExpert && setExpertSheet(false)}>
          <div className="bg-white w-full rounded-t-3xl p-5 max-w-lg mx-auto" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F] text-base">{t('expertSheet.title')}</p>
            <p className="text-xs text-[#7A8C7E] mt-1">
              {t('expertSheet.body')}
            </p>
            <div className="mt-4">
              <p className="text-xs text-[#7A8C7E] mb-1">{t('alertsSheet.phoneLabel')}</p>
              <input
                type="tel" inputMode="tel"
                value={expertPhoneInput}
                onChange={e => { setExpertPhoneInput(e.target.value); setExpertError(null) }}
                placeholder={t('alertsSheet.phonePlaceholder')}
                className="w-full border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#3A7D44]"
              />
            </div>
            {expertError && (
              <p className="mt-3 text-xs text-[#D4682E] bg-[#D4682E]/10 border border-[#D4682E]/30 rounded-lg px-3 py-2">
                {expertError}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 mt-5">
              <button
                onClick={() => setExpertSheet(false)}
                disabled={savingExpert}
                className="py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-semibold disabled:opacity-40"
              >{tCommon('cancel')}</button>
              <button
                onClick={() => setExpertByPhone(expertPhoneInput.trim())}
                disabled={savingExpert || !expertPhoneInput.trim()}
                className="py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                style={{ background: colour }}
              >{savingExpert ? '…' : tCommon('save')}</button>
            </div>
            {expertSetting.preferred_pundit && (
              <button
                onClick={revertExpert}
                disabled={savingExpert}
                className="mt-3 w-full py-2.5 text-xs text-[#7A8C7E] underline underline-offset-2 disabled:opacity-40">
                {t('expertSheet.clear')}
              </button>
            )}
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
              {t('needDate.title')}
            </h3>
            <p className="text-[#7A8C7E] text-sm text-center mt-2 leading-relaxed">
              {showNeedDateSheet === 'advisory'
                ? t('needDate.advisory')
                : t('needDate.diagnose')}
            </p>
            <button
              onClick={() => { setShowNeedDateSheet(null); setShowStartDate(true) }}
              className="w-full mt-6 py-3.5 rounded-xl text-white font-semibold text-sm"
              style={{ background: colour }}>
              {t('needDate.setNow')}
            </button>
            <button
              onClick={() => setShowNeedDateSheet(null)}
              className="w-full mt-2 py-2 text-[#7A8C7E] text-sm">
              {t('needDate.later')}
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
