'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import RecipientLookupCard, { type RecipientLookupResult } from '@/components/RecipientLookupCard'
import api from '@/lib/api'

interface OrderDetail {
  id: string; status: string; farmer_user_id: string; client_id: string
  dealer_user_id: string | null; facilitator_user_id: string | null
  date_from: string; date_to: string
  items: { id: string; practice_id: string; status: string; brand_name: string | null
           given_volume: number | null; volume_unit: string | null; price: number | null }[]
  // 2026-06-06 — Packing surface fields so the facilitator can
  // confirm pickup and the farmer can see status.
  packing_code?: string | null
  packing_picked_up_at?: string | null
  packing_picked_up_by_role?: 'FARMER' | 'FACILITATOR' | null
  packing_farmer_received_at?: string | null
}
interface NearbyDealer {
  user_id: string; name: string | null; phone: string | null; shop_name: string | null
  shop_address: string | null; distance_km: number; sell_categories: string[]
}
interface User { id: string; name: string | null; phone: string | null }
interface PackingList {
  order_id: string; farmer_name: string | null; farmer_phone: string | null
  items: { id: string; brand_name: string | null; given_volume: number | null; volume_unit: string | null; price: number | null }[]
  total_amount: number
}

const COLOUR = '#7D4E00'

export default function FacilitatorOrderDetailPage() {
  const t = useTranslations('facilitator.orderDetail')
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [nearbyDealers, setNearbyDealers] = useState<NearbyDealer[]>([])
  const [loading, setLoading] = useState(true)
  const [forwarding, setForwarding] = useState(false)
  const [returning, setReturning] = useState(false)
  const [showDealerSelect, setShowDealerSelect] = useState(false)
  const [loadingDealers, setLoadingDealers] = useState(false)
  const [packingList, setPackingList] = useState<PackingList | null>(null)
  const [showPacking, setShowPacking] = useState(false)
  const [farmer, setFarmer] = useState<User | null>(null)
  const [dealer, setDealer] = useState<User | null>(null)
  const [packingShared, setPackingShared] = useState(false)
  // 2026-06-18 — phone-entry parity with the farmer-side picker.
  // Same debounce + LookupCard shape used everywhere a recipient
  // is chosen by phone.
  const [customPhone, setCustomPhone] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookup, setLookup] = useState<RecipientLookupResult | null>(null)
  const [forwardError, setForwardError] = useState<string | null>(null)

  const load = async () => {
    try {
      const { data } = await api.get<OrderDetail>(`/facilitator/orders/${orderId}`)
      setOrder(data)
      // Load farmer info
      if (data.farmer_user_id) {
        api.get<User>(`/admin/users/${data.farmer_user_id}`).then(r => setFarmer(r.data)).catch(() => {})
      }
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [orderId])

  // Phone-entry debounced lookup. Only active when the bottom
  // sheet is open so we don't waste lookups when the input is
  // hidden.
  useEffect(() => {
    if (!showDealerSelect) return
    const digits = customPhone.replace(/\D/g, '')
    if (digits.length < 10) { setLookup(null); setLookupLoading(false); return }
    setLookupLoading(true)
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get<RecipientLookupResult>(
          `/facilitator/orders/${orderId}/lookup-dealer?phone=${encodeURIComponent('+91' + digits.slice(-10))}`,
        )
        setLookup(data)
      } catch {
        setLookup(null)
      } finally {
        setLookupLoading(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [customPhone, showDealerSelect, orderId])

  async function openDealerSelect() {
    setShowDealerSelect(true)
    setLoadingDealers(true)
    setForwardError(null)
    setCustomPhone('')
    setLookup(null)
    try {
      // Pass order_id so the backend filters dealers by brand-lock.
      // Without this the facilitator was seeing the full
      // onboarded-dealer pool, and only got a 409 at forward time
      // if they picked a non-onboarded one. Mirrors the farmer's
      // brand-lock-aware picker (Point 3a parity, 2026-06-18).
      const { data } = await api.get<NearbyDealer[]>(
        `/facilitator/nearby-dealers?order_id=${encodeURIComponent(orderId)}`,
      )
      setNearbyDealers(data)
    } finally { setLoadingDealers(false) }
  }

  async function forwardToDealer(dealerUserId: string) {
    setForwarding(true)
    setForwardError(null)
    try {
      await api.put(`/facilitator/orders/${orderId}/route-to-dealer`, { dealer_user_id: dealerUserId })
      setShowDealerSelect(false)
      load()
    } catch (e: unknown) {
      // FastAPI detail can be string or {code, message}. Normalise.
      const err = e as { response?: { data?: { detail?: string | { code?: string; message?: string } } } }
      const detail = err.response?.data?.detail
      if (detail && typeof detail === 'object' && detail.code === 'locked_brand_requires_onboarded_dealer') {
        setForwardError(t('brandLockForward'))
      } else {
        const msg =
          typeof detail === 'string'
            ? detail
            : (detail && typeof detail === 'object' && detail.message)
              || t('errorForward')
        setForwardError(msg)
      }
    } finally { setForwarding(false) }
  }

  async function returnToFarmer() {
    if (!confirm(t('returnConfirm'))) return
    setReturning(true)
    try {
      // 2026-06-06 — Backend now cancel-and-migrates: the returned
      // items move to a fresh DRAFT on the farmer's Manage tab. The
      // facilitator's view of this order drops out of the "Returned"
      // pill once we reload.
      await api.put<{ new_draft_order_id?: string }>(`/facilitator/orders/${orderId}/return-to-farmer`, {})
      router.push('/facilitator/orders')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: { message?: string } | string } } }
      const detail = e?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string } | undefined)?.message
      alert(msg || t('errorReturn'))
    } finally { setReturning(false) }
  }

  async function openPacking() {
    const { data } = await api.get<PackingList>(`/dealer/orders/${orderId}/packing-list`).catch(async () => {
      // Try facilitator endpoint fallback — packing list readable by facilitator
      return { data: null }
    })
    if (data) { setPackingList(data); setShowPacking(true) }
  }

  async function markShared() {
    await api.put(`/dealer/orders/${orderId}/packing-list/mark-shared`, {})
    setPackingShared(true)
  }

  // 2026-06-06 — confirm-delivery retired. The order auto-completes
  // when the farmer marks received (mark-received stamps
  // farmer_received_at; backend's _update_order_status flips
  // COMPLETED on the next read). Keeping the function as a no-op
  // would mask the intent; removed.

  if (loading || !order) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#7D4E00] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  // 2026-06-07 — Anti-manipulation rule: only APPROVED items expose
  // brand / qty / cost to the facilitator. Pre-approval all per-item
  // detail is null on the backend; the PWA renders count-only
  // summaries so the facilitator can't peek at what the farmer is
  // about to approve.
  const approvedItems = order.items.filter(i => i.status === 'APPROVED')
  const awaitingApprovalCount = order.items.filter(i => i.status === 'SENT_FOR_APPROVAL').length
  const notAvailableItems = order.items.filter(i => i.status === 'NOT_AVAILABLE')
  const showPackingBand = approvedItems.length > 0 && ['PARTIALLY_APPROVED', 'COMPLETED'].includes(order.status)
  const isCompleted = order.status === 'COMPLETED'

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FACILITATOR" back="/facilitator/orders" />
      <div className="pt-16 pb-24 px-4 space-y-4 max-w-lg mx-auto">

        {/* 2026-06-06 — Packing pickup CTA. Shows when items are
            approved + the facilitator hasn't already marked pickup. */}
        {order.packing_code && approvedItems.length > 0 && (
          <FacilitatorPickupBanner order={order} onPickedUp={load} />
        )}

        {/* Status card */}
        <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] mt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[#7A8C7E]">{t('statusLabel')}</p>
              <p className="font-semibold text-[#6B3F1F]">{order.status.replace(/_/g, ' ')}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[#7A8C7E]">{t('itemsCount', { count: order.items.length })}</p>
              <p className="text-xs text-[#7A8C7E]">{new Date(order.date_from).toLocaleDateString()} — {new Date(order.date_to).toLocaleDateString()}</p>
            </div>
          </div>
        </div>

        {/* 2026-06-07 — Awaiting farmer approval count. Count-only by
            design: facilitator can follow up with the farmer but
            can't peek at brand / qty / cost the dealer submitted. */}
        {awaitingApprovalCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="text-amber-900 font-semibold text-sm">
              {t('awaitingApproval', { count: awaitingApprovalCount })}
            </p>
            <p className="text-xs text-amber-700 mt-1">
              {t('awaitingApprovalHint')}
            </p>
          </div>
        )}

        {/* ── Packing screen: two-band collect + deliver ── */}
        {showPackingBand && (
          <div className="space-y-3">
            {/* Green band — collect from dealer */}
            <div className="rounded-2xl overflow-hidden">
              <div className="px-4 py-3" style={{ background: '#166534' }}>
                <p className="text-white font-bold text-sm">{t('collectFromDealer')}</p>
              </div>
              <div className="bg-green-50 border border-green-200 px-4 py-4 space-y-1">
                {order.dealer_user_id && (
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-green-900">{dealer?.name || t('dealerAssignedFallback')}</p>
                    {dealer?.phone && (
                      <a href={`tel:${dealer.phone}`}
                        className="text-xs bg-green-700 text-white px-3 py-1.5 rounded-lg font-medium">
                        {t('callBtn')}
                      </a>
                    )}
                  </div>
                )}
                <div className="mt-2 space-y-1">
                  {approvedItems.map(item => (
                    <div key={item.id} className="flex items-center justify-between text-sm">
                      <p className="text-green-800">{item.brand_name || t('itemFallback')}</p>
                      {item.given_volume && (
                        <p className="text-green-600">{item.given_volume} {item.volume_unit} {item.price ? `· ₹${item.price}` : ''}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Amber band — deliver to farmer */}
            <div className="rounded-2xl overflow-hidden">
              <div className="px-4 py-3" style={{ background: '#92400e' }}>
                <p className="text-white font-bold text-sm">{t('deliverToFarmer')}</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 px-4 py-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-amber-900">{farmer?.name || t('farmerFallback')}</p>
                  {farmer?.phone && (
                    <a href={`tel:${farmer.phone}`}
                      className="text-xs bg-amber-700 text-white px-3 py-1.5 rounded-lg font-medium">
                      {t('callBtn')}
                    </a>
                  )}
                </div>
                <div>
                  <p className="text-xs text-amber-600 font-semibold mt-1">{t('totalLabel', { amount: approvedItems.reduce((s, i) => s + (i.price || 0), 0) })}</p>
                </div>
              </div>
            </div>

            {/* Packing + delivery actions.
                2026-06-06 — Delivery completion is no longer a
                facilitator button. The order auto-completes when the
                farmer marks received from their side; the
                facilitator's job ends at picking up + handing over.
                The pickup banner (top of page) handles the pickup
                action. */}
            {!isCompleted && (
              <button onClick={openPacking}
                className="w-full py-3.5 rounded-2xl border-2 font-semibold text-sm"
                style={{ borderColor: COLOUR, color: COLOUR }}>
                {t('viewDeliveryList')}
              </button>
            )}
          </div>
        )}

        {/* Forward to dealer */}
        {!order.dealer_user_id && ['ACCEPTED', 'SENT'].includes(order.status) && (
          <button onClick={openDealerSelect}
            className="w-full py-4 rounded-2xl text-white font-semibold text-sm"
            style={{ background: COLOUR }}>
            {t('forwardToDealer')}
          </button>
        )}

        {/* Dealer assigned info */}
        {order.dealer_user_id && order.status !== 'COMPLETED' && !showPackingBand && (
          <div className="bg-sky-50 border border-sky-200 rounded-2xl p-4">
            <p className="text-sky-800 font-semibold text-sm">{t('forwardedTitle')}</p>
            <p className="text-sky-600 text-xs mt-1">{t('forwardedBody')}</p>
          </div>
        )}

        {/* Not available — return to farmer */}
        {notAvailableItems.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <p className="text-red-700 font-semibold text-sm">{t('notAvailableTitle', { count: notAvailableItems.length })}</p>
            <div className="flex gap-2 mt-3">
              <button onClick={openDealerSelect}
                className="flex-1 py-2.5 rounded-xl text-white text-xs font-semibold"
                style={{ background: COLOUR }}>
                {t('tryAnotherDealer')}
              </button>
              <button onClick={returnToFarmer} disabled={returning}
                className="flex-1 py-2.5 rounded-xl border border-red-300 text-[#D4682E] text-xs font-semibold disabled:opacity-50">
                {returning ? t('returning') : t('returnToFarmer')}
              </button>
            </div>
          </div>
        )}

        {isCompleted && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
            <p className="text-emerald-700 font-semibold">{t('completedTitle')}</p>
            <p className="text-emerald-500 text-xs mt-1">{t('completedBody')}</p>
          </div>
        )}
      </div>

      {/* Dealer selection bottom sheet */}
      {showDealerSelect && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setShowDealerSelect(false)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl pb-10 max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#DDD0B8]">
              <p className="font-bold text-[#6B3F1F]">{t('dealerSelectTitle')}</p>
              <button onClick={() => setShowDealerSelect(false)} className="text-[#7A8C7E] text-xl">✕</button>
            </div>
            {/* Phone-entry block — first option above the nearby
                list. Mirrors the farmer-side picker. */}
            <div className="px-5 py-4 border-b border-[#DDD0B8]">
              <p className="text-xs font-semibold text-[#7A8C7E] mb-2">{t('phoneEntryLabel')}</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#7A8C7E] px-2 py-2 bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl">+91</span>
                <input value={customPhone} onChange={e => setCustomPhone(e.target.value)}
                  placeholder={t('phoneEntryPlaceholder')}
                  type="tel" inputMode="numeric"
                  className="flex-1 min-w-0 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#7D4E00]" />
              </div>
              {lookupLoading && (
                <div className="mt-2 flex items-center gap-2 text-xs text-[#7A8C7E]">
                  <div className="w-3 h-3 border-2 border-[#DDD0B8] border-t-[#7D4E00] rounded-full animate-spin" />
                  {t('phoneChecking')}
                </div>
              )}
              {lookup && !lookupLoading && lookup.user_id && (
                <RecipientLookupCard lookup={lookup}
                  placing={forwarding ? lookup.user_id : null}
                  onSend={() => lookup.user_id && forwardToDealer(lookup.user_id)} t={t} />
              )}
              {lookup && !lookupLoading && !lookup.user_id && (
                <RecipientLookupCard lookup={lookup}
                  placing={null} onSend={() => {}} t={t} />
              )}
              {forwardError && (
                <p className="mt-2 text-xs text-red-700">{forwardError}</p>
              )}
            </div>
            {loadingDealers ? (
              <div className="p-8 text-center">
                <div className="w-8 h-8 border-2 border-[#7D4E00] border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : nearbyDealers.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-4xl mb-3">🏪</p>
                <p className="text-[#7A8C7E] font-medium">{t('noDealersFound')}</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {nearbyDealers.map(d => (
                  <div key={d.user_id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="font-semibold text-[#6B3F1F]">{d.shop_name || d.name || t('dealerFallback')}</p>
                        <p className="text-xs text-[#7A8C7E] mt-0.5">{t('kmAway', { km: d.distance_km })}</p>
                        {d.shop_address && <p className="text-xs text-[#7A8C7E]">{d.shop_address}</p>}
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {d.sell_categories.map(c => (
                            <span key={c} className="text-xs bg-slate-100 text-[#7A8C7E] px-1.5 py-0.5 rounded">{c}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        {d.phone && (
                          <a href={`tel:${d.phone}`}
                            className="text-xs bg-slate-100 text-[#6B3F1F] px-3 py-1.5 rounded-lg text-center font-medium">
                            {t('callBtn')}
                          </a>
                        )}
                        <button onClick={() => forwardToDealer(d.user_id)} disabled={forwarding}
                          className="text-xs text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                          style={{ background: COLOUR }}>
                          {forwarding ? '…' : t('forwardBtn')}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Packing list bottom sheet */}
      {showPacking && packingList && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setShowPacking(false)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5 pb-10 max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-bold text-[#6B3F1F] text-base">{t('deliveryListTitle')}</p>
              <button onClick={() => setShowPacking(false)} className="text-[#7A8C7E] text-xl">✕</button>
            </div>
            <div className="space-y-2 mb-4">
              {packingList.items.map((item, i) => (
                <div key={item.id} className="flex justify-between py-2.5 border-b border-[#DDD0B8]">
                  <div>
                    <p className="text-sm font-semibold text-[#6B3F1F]">{item.brand_name || t('itemPositional', { n: i + 1 })}</p>
                    <p className="text-xs text-[#7A8C7E]">{item.given_volume} {item.volume_unit}</p>
                  </div>
                  {item.price && <p className="text-sm font-bold text-[#6B3F1F]">₹{item.price}</p>}
                </div>
              ))}
            </div>
            {packingList.total_amount > 0 && (
              <div className="flex justify-between font-bold text-[#6B3F1F] pt-2">
                <span>{t('totalRow')}</span><span>₹{packingList.total_amount.toFixed(2)}</span>
              </div>
            )}
            {!packingShared && (
              <button onClick={markShared}
                className="w-full mt-4 py-3.5 rounded-2xl text-white font-semibold text-sm"
                style={{ background: COLOUR }}>
                {t('shareDeliveryList')}
              </button>
            )}
            {packingShared && (
              <div className="mt-3 text-center text-xs text-emerald-600 font-medium">{t('shared')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


// 2026-06-06 — Facilitator pickup banner. Three render states:
//   1. Not yet picked up → CTA + confirm sheet.
//   2. Picked up by this facilitator → status + waiting for farmer.
//   3. Farmer received → green confirmation strip.
function FacilitatorPickupBanner({
  order, onPickedUp,
}: {
  order: OrderDetail
  onPickedUp: () => void
}) {
  const t = useTranslations('facilitator.orderDetail.pickupBanner')
  const locale = useLocale()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  async function markPickedUp() {
    setBusy(true)
    try {
      await api.put(`/facilitator/orders/${order.id}/packing-list/mark-picked-up`, {})
      setConfirm(false)
      onPickedUp()
    } catch { alert(t('errorPickup')) }
    finally { setBusy(false) }
  }

  if (order.packing_farmer_received_at) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-xs text-emerald-800">
        {t('farmerConfirmed')}
      </div>
    )
  }

  if (order.packing_picked_up_at) {
    const ts = new Date(order.packing_picked_up_at)
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
        {t('youPickedUp', {
          date: ts.toLocaleDateString(locale, { day: "2-digit", month: "short" }),
          time: ts.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
        })}
      </div>
    )
  }

  return (
    <>
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-3">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-xs text-amber-800 font-medium">{t('pickupTitle')}</p>
          <span className="text-[10px] font-mono tracking-widest bg-amber-600 text-white px-2 py-0.5 rounded-full">
            {order.packing_code}
          </span>
        </div>
        <button onClick={() => setConfirm(true)}
          className="w-full bg-[#7D4E00] text-white text-sm font-semibold py-2.5 rounded-xl">
          {t('pickupCta')}
        </button>
      </div>
      {confirm && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end" onClick={() => setConfirm(false)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: "max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))" }}
            onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">{t('confirmTitle')}</p>
            <p className="text-xs text-[#7A8C7E] mt-2">
              {t('confirmBody')}
            </p>
            <p className="text-xs text-[#6B3F1F] mt-2">
              {t('confirmIdLine')} <strong className="font-mono tracking-widest">{order.packing_code}</strong>
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirm(false)}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl">
                {t('cancel')}
              </button>
              <button onClick={markPickedUp} disabled={busy}
                className="flex-1 bg-[#7D4E00] text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {busy ? "…" : t('confirmCta')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
