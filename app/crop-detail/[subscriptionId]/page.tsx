'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import api from '@/lib/api'

interface SubscriptionDetail {
  id: string; status: string; crop_start_date: string | null
  reference_number: string | null; client_id: string; package_id: string
  subscription_type?: string
  farm_area_acres: number | null
  area_unit: string | null
  farm_area_confirmed_at: string | null
}
interface Branding {
  display_name: string; primary_colour: string; tagline: string | null; logo_url: string | null
}
interface PreStartInput {
  timeline_id: string; timeline_name: string
  days_before_sowing_from: number; days_before_sowing_to: number
  practices: { id: string; l0_type: string; l1_type: string | null; l2_type: string | null }[]
}
interface AlertRecipientRow {
  recipient_user_id: string
  recipient_type: string
  status?: string
  phone?: string | null
  name?: string | null
}
interface ExpertSetting {
  mode: 'SPECIFIC' | 'PROMOTER_PUNDIT' | 'REGULAR_TEAM'
  preferred_pundit: { pundit_id: string; name: string | null; phone: string | null } | null
  promoter_pundit: { pundit_id: string; name: string | null; phone: string | null } | null
  company_experts: { pundit_id: string; name: string | null; phone: string | null; role: string }[]
}
interface SeedAvail { has_varieties: boolean; count: number }

const AREA_UNITS = ['acres', 'hectares', 'bigha']

