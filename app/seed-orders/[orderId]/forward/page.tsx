'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import RecipientLookupCard, { type RecipientLookupResult } from '@/components/RecipientLookupCard'
import ConfirmSendOrderSheet, { recipientLabel } from '@/components/ConfirmSendOrderSheet'
import RecipientMap, { type MapPoint } from '@/components/orders/RecipientMap'
import LocationSourceToggle, { type LocationSource } from '@/components/orders/LocationSourceToggle'
import { googleMapsDirections } from '@/lib/directions'
import api from '@/lib/api'
import { digitsOnly } from '@/lib/input-normalization'

// 2026-08-12 — Seed parity of /orders/[id]/forward. Single consistent
// picker surface across all farmer send-order flows: initial composer,
// cancel-migrate, dealer decline, facilitator decline. All roads lead
// here for seed DRAFTs.
//
// Simpler than pest/fert forward: seed is single-variety single-order,
// so there are no returned-vs-postponed items to nudge about. Every
// seed DRAFT that reaches this page is a returned-to-farmer DRAFT
// (is_returned_to_farmer=true), just needing a new recipient. Commit
// goes straight to PUT /farmer/seed-orders/{id}/send.

interface Person {
  user_id: string
  name: string | null
  phone: string | null
  distance_km: number
  is_promoter: boolean
  is_training_dealer?: boolean
  shop_name?: string | null
  shop_address?: string | null
  sell_categories?: string[]
  shop_gps_lat?: number
  shop_gps_lng?: number
  gps_lat?: number
  gps_lng?: number
}

interface EligibleRecipientsResult {
  dealers: Person[]
  facilitators: Person[]
  has_locked_brand: boolean
  locked_brand_explainer: string | null
}

interface ForwardSeedOrder {
  id: string
  status: string
  subscription_id: string
  variety_id: string
  variety_name?: string | null
  unit?: string | null
  quantity?: number | null
  is_returned_to_farmer?: boolean
}

