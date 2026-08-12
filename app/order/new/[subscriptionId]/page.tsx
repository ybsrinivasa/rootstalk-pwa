'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import RecipientLookupCard, { type RecipientLookupResult } from '@/components/RecipientLookupCard'
import ClientCropChip from '@/components/ClientCropChip'
import ConfirmSendOrderSheet, { recipientLabel } from '@/components/ConfirmSendOrderSheet'
import RecipientMap, { type MapPoint } from '@/components/orders/RecipientMap'
import LocationSourceToggle, { type LocationSource } from '@/components/orders/LocationSourceToggle'
import { googleMapsDirections } from '@/lib/directions'
import api from '@/lib/api'

interface Person {
  user_id: string; name: string | null; phone: string | null; distance_km: number; is_promoter: boolean
  is_training_dealer?: boolean
  shop_name?: string | null; shop_address?: string | null; sell_categories?: string[]
  shop_gps_lat?: number; shop_gps_lng?: number
  gps_lat?: number; gps_lng?: number
}
interface Subscription {
  id: string; crop_start_date: string | null; client_id: string; package_id: string
  farm_area_acres: number | null
  area_unit: string | null
  farm_area_confirmed_at: string | null
}

// All formulas calibrated for acres — see crop-detail/page.tsx
// for the rationale. No unit picker; farmer types acres only.