export default function CropDetailPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const router = useRouter()
  const [sub, setSub] = useState<SubscriptionDetail | null>(null)
  const [branding, setBranding] = useState<Branding | null>(null)
  const [preStart, setPreStart] = useState<PreStartInput[]>([])
  const [missedCount, setMissedCount] = useState(0)
  const [alertRecipients, setAlertRecipients] = useState<AlertRecipientRow[]>([])
  const [expertSetting, setExpertSetting] = useState<ExpertSetting | null>(null)
  const [seedAvail, setSeedAvail] = useState<SeedAvail>({ has_varieties: false, count: 0 })
  const [me, setMe] = useState<{ name: string | null; phone: string | null } | null>(null)
  const [loading, setLoading] = useState(true)

  // Start date state
  const [startDate, setStartDate] = useState('')
  const [savingDate, setSavingDate] = useState(false)
  const [showStartDate, setShowStartDate] = useState(false)

  // Acreage state
  const [areaInput, setAreaInput] = useState('')
  const [areaUnit, setAreaUnit] = useState('acres')
  const [savingArea, setSavingArea] = useState(false)

  // Bottom sheets
  const [orderSheet, setOrderSheet] = useState<{ open: boolean; category: 'PESTICIDE' | 'FERTILISER' | null }>({ open: false, category: null })
  const [orderBusy, setOrderBusy] = useState(false)
  const [orderSheetArea, setOrderSheetArea] = useState('')
  const [orderSheetUnit, setOrderSheetUnit] = useState('acres')
  const [orderSheetEditingArea, setOrderSheetEditingArea] = useState(false)
  const [orderSuccess, setOrderSuccess] = useState<{ order_id: string; item_count: number } | null>(null)

  const [alertSheet, setAlertSheet] = useState(false)
  const [alertSendSelf, setAlertSendSelf] = useState(true)
  const [alertSendPromoter, setAlertSendPromoter] = useState(true)
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
      setAreaUnit(found.area_unit || 'acres')

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
        api.get<Branding>(`/portal/${found.client_id}/branding`),
        api.get<PreStartInput[]>(`/farmer/subscriptions/${subscriptionId}/pre-start-inputs`),
        api.get<{ count: number } | { timeline_id: string }[]>(`/farmer/subscriptions/${subscriptionId}/missed-items`),
        api.get<AlertRecipientRow[]>(`/farmer/subscriptions/${subscriptionId}/alert-preferences`),
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
        setAlertRecipients(alertsRes.value.data)
        setAlertSendSelf(alertsRes.value.data.some(r => r.recipient_type === 'FARMER'))
        setAlertSendPromoter(alertsRes.value.data.some(r => r.recipient_type === 'PROMOTER'))
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
        area_unit: areaUnit,
      })
      setSub(s => s ? { ...s, farm_area_acres: parseFloat(areaInput), area_unit: areaUnit } : s)
      showToast('Farm area saved')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      showToast(err.response?.data?.detail || 'Could not save')
    } finally { setSavingArea(false) }
  }

  function openOrderSheet(category: 'PESTICIDE' | 'FERTILISER') {
    setOrderSheet({ open: true, category })
    setOrderSuccess(null)
    setOrderSheetArea(sub?.farm_area_acres != null ? String(sub.farm_area_acres) : '')
    setOrderSheetUnit(sub?.area_unit || 'acres')
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
        body.area_unit = orderSheetUnit
      }
      const res = await api.post<{ order_id: string; item_count: number }>(
        `/farmer/subscriptions/${subscriptionId}/orders/buy-all-dbs`,
        body,
      )
      // Reflect soft-confirm in local sub
      setSub(s => s ? {
        ...s,
        farm_area_acres: needsAreaInBody ? parseFloat(orderSheetArea) : s.farm_area_acres,
        area_unit: needsAreaInBody ? orderSheetUnit : s.area_unit,
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
      let promoterUserId: string | null = null
      if (alertSendPromoter) {
        // Look up an existing PROMOTER recipient to reuse the user_id
        const existingPromoter = alertRecipients.find(r => r.recipient_type === 'PROMOTER')
        if (existingPromoter) promoterUserId = existingPromoter.recipient_user_id
      }
      await api.post(`/farmer/subscriptions/${subscriptionId}/alert-preferences`, {
        send_to_self: alertSendSelf,
        promoter_user_id: promoterUserId,
      })
      // Reload alert recipients
      const alertsRes = await api.get<AlertRecipientRow[]>(`/farmer/subscriptions/${subscriptionId}/alert-preferences`)
      setAlertRecipients(alertsRes.data)
      setAlertSheet(false)
      showToast('Alert preferences saved')
    } finally { setSavingAlerts(false) }
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

  const colour = branding?.primary_colour || '#1A5C2A'
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

  // Acreage state — three-state policy
  const areaHardLocked = !!sub.farm_area_confirmed_at
  const areaSoftSet = !areaHardLocked && sub.farm_area_acres != null
  const areaTentative = !areaHardLocked && sub.farm_area_acres == null

  const farmerRecipient = alertRecipients.find(r => r.recipient_type === 'FARMER')
  const promoterRecipient = alertRecipients.find(r => r.recipient_type === 'PROMOTER')
  const isAssigned = sub.subscription_type === 'ASSIGNED'

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Branded header */}
      <div className="sticky top-0 z-30 px-4 pt-safe" style={{ background: colour }}>
        <div className="flex items-center gap-3 py-3">
          <button onClick={() => router.push('/home')} className="text-white opacity-70 text-xl">←</button>
          <div className="flex-1">
            <p className="text-white font-bold text-sm">{branding?.display_name || 'Loading…'}</p>
            {branding?.tagline && <p className="text-white text-xs opacity-70">{branding.tagline}</p>}
          </div>
          {sub.reference_number && (
            <p className="text-white text-xs opacity-60 font-mono">{sub.reference_number}</p>
          )}
        </div>
      </div>

      <div className="pb-28 px-4 pt-5 max-w-lg mx-auto">

        {/* Acreage card — 3 states: Tentative / Soft confirmed / Hard locked */}
        <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-3 mt-2 px-1">Farm Area</p>

        {areaTentative && (
          <div className="bg-white border border-stone-200 rounded-2xl p-4">
            <p className="text-sm font-semibold text-stone-800 mb-3">Farm area</p>
            <div className="flex gap-2">
              <input
                type="number" inputMode="decimal" step="0.01" min="0"
                value={areaInput}
                onChange={e => setAreaInput(e.target.value)}
                placeholder="0.00"
                className="flex-1 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-stone-400"
              />
              <select
                value={areaUnit}
                onChange={e => setAreaUnit(e.target.value)}
                className="border border-stone-200 rounded-xl px-2 py-2 text-sm bg-white"
              >
                {AREA_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <button
                onClick={saveArea}
                disabled={savingArea || !areaInput}
                className="px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                style={{ background: colour }}
              >
                {savingArea ? '…' : 'Save'}
              </button>
            </div>
            <p className="text-stone-400 text-xs mt-2">Tentative for now. Will be confirmed when you place your first order.</p>
          </div>
        )}

        {areaSoftSet && (
          <div className="bg-white border border-stone-200 rounded-2xl p-4">
            <p className="text-sm font-semibold text-stone-800 mb-3">Farm area · Tentative</p>
            <div className="flex gap-2">
              <input
                type="number" inputMode="decimal" step="0.01" min="0"
                value={areaInput}
                onChange={e => setAreaInput(e.target.value)}
                placeholder="0.00"
                className="flex-1 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-stone-400"
              />
              <select
                value={areaUnit}
                onChange={e => setAreaUnit(e.target.value)}
                className="border border-stone-200 rounded-xl px-2 py-2 text-sm bg-white"
              >
                {AREA_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
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
          <div className="bg-white border border-stone-200 rounded-2xl px-4 py-3">
            <p className="text-sm font-semibold text-stone-800">Farm area · Confirmed</p>
            <p className="font-semibold text-stone-800 mt-1">
              {sub.farm_area_acres ?? '—'} {sub.area_unit || ''}
            </p>
            <p className="text-stone-400 text-xs mt-1">
              Locked on {new Date(sub.farm_area_confirmed_at!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}. Volumes for all your inputs are calculated on this.
            </p>
          </div>
        )}

        {/* Start date */}
        <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-3 mt-6 px-1">Start Date</p>
        {!hasStartDate ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <p className="font-bold text-amber-800">Set your crop start date</p>
            <p className="text-amber-600 text-xs mt-1">Advisory and Diagnosis unlock once you set the sowing date.</p>
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
        ) : (
          <div className="bg-white rounded-2xl border border-stone-200 px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-stone-400">Crop start date</p>
              <p className="font-semibold text-stone-800">{new Date(sub.crop_start_date!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
            </div>
            <button onClick={() => setShowStartDate(!showStartDate)}
              className="text-xs text-stone-400 underline">change</button>
          </div>
        )}
        {showStartDate && hasStartDate && (
          <div className="mt-3 bg-white rounded-2xl border border-stone-200 p-4 flex gap-2">
            <input type="date" value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="flex-1 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none" />
            <button onClick={saveStartDate} disabled={savingDate || !startDate}
              className="px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
              style={{ background: colour }}>
              {savingDate ? '…' : 'Update'}
            </button>
          </div>
        )}

        {/* Three action tiles */}
        <div className="grid grid-cols-3 gap-3 mt-6">
          <button
            onClick={() => hasStartDate ? router.push(`/advisory/${subscriptionId}`) : setShowNeedDateSheet('advisory')}
            className={`rounded-2xl p-4 text-center border shadow-sm transition-all ${hasStartDate ? 'bg-white border-stone-200 active:scale-95' : 'bg-stone-100 border-stone-200 opacity-60'}`}>
            <span className="text-3xl block mb-2">🌿</span>
            <p className="text-xs font-bold text-stone-800">Advisory</p>
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
                ? 'bg-white border-stone-200 active:scale-95'
                : 'bg-stone-100 border-stone-200 opacity-60'
            }`}>
            <span className="text-3xl block mb-2">🔬</span>
            <p className="text-xs font-bold text-stone-800">Diagnose</p>
            {!hasStartDate && <p className="text-xs text-amber-600 mt-0.5">Set date first</p>}
            {hasStartDate && diagnosisEligibility && !diagnosisEligibility.eligible && (
              <p className="text-xs text-stone-500 mt-0.5">Not available</p>
            )}
          </button>

          <button
            onClick={() => router.push(`/ask-expert/${subscriptionId}`)}
            className="bg-white rounded-2xl p-4 text-center border border-stone-200 shadow-sm active:scale-95">
            <span className="text-3xl block mb-2">🎓</span>
            <p className="text-xs font-bold text-stone-800">Ask Expert</p>
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
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-3 mt-6 px-1">Prepare for Sowing</p>

            {seedAvail.has_varieties && (
              <button
                onClick={() => router.push(`/subscribe/seed-varieties/${subscriptionId}`)}
                className="w-full bg-white rounded-2xl border border-stone-200 px-4 py-4 flex items-center justify-between active:scale-98 transition-transform mb-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🌾</span>
                  <div className="text-left">
                    <p className="font-semibold text-stone-800 text-sm">Seeds &amp; Seedlings</p>
                    <p className="text-xs text-stone-400">Browse and order recommended varieties</p>
                  </div>
                </div>
                <span className="text-stone-300 text-xl">›</span>
              </button>
            )}

            {pestPractices.length > 0 && (
              <div className="bg-white rounded-2xl border border-stone-200 p-4 mb-3">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">🧪</span>
                  <div>
                    <p className="font-semibold text-stone-800 text-sm">Pre-Start Pesticides</p>
                    <p className="text-xs text-stone-400">{pestPractices.length} item{pestPractices.length > 1 ? 's' : ''} recommended before sowing</p>
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
              <div className="bg-white rounded-2xl border border-stone-200 p-4 mb-3">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">🌱</span>
                  <div>
                    <p className="font-semibold text-stone-800 text-sm">Pre-Start Fertilisers</p>
                    <p className="text-xs text-stone-400">{fertPractices.length} item{fertPractices.length > 1 ? 's' : ''} recommended before sowing</p>
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

        {/* Alerts */}
        <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-3 mt-6 px-1">Alerts</p>
        <div className="bg-white border border-stone-200 rounded-2xl p-4">
          <p className="text-sm font-semibold text-stone-800 mb-2">Who receives alerts for this advisory?</p>
          <div className="space-y-1.5 mb-3">
            {farmerRecipient ? (
              <p className="text-sm text-stone-700">
                You {me?.phone ? <span className="text-stone-400">({me.phone})</span> : null}
              </p>
            ) : (
              <p className="text-sm text-stone-400 italic">Alerts to you are turned off</p>
            )}
            {promoterRecipient && (
              <p className="text-sm text-stone-700">
                Also: {promoterRecipient.name || 'Your Promoter'} {promoterRecipient.phone ? <span className="text-stone-400">({promoterRecipient.phone})</span> : null}
              </p>
            )}
          </div>
          <button
            onClick={() => setAlertSheet(true)}
            className="w-full py-2 rounded-xl border border-stone-200 text-stone-700 text-sm font-medium"
          >
            Change alert recipients
          </button>
        </div>

        {/* Ask Expert preference */}
        <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-3 mt-6 px-1">Ask Expert</p>
        <div className="bg-white border border-stone-200 rounded-2xl p-4">
          {!expertSetting ? (
            <p className="text-sm text-stone-400 italic">Loading…</p>
          ) : expertSetting.mode === 'SPECIFIC' && expertSetting.preferred_pundit ? (
            <>
              <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Currently</p>
              <p className="text-sm font-semibold text-stone-800">
                {expertSetting.preferred_pundit.name || 'Selected Expert'}
                {expertSetting.preferred_pundit.phone && (
                  <span className="text-stone-400 font-normal ml-2">({expertSetting.preferred_pundit.phone})</span>
                )}
              </p>
              <p className="text-xs text-stone-500 mt-1">Your queries go directly to this expert.</p>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <button
                  onClick={() => setExpertSheet(true)}
                  className="py-2 rounded-xl border border-stone-200 text-stone-700 text-sm font-medium"
                >Change</button>
                <button
                  onClick={revertExpert}
                  disabled={savingExpert}
                  className="py-2 rounded-xl border border-stone-200 text-stone-700 text-sm font-medium disabled:opacity-40"
                >Revert to default</button>
              </div>
            </>
          ) : expertSetting.mode === 'PROMOTER_PUNDIT' && expertSetting.promoter_pundit ? (
            <>
              <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Currently</p>
              <p className="text-sm font-semibold text-stone-800">
                {expertSetting.promoter_pundit.name || 'Promoter-Expert'}
                {expertSetting.promoter_pundit.phone && (
                  <span className="text-stone-400 font-normal ml-2">({expertSetting.promoter_pundit.phone})</span>
                )}
              </p>
              <p className="text-xs text-stone-500 mt-1">
                Your Promoter is also an Expert. Queries go to them by default.
              </p>
              <button
                onClick={() => setExpertSheet(true)}
                className="mt-3 w-full py-2 rounded-xl border border-stone-200 text-stone-700 text-sm font-medium"
              >Choose a different expert</button>
            </>
          ) : (
            <>
              <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Currently</p>
              <p className="text-sm font-semibold text-stone-800">Regular team routing</p>
              <p className="text-xs text-stone-500 mt-1">
                {expertSetting.company_experts.length > 0
                  ? "Queries go to your company's regular Expert team."
                  : "Your company has no specific experts available yet. Queries will go to the regular team."}
              </p>
              {expertSetting.company_experts.length > 0 && (
                <button
                  onClick={() => setExpertSheet(true)}
                  className="mt-3 w-full py-2 rounded-xl border border-stone-200 text-stone-700 text-sm font-medium"
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
                <p className="font-bold text-stone-800 text-base">Order created</p>
                <p className="text-sm text-stone-600 mt-2">
                  {orderSuccess.item_count} item{orderSuccess.item_count !== 1 ? 's' : ''} added to a single order. You can pick a dealer on the order screen.
                </p>
                <div className="grid grid-cols-2 gap-3 mt-5">
                  <button
                    onClick={closeOrderSheet}
                    className="py-3 rounded-xl border border-stone-200 text-stone-700 text-sm font-semibold"
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
                    <p className="font-bold text-stone-800 text-base">Confirm your tentative area</p>
                    <p className="text-xs text-stone-500 mt-1">
                      Volumes for these inputs are calculated on this. You can revise it once more at planting.
                    </p>
                    <div className="flex gap-2 mt-4">
                      <input
                        type="number" inputMode="decimal" step="0.01" min="0"
                        value={orderSheetArea}
                        onChange={e => setOrderSheetArea(e.target.value)}
                        placeholder="0.00"
                        className="flex-1 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-stone-400"
                      />
                      <select
                        value={orderSheetUnit}
                        onChange={e => setOrderSheetUnit(e.target.value)}
                        className="border border-stone-200 rounded-xl px-2 py-2 text-sm bg-white"
                      >
                        {AREA_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                  </>
                )}

                {/* State B: soft set (tentative value exists, not yet locked) */}
                {sub.farm_area_acres != null && !sub.farm_area_confirmed_at && (
                  <>
                    <p className="font-bold text-stone-800 text-base">
                      Order DBS {orderSheet.category === 'PESTICIDE' ? 'pesticides' : 'fertilisers'}
                    </p>
                    {orderSheetEditingArea ? (
                      <>
                        <p className="text-xs text-stone-500 mt-2">Update tentative area:</p>
                        <div className="flex gap-2 mt-2">
                          <input
                            type="number" inputMode="decimal" step="0.01" min="0"
                            value={orderSheetArea}
                            onChange={e => setOrderSheetArea(e.target.value)}
                            placeholder="0.00"
                            className="flex-1 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-stone-400"
                          />
                          <select
                            value={orderSheetUnit}
                            onChange={e => setOrderSheetUnit(e.target.value)}
                            className="border border-stone-200 rounded-xl px-2 py-2 text-sm bg-white"
                          >
                            {AREA_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-stone-700 mt-3">
                        Current tentative area: <span className="font-semibold">{sub.farm_area_acres} {sub.area_unit}</span>{' '}
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
                    <p className="font-bold text-stone-800 text-base">
                      Order DBS {orderSheet.category === 'PESTICIDE' ? 'pesticides' : 'fertilisers'}
                    </p>
                    <p className="text-sm text-stone-700 mt-3">
                      Area: <span className="font-semibold">{sub.farm_area_acres} {sub.area_unit}</span>{' '}
                      <span className="text-xs text-stone-400">(locked)</span>
                    </p>
                    <p className="text-stone-400 text-xs mt-2">
                      Locked at planting. Volumes are calculated on this.
                    </p>
                  </>
                )}

                <div className="grid grid-cols-2 gap-3 mt-5">
                  <button
                    onClick={closeOrderSheet}
                    disabled={orderBusy}
                    className="py-3 rounded-xl border border-stone-200 text-stone-700 text-sm font-semibold disabled:opacity-40"
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

      {/* Alerts bottom sheet */}
      {alertSheet && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-end" onClick={() => !savingAlerts && setAlertSheet(false)}>
          <div className="bg-white w-full rounded-t-3xl p-5 max-w-lg mx-auto" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-stone-800 text-base">Alert recipients</p>
            <div className="mt-4 space-y-3">
              <label className="flex items-center justify-between bg-stone-50 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-stone-800">Send alerts to me</p>
                  {me?.phone && <p className="text-xs text-stone-400">{me.phone}</p>}
                </div>
                <input
                  type="checkbox"
                  checked={alertSendSelf}
                  onChange={e => setAlertSendSelf(e.target.checked)}
                  className="w-5 h-5"
                />
              </label>

              {isAssigned && promoterRecipient && (
                <label className="flex items-center justify-between bg-stone-50 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-stone-800">Also send to my Promoter</p>
                    <p className="text-xs text-stone-400">
                      {promoterRecipient.name || 'Promoter'}{promoterRecipient.phone ? ` · ${promoterRecipient.phone}` : ''}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={alertSendPromoter}
                    onChange={e => setAlertSendPromoter(e.target.checked)}
                    className="w-5 h-5"
                  />
                </label>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-5">
              <button
                onClick={() => setAlertSheet(false)}
                disabled={savingAlerts}
                className="py-3 rounded-xl border border-stone-200 text-stone-700 text-sm font-semibold disabled:opacity-40"
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
            <p className="font-bold text-stone-800 text-base">Choose your expert</p>
            <p className="text-xs text-stone-500 mt-1">Your queries will be routed to this expert directly.</p>
            <div className="mt-4 space-y-2">
              {expertSetting.company_experts.length === 0 ? (
                <p className="text-sm text-stone-400 italic py-4 text-center">No specific experts available.</p>
              ) : (
                expertSetting.company_experts.map(exp => {
                  const isCurrent = expertSetting.preferred_pundit?.pundit_id === exp.pundit_id
                  return (
                    <button
                      key={exp.pundit_id}
                      onClick={() => setExpert(exp.pundit_id)}
                      disabled={savingExpert}
                      className={`w-full text-left rounded-xl px-4 py-3 border ${isCurrent ? 'border-stone-400 bg-stone-50' : 'border-stone-200'} disabled:opacity-40`}
                    >
                      <p className="text-sm font-semibold text-stone-800">{exp.name || 'Expert'}</p>
                      <p className="text-xs text-stone-400">
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
              className="mt-4 w-full py-3 rounded-xl border border-stone-200 text-stone-700 text-sm font-semibold disabled:opacity-40"
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
            <h3 className="text-stone-900 font-semibold text-lg text-center">
              {showNeedDateSheet === 'advisory' ? 'Set your crop start date' : 'Set your start date'}
            </h3>
            <p className="text-stone-500 text-sm text-center mt-2 leading-relaxed">
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
              className="w-full mt-2 py-2 text-stone-400 text-sm">
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