export default function FarmerForwardSeedPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()
  const t = useTranslations('orders.forward')
  const tOrdersCommon = useTranslations('orders.common')
  const [order, setOrder] = useState<ForwardSeedOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [customPhone, setCustomPhone] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookup, setLookup] = useState<RecipientLookupResult | null>(null)

  const [tab, setTab] = useState<'dealers' | 'facilitators'>('dealers')
  const [dealers, setDealers] = useState<Person[]>([])
  const [facilitators, setFacilitators] = useState<Person[]>([])
  const [lockedBrandExplainer, setLockedBrandExplainer] = useState<string | null>(null)

  const [locSource, setLocSource] = useState<LocationSource>('profile')
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [showMap, setShowMap] = useState(false)
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null)
  const [refetchingRecipients, setRefetchingRecipients] = useState(false)

  const backHref = order?.subscription_id
    ? `/crop-detail/${order.subscription_id}/orders?tab=manage`
    : '/orders'
  // 2026-08-12 — Header back button targets the seed varieties list
  // (where the farmer entered the seed-order flow from). Consistent
  // across all seed recipient pickers per user direction.
  const escapeHref = order?.subscription_id
    ? `/subscribe/seed-varieties/${order.subscription_id}`
    : '/orders'

  function buildRecipientsUrl(coords?: { lat: number; lng: number } | null): string {
    const base = `/farmer/seed-orders/${orderId}/eligible-recipients`
    return coords ? `${base}?lat=${coords.lat}&lng=${coords.lng}` : base
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    Promise.allSettled([
      api.get<ForwardSeedOrder>(`/farmer/seed-orders/${orderId}`),
      api.get<EligibleRecipientsResult>(buildRecipientsUrl()),
    ]).then(([orderRes, eligibleRes]) => {
      if (orderRes.status === 'fulfilled') {
        setOrder(orderRes.value.data)
      } else {
        const err = orderRes.reason as { response?: { data?: { detail?: string | { message?: string } } } }
        const detail = err.response?.data?.detail
        setLoadError(
          typeof detail === 'string'
            ? detail
            : (detail && typeof detail === 'object' && detail.message)
              || t('errorLoad')
        )
      }
      if (eligibleRes.status === 'fulfilled') {
        setDealers(eligibleRes.value.data.dealers || [])
        setFacilitators(eligibleRes.value.data.facilitators || [])
        setLockedBrandExplainer(eligibleRes.value.data.locked_brand_explainer)
        if (eligibleRes.value.data.has_locked_brand) setTab('dealers')
      }
    }).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, router])

  // Debounced phone-entry lookup — seed lookup wants variety_id.
  useEffect(() => {
    if (!order?.variety_id) return
    const digits = customPhone.replace(/\D/g, '')
    if (digits.length < 10) { setLookup(null); setLookupLoading(false); return }
    setLookupLoading(true)
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get<RecipientLookupResult>(
          `/farmer/seed-orders/lookup-recipient?phone=${encodeURIComponent('+91' + digits.slice(-10))}&variety_id=${encodeURIComponent(order.variety_id)}`,
        )
        setLookup(data)
      } catch {
        setLookup(null)
      } finally {
        setLookupLoading(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [customPhone, order?.variety_id])

  const [pendingForward, setPendingForward] = useState<{
    user_id: string
    name: string | null
    phone: string | null
    isDealer: boolean
  } | null>(null)

  function startSendFromLookup() {
    if (!lookup?.found || !lookup.user_id || !lookup.can_receive || !lookup.role) return
    if (!order) return
    setPendingForward({
      user_id: lookup.user_id,
      name: lookup.name ?? null,
      phone: lookup.phone ?? null,
      isDealer: lookup.role === 'DEALER',
    })
  }

  function startSendFromList(person: Person, isDealer: boolean) {
    if (!order) return
    setPendingForward({
      user_id: person.user_id,
      name: (isDealer ? person.shop_name : null) || person.name || null,
      phone: person.phone,
      isDealer,
    })
  }

  async function commitForward() {
    if (!order || !pendingForward) return
    setSending(true)
    const target = pendingForward
    setPendingForward(null)
    try {
      const payload = target.isDealer
        ? { dealer_user_id: target.user_id }
        : { facilitator_user_id: target.user_id }
      await api.put(`/farmer/seed-orders/${order.id}/send`, payload)
      router.replace(backHref)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string | { message?: string } } } }
      const detail = e?.response?.data?.detail
      const msg =
        typeof detail === 'object' && detail !== null && detail.message
          ? detail.message
          : (typeof detail === 'string' ? detail : null)
      alert(msg || tOrdersCommon('errors.forwardFailed'))
      setSending(false)
    }
  }

  async function handleLocationChange(next: LocationSource, coords?: { lat: number; lng: number }) {
    setLocSource(next)
    if (next === 'current' && coords) {
      setCurrentCoords(coords)
    }
    const useCoords = next === 'current' ? (coords || currentCoords) : null
    setRefetchingRecipients(true)
    try {
      const { data } = await api.get<EligibleRecipientsResult>(buildRecipientsUrl(useCoords))
      setDealers(data.dealers || [])
      setFacilitators(data.facilitators || [])
      setSelectedRecipientId(null)
    } catch {
      // Fetch failed — leave previous list.
    } finally {
      setRefetchingRecipients(false)
    }
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
        user_id: p.user_id,
        name: p.name,
        shop_name: p.shop_name || null,
        lat, lng,
        distance_km: p.distance_km,
      })
    }
    return acc
  }, [])

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
              <a
                href={googleMapsDirections(lat, lng)}
                target="_blank"
                rel="noopener noreferrer"
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
            <button onClick={() => startSendFromList(person, isDealer)}
              disabled={sending}
              className="text-xs text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
              style={{ background: '#3A7D44' }}>
              {t('sendOrder')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title={t('headerTitle')} activeRole="FARMER" back={escapeHref} />
        <div className="pt-16 px-4 mt-4 max-w-lg mx-auto">
          <div className="bg-white border border-[#DDD0B8] rounded-2xl p-6 text-center">
            <p className="text-3xl mb-2">📦</p>
            <p className="text-sm font-semibold text-[#6B3F1F] mb-1">{t('errorTitle')}</p>
            <p className="text-xs text-[#7A8C7E] mb-4">{loadError}</p>
            <button onClick={() => router.replace(backHref)}
              className="w-full py-2.5 rounded-xl bg-[#3A7D44] text-white text-sm font-semibold">
              {t('backToManage')}
            </button>
          </div>
        </div>
      </div>
    )
  }
  if (loading || !order) {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title={t('headerTitle')} activeRole="FARMER" back="/orders" />
        <div className="pt-16 px-4 mt-4">
          <div className="h-28 bg-white/60 rounded-2xl animate-pulse" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FARMER" back={escapeHref} />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">

        <p className="text-xs text-[#7A8C7E] mt-4 mb-3 leading-relaxed">
          Pick a dealer or facilitator to send{' '}
          <strong className="text-[#6B3F1F]">{order.variety_name || 'this seed order'}</strong> to.
        </p>

        {(dealers.length + facilitators.length > 0) && (
          <div className="mb-3 space-y-2">
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

        {lockedBrandExplainer && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl px-3 py-2.5 text-xs text-purple-800 leading-relaxed mb-3">
            <p className="font-semibold mb-0.5">{t('brandLockedTitle')}</p>
            <p>{lockedBrandExplainer}</p>
          </div>
        )}
        <div className="flex bg-white rounded-2xl border border-[#DDD0B8] mb-3 p-1">
          {(['dealers', 'facilitators'] as const).map(tabKey => (
            <button key={tabKey} onClick={() => setTab(tabKey)}
              className={`flex-1 py-2.5 text-sm font-medium rounded-xl capitalize transition-all ${tab === tabKey ? 'bg-green-700 text-white shadow-sm' : 'text-[#7A8C7E]'}`}>
              {tabKey === 'dealers'
                ? tOrdersCommon('tabDealers', { count: dealers.length })
                : tOrdersCommon('tabFacilitators', { count: facilitators.length })}
            </button>
          ))}
        </div>
        <div className="space-y-3 mb-3">
          {(tab === 'dealers' ? dealers : facilitators).length === 0 ? (
            <div className="text-center py-8 bg-white rounded-2xl border border-[#DDD0B8]">
              <p className="text-2xl mb-2">{tab === 'dealers' ? '🏪' : '🌾'}</p>
              <p className="text-[#7A8C7E] font-medium text-sm">
                {tab === 'dealers' ? tOrdersCommon('emptyDealers') : tOrdersCommon('emptyFacilitators')}
              </p>
              <p className="text-xs text-[#7A8C7E] mt-1">{tOrdersCommon('tryPhoneHint')}</p>
            </div>
          ) : (
            (tab === 'dealers' ? dealers : facilitators).map(person => (
              <PersonCard key={person.user_id} person={person} isDealer={tab === 'dealers'} />
            ))
          )}
        </div>

        <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4">
          <p className="text-xs font-semibold text-[#7A8C7E] mb-2">{t('customPhoneLabel')}</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#7A8C7E] px-2 py-2 bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl">+91</span>
            <input value={customPhone} onChange={e => setCustomPhone(digitsOnly(e.target.value, 10))}
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
              placing={sending ? 'sending' : null} onSend={startSendFromLookup} t={t} />
          )}
        </div>
      </div>

      <ConfirmSendOrderSheet
        open={!!pendingForward}
        inputType={tOrdersCommon('inputType.seed')}
        recipient={recipientLabel(
          pendingForward?.isDealer ?? false,
          pendingForward ? { name: pendingForward.name } : null,
          tOrdersCommon('unknownRecipient'),
        )}
        busy={sending}
        onCancel={() => setPendingForward(null)}
        onConfirm={commitForward}
      />
    </div>
  )
}