export default function OrderingScreenPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const t = useTranslations('orders.new')
  const tOrdersCommon = useTranslations('orders.common')
  const tCommon = useTranslations('common')

  const practiceIdsParam = searchParams.get('practice_ids') || ''
  const orderType = searchParams.get('order_type') || 'PESTICIDE'
  const dateFrom = searchParams.get('date_from') || ''
  const dateTo = searchParams.get('date_to') || ''

  const practiceIds = practiceIdsParam ? practiceIdsParam.split(',').filter(Boolean) : []

  const [tab, setTab] = useState<'dealers' | 'facilitators'>('dealers')
  const [dealers, setDealers] = useState<Person[]>([])
  const [facilitators, setFacilitators] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [placing, setPlacing] = useState<string | null>(null)
  const [customPhone, setCustomPhone] = useState('')
  // Phone-entry lookup (2026-06-18 parity with seed-orders picker).
  // Reuses the shared backend lookup endpoint shape via
  // RecipientLookupCard.
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookup, setLookup] = useState<RecipientLookupResult | null>(null)
  const [sub, setSub] = useState<Subscription | null>(null)
  // Orders V2 Batch 9 — locked-brand awareness on the new-order
  // picker. Server returns a banner string if any of the bundled
  // practices is brand-locked; we render it and hide the
  // facilitators tab (locked-brand can't be routed via facilitator).
  const [lockedBrandExplainer, setLockedBrandExplainer] = useState<string | null>(null)

  // Hard-confirm acreage step (only when farm_area_confirmed_at is null)
  const [confirmStep, setConfirmStep] = useState<{ person: Person; isDealer: boolean } | null>(null)
  const [confirmAreaInput, setConfirmAreaInput] = useState('')
  const [editingArea, setEditingArea] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Map + location toggle state.
  const [locSource, setLocSource] = useState<LocationSource>('profile')
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [showMap, setShowMap] = useState(false)
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null)
  const [refetchingRecipients, setRefetchingRecipients] = useState(false)

  function buildEligibleUrl(coords?: { lat: number; lng: number } | null): string {
    const pidsParam = practiceIds.length ? `&practice_ids=${encodeURIComponent(practiceIds.join(','))}` : ''
    const geoParam = coords ? `&lat=${coords.lat}&lng=${coords.lng}` : ''
    return `/farmer/subscriptions/${subscriptionId}/eligible-recipients-for-new-order`
      + `?category=${encodeURIComponent(orderType)}${pidsParam}${geoParam}`
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [subscriptionId])

  async function load() {
    try {
      const [subsRes, eligibleRes] = await Promise.allSettled([
        api.get<Subscription[]>('/farmer/my-subscriptions'),
        api.get<{
          dealers: Person[]
          facilitators: Person[]
          has_locked_brand: boolean
          locked_brand_explainer: string | null
        }>(buildEligibleUrl()),
      ])
      if (subsRes.status === 'fulfilled') setSub(subsRes.value.data.find(s => s.id === subscriptionId) || null)
      if (eligibleRes.status === 'fulfilled') {
        setDealers(eligibleRes.value.data.dealers || [])
        setFacilitators(eligibleRes.value.data.facilitators || [])
        setLockedBrandExplainer(eligibleRes.value.data.locked_brand_explainer)
        if (eligibleRes.value.data.has_locked_brand) setTab('dealers')
      }
    } finally { setLoading(false) }
  }

  async function handleLocationChange(next: LocationSource, coords?: { lat: number; lng: number }) {
    setLocSource(next)
    if (next === 'current' && coords) setCurrentCoords(coords)
    const useCoords = next === 'current' ? (coords || currentCoords) : null
    setRefetchingRecipients(true)
    try {
      const { data } = await api.get<{
        dealers: Person[]
        facilitators: Person[]
        has_locked_brand: boolean
        locked_brand_explainer: string | null
      }>(buildEligibleUrl(useCoords))
      setDealers(data.dealers || [])
      setFacilitators(data.facilitators || [])
      setSelectedRecipientId(null)
    } catch { /* leave previous list in place */ }
    finally { setRefetchingRecipients(false) }
  }

  const farmerUser = getUser()
  const mapOrigin = (() => {
    if (locSource === 'current' && currentCoords) return currentCoords
    if (farmerUser?.gps_lat && farmerUser?.gps_lng) {
      return { lat: Number(farmerUser.gps_lat), lng: Number(farmerUser.gps_lng) }
    }
    return null
  })()

  const activeList = tab === 'dealers' ? dealers : facilitators
  const mapPoints: MapPoint[] = activeList.reduce<MapPoint[]>((acc, p) => {
    const lat = tab === 'dealers' ? p.shop_gps_lat : p.gps_lat
    const lng = tab === 'dealers' ? p.shop_gps_lng : p.gps_lng
    if (lat != null && lng != null) {
      acc.push({
        user_id: p.user_id, name: p.name, shop_name: p.shop_name || null,
        lat, lng, distance_km: p.distance_km,
      })
    }
    return acc
  }, [])

  // Debounced lookup against the new backend endpoint. Same shape
  // as the seed-orders lookup so RecipientLookupCard renders all
  // five verdicts identically. The backend computes has_locked_brand
  // from practice_ids, so the brand-lock rule only fires when the
  // bundle actually contains a brand-locked practice.
  useEffect(() => {
    const digits = customPhone.replace(/\D/g, '')
    if (digits.length < 10) { setLookup(null); setLookupLoading(false); return }
    setLookupLoading(true)
    const timer = setTimeout(async () => {
      try {
        const pidsParam = practiceIds.length ? `&practice_ids=${encodeURIComponent(practiceIds.join(','))}` : ''
        const { data } = await api.get<RecipientLookupResult>(
          `/farmer/subscriptions/${subscriptionId}/lookup-recipient`
            + `?phone=${encodeURIComponent('+91' + digits.slice(-10))}`
            + `&category=${encodeURIComponent(orderType)}${pidsParam}`,
        )
        setLookup(data)
      } catch {
        setLookup(null)
      } finally {
        setLookupLoading(false)
      }
    }, 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customPhone, subscriptionId, orderType])

  function startSendOrderFromLookup() {
    if (!lookup?.found || !lookup.user_id || !lookup.can_receive || !lookup.role) return
    // Build a synthetic Person so the existing acreage-confirm /
    // send pipeline stays the single source of truth for the POST.
    const person: Person = {
      user_id: lookup.user_id,
      name: lookup.name ?? null,
      phone: lookup.phone ?? null,
      distance_km: 0,
      is_promoter: false,
    }
    requestSendOrder(person, lookup.role === 'DEALER')
  }

  // 2026-06-19 — Universal confirm-before-send. The user has to
  // acknowledge "Do you wish to send the {inputType} Order to
  // {recipient}?" before the existing area-confirm / executeSendOrder
  // chain fires. Stays in state until the sheet is dismissed.
  const [pendingSendOrder, setPendingSendOrder] = useState<{ person: Person; isDealer: boolean } | null>(null)

  function requestSendOrder(person: Person, isDealer: boolean) {
    if (practiceIds.length === 0) {
      router.replace(`/crop-detail/${subscriptionId}/orders?tab=manage`)
      return
    }
    setPendingSendOrder({ person, isDealer })
  }

  function startSendOrder(person: Person, isDealer: boolean) {
    if (practiceIds.length === 0) {
      // Defensive fallback — should not normally fire, but route
      // back to the package's Orders page rather than the global
      // pool so "all roads lead to Rome" still holds.
      router.replace(`/crop-detail/${subscriptionId}/orders?tab=manage`)
      return
    }
    // If acreage not yet hard-locked, force a confirmation step.
    if (sub && !sub.farm_area_confirmed_at) {
      setConfirmAreaInput(sub.farm_area_acres != null ? String(sub.farm_area_acres) : '')
      setEditingArea(sub.farm_area_acres == null)
      setErrorMsg(null)
      setConfirmStep({ person, isDealer })
      return
    }
    void executeSendOrder(person, isDealer)
  }

  async function executeSendOrder(person: Person, isDealer: boolean, acreage?: { acres: number; unit: string }) {
    setPlacing(person.user_id)
    setErrorMsg(null)
    try {
      const payload: Record<string, unknown> = {
        subscription_id: subscriptionId,
        client_id: sub?.client_id,
        practice_ids: practiceIds,
        // Batch 9 — pass category so the server doesn't have to
        // re-derive from practices, and so Order.category lands set.
        category: orderType,
        date_from: dateFrom || new Date().toISOString(),
        date_to: dateTo || new Date(Date.now() + 30 * 86400000).toISOString(),
      }
      if (isDealer) payload.dealer_user_id = person.user_id
      else payload.facilitator_user_id = person.user_id
      if (acreage) {
        payload.farm_area_acres = acreage.acres
        payload.area_unit = acreage.unit
      }

      await api.post('/farmer/orders', payload)
      setConfirmStep(null)
      // After submitting, land the farmer on the per-package Orders
      // Manage tab where the newly-created order is now visible —
      // not the global pool (fix 2026-06-02 per user report).
      router.replace(`/crop-detail/${subscriptionId}/orders?tab=manage`)
    } catch (e: unknown) {
      // FastAPI's HTTPException uses two detail shapes: a plain
      // string for legacy raises and a {code, message} object for
      // newer structured errors. Passing the object straight to
      // setErrorMsg used to crash React with "Objects are not valid
      // as a React child" — which Next then masked as Page Not
      // Found (user report 2026-06-18). Normalise both shapes here.
      const err = e as { response?: { data?: { detail?: string | { code?: string; message?: string } } } }
      const detail = err.response?.data?.detail
      const msg =
        typeof detail === 'string'
          ? detail
          : (detail && typeof detail === 'object' && detail.message)
            || tOrdersCommon('errors.sendOrderFailed')
      setErrorMsg(msg)
      setPlacing(null)
    }
  }

  async function confirmAndSend() {
    if (!confirmStep) return
    // Acreage is required because confirmStep only opens when not yet locked
    const valStr = confirmAreaInput.trim()
    if (!valStr || isNaN(parseFloat(valStr)) || parseFloat(valStr) <= 0) {
      setErrorMsg(t('invalidArea'))
      return
    }
    await executeSendOrder(confirmStep.person, confirmStep.isDealer, {
      acres: parseFloat(valStr),
      unit: 'acres',
    })
  }

  const badgeColour = {
    PESTICIDE: 'bg-amber-100 text-amber-700',
    FERTILISER: 'bg-green-100 text-green-700',
    SEED: 'bg-indigo-100 text-indigo-700',
  }[orderType] || 'bg-slate-100 text-[#6B3F1F]'

  function PersonCard({ person, isDealer }: { person: Person; isDealer: boolean }) {
    const lat = isDealer ? person.shop_gps_lat : person.gps_lat
    const lng = isDealer ? person.shop_gps_lng : person.gps_lng
    const highlight = selectedRecipientId === person.user_id
    return (
      <div id={`recipient-${person.user_id}`}
        className={`bg-white rounded-2xl border shadow-sm p-4 transition-all ${
          highlight ? 'border-[#3A7D44] ring-2 ring-[#3A7D44]/30' : 'border-[#DDD0B8]'
        }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-bold text-[#6B3F1F]">{(isDealer ? person.shop_name : null) || person.name || tOrdersCommon('unknownRecipient')}</p>
              {person.is_training_dealer && (
                <span className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full font-medium">{tOrdersCommon('trainingDealerBadge')}</span>
              )}
              {person.is_promoter && (
                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">{tOrdersCommon('promoterBadge')}</span>
              )}
            </div>
            {isDealer && person.name && person.shop_name && (
              <p className="text-xs text-[#7A8C7E]">{person.name}</p>
            )}
            <p className="text-xs text-[#7A8C7E] mt-0.5">{tOrdersCommon('distanceKm', { km: person.distance_km })}</p>
            {isDealer && person.shop_address && (
              <p className="text-xs text-[#7A8C7E] truncate">{person.shop_address}</p>
            )}
            {lat != null && lng != null && (
              <a href={googleMapsDirections(lat, lng)}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[#3A7D44] font-medium mt-1.5">
                <span aria-hidden>📍</span>{tOrdersCommon('map.directionsBtn')}
              </a>
            )}
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            {person.phone && (
              <a href={`tel:${person.phone}`}
                className="text-xs bg-slate-100 text-[#6B3F1F] px-3 py-1.5 rounded-lg text-center font-medium">
                {tOrdersCommon('callBtn')}
              </a>
            )}
            <button onClick={() => requestSendOrder(person, isDealer)}
              disabled={placing === person.user_id}
              className="text-xs text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
              style={{ background: '#3A7D44' }}>
              {placing === person.user_id ? '…' : t('sendOrderBtn')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      {/* 2026-08-12 — Back button returns to Advisory (where the
          farmer entered this flow from). Consistent across all
          pest/fert recipient pickers: back = /advisory. */}
      <PWAHeader title={t('headerTitle')} activeRole="FARMER" back={`/advisory/${subscriptionId}`} />
      <div className="pt-16">
        <ClientCropChip subscriptionId={subscriptionId} />
      </div>
      <div className="pb-24 px-4 max-w-lg mx-auto">
        {/* Order type badge + date range */}
        <div className="mt-4 bg-white rounded-2xl border border-[#DDD0B8] p-4 flex items-center justify-between">
          <div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColour}`}>{orderType}</span>
            <p className="text-xs text-[#7A8C7E] mt-1">{t('itemsToOrder', { count: practiceIds.length })}</p>
          </div>
          {(dateFrom || dateTo) && (
            <p className="text-xs text-[#7A8C7E]">
              {dateFrom && new Date(dateFrom).toLocaleDateString()} {dateTo && `— ${new Date(dateTo).toLocaleDateString()}`}
            </p>
          )}
        </div>

        {/* Batch 9 — locked-brand explainer, same surface as the
            cancel→re-send picker so the farmer's mental model stays
            consistent across both entry points. */}
        {lockedBrandExplainer && (
          <div className="mt-3 bg-purple-50 border border-purple-200 rounded-xl px-3 py-2.5 text-xs text-purple-800 leading-relaxed">
            <p className="font-semibold mb-0.5">{t('brandLockedTitle')}</p>
            <p>{lockedBrandExplainer}</p>
          </div>
        )}

        {/* Location toggle + collapsible map. Only when there's a
            candidate to show. */}
        {(dealers.length + facilitators.length > 0) && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-[#7A8C7E]">{tOrdersCommon('map.locationSourceLabel')}</span>
              <LocationSourceToggle
                source={locSource}
                currentCoords={currentCoords}
                onChange={handleLocationChange}
                busy={refetchingRecipients}
                labels={{
                  profile: tOrdersCommon('map.locationProfile'),
                  current: tOrdersCommon('map.locationCurrent'),
                  requesting: tOrdersCommon('map.locationRequesting'),
                  denied: tOrdersCommon('map.locationDenied'),
                }}
              />
            </div>
            {mapOrigin && mapPoints.length > 0 && (
              <>
                <button
                  onClick={() => setShowMap(v => !v)}
                  className="w-full text-xs text-[#3A7D44] font-medium py-2 rounded-lg border border-[#DDD0B8] bg-white active:bg-[#F7F0E0]">
                  {showMap ? tOrdersCommon('map.hideBtn') : tOrdersCommon('map.showBtn')}
                </button>
                {showMap && (
                  <RecipientMap
                    origin={mapOrigin}
                    points={mapPoints}
                    selectedUserId={selectedRecipientId}
                    onSelect={uid => {
                      setSelectedRecipientId(uid)
                      setTimeout(() => {
                        const el = document.getElementById(`recipient-${uid}`)
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      }, 50)
                    }}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* Tabs — hide the facilitators tab when locked-brand is on. */}
        <div className="flex bg-white rounded-2xl border border-[#DDD0B8] mt-3 p-1">
          {(['dealers', 'facilitators'] as const).map(tabKey => {
            if (tabKey === 'facilitators' && lockedBrandExplainer) return null
            return (
              <button key={tabKey} onClick={() => setTab(tabKey)}
                className={`flex-1 py-2.5 text-sm font-medium rounded-xl capitalize transition-all ${tab === tabKey ? 'bg-green-700 text-white shadow-sm' : 'text-[#7A8C7E]'}`}>
                {tabKey === 'dealers'
                  ? t('tabDealers', { count: dealers.length })
                  : t('tabFacilitators', { count: facilitators.length })}
              </button>
            )
          })}
        </div>

        {/* List */}
        <div className="mt-3 space-y-3">
          {loading ? (
            [1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-2xl animate-pulse" />)
          ) : (tab === 'dealers' ? dealers : facilitators).length === 0 ? (
            <div className="text-center py-12">
              <p className="text-3xl mb-3">{tab === 'dealers' ? '🏪' : '🌾'}</p>
              <p className="text-[#7A8C7E] font-medium">{tab === 'dealers' ? t('emptyDealers') : t('emptyFacilitators')}</p>
              <p className="text-xs text-[#7A8C7E] mt-1">{t('tryPhoneHint')}</p>
            </div>
          ) : (
            (tab === 'dealers' ? dealers : facilitators).map(person => (
              <PersonCard key={person.user_id} person={person} isDealer={tab === 'dealers'} />
            ))
          )}
        </div>

        {/* Phone-entry — primary path the farmer asked for
            2026-06-18. Mirrors the seed-orders picker design via
            the shared RecipientLookupCard. Brand-lock kicks in only
            when at least one of `practice_ids` is on a
            `Practice.is_brand_locked=True` row — the backend
            computes that server-side and returns a
            `dealer_not_onboarded` verdict the card renders. */}
        {!loading && (
          <div className="mt-4 bg-white rounded-2xl border border-[#DDD0B8] p-4">
            <p className="text-xs font-semibold text-[#7A8C7E] mb-2">{t('customPhoneLabel')}</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#7A8C7E] px-2 py-2 bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl">+91</span>
              <input value={customPhone} onChange={e => setCustomPhone(e.target.value)}
                placeholder={t('customPhonePlaceholder')}
                type="tel" inputMode="numeric"
                className="flex-1 min-w-0 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#3A7D44]" />
            </div>
            {lookupLoading && (
              <div className="mt-2 flex items-center gap-2 text-xs text-[#7A8C7E]">
                <div className="w-3 h-3 border-2 border-[#DDD0B8] border-t-[#3A7D44] rounded-full animate-spin" />
                {t('phoneChecking')}
              </div>
            )}
            {lookup && !lookupLoading && (
              <RecipientLookupCard lookup={lookup}
                placing={placing} onSend={startSendOrderFromLookup} t={t} />
            )}
          </div>
        )}
      </div>

      {/* Hard-confirm acreage step (shown only when farm_area_confirmed_at is null) */}
      {confirmStep && sub && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-end" onClick={() => placing == null && setConfirmStep(null)}>
          <div className="bg-white w-full rounded-t-3xl p-5 max-w-lg mx-auto" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F] text-base">{t('confirmAreaTitle')}</p>

            {sub.farm_area_acres != null && !editingArea ? (
              <p className="text-sm text-[#6B3F1F] mt-3">
                <span className="font-semibold">{sub.farm_area_acres} {t('areaUnit')}</span>{' '}
                <button
                  onClick={() => setEditingArea(true)}
                  className="ml-1 text-xs underline text-green-700"
                >{tCommon('change')}</button>
              </p>
            ) : (
              <div className="flex gap-2 mt-3">
                <input
                  type="number" inputMode="decimal" step="0.01" min="0"
                  value={confirmAreaInput}
                  onChange={e => setConfirmAreaInput(e.target.value)}
                  placeholder={t('areaInputPlaceholder')}
                  className="flex-1 min-w-0 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#3A7D44]"
                />
                <span className="flex items-center px-3 py-2 text-sm text-[#6B3F1F] bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl shrink-0">
                  {t('areaUnit')}
                </span>
              </div>
            )}

            <div className="mt-4 bg-orange-50 border border-orange-200 rounded-xl px-3 py-3">
              <p className="text-orange-800 text-xs leading-relaxed">
                <span className="font-bold">{t('finalConfirmPrefix')}</span>{' '}
                {t('finalConfirmMiddle')}{' '}
                <span className="font-bold">{t('finalConfirmSuffix')}</span>
              </p>
            </div>

            {errorMsg && (
              <p className="text-xs text-[#D4682E] mt-3">{errorMsg}</p>
            )}

            <div className="grid grid-cols-2 gap-3 mt-5">
              <button
                onClick={() => { setConfirmStep(null); setErrorMsg(null) }}
                disabled={placing != null}
                className="py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-semibold disabled:opacity-40"
              >{tCommon('cancel')}</button>
              <button
                onClick={confirmAndSend}
                disabled={placing != null}
                className="py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                style={{ background: '#3A7D44' }}
              >{placing != null ? t('sending') : t('confirmAndSend')}</button>
            </div>
          </div>
        </div>
      )}
      <ConfirmSendOrderSheet
        open={!!pendingSendOrder}
        inputType={tOrdersCommon(
          orderType === 'PESTICIDE' ? 'inputType.pesticide'
          : orderType === 'FERTILISER' || orderType === 'FERTILIZER' ? 'inputType.fertilizer'
          : orderType === 'SEED' ? 'inputType.seed'
          : 'inputType.fallback'
        )}
        recipient={recipientLabel(
          pendingSendOrder?.isDealer ?? false,
          pendingSendOrder?.person ?? null,
          tOrdersCommon('unknownRecipient'),
        )}
        busy={placing != null}
        onCancel={() => setPendingSendOrder(null)}
        onConfirm={() => {
          if (pendingSendOrder) {
            const { person, isDealer } = pendingSendOrder
            setPendingSendOrder(null)
            startSendOrder(person, isDealer)
          }
        }}
      />
    </div>
  )
}
