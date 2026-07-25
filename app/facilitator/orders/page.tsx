'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import ConfirmSendOrderSheet, { recipientLabel } from '@/components/ConfirmSendOrderSheet'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

// 2026-06-07 — Order-ID-grouped active feed.
// Spec: one card per Order ID; pills filter by sub-order status;
// per-pill body chunk shows the matching sub-order(s); tap the
// card to expand to the full sub-order list. Completed + Cancelled
// live behind a History header chip, not here.

interface ItemStatusCounts {
  pending: number
  available: number
  postponed: number
  not_available: number
  sent_for_approval: number
  approved: number
  rejected: number
}

interface Order {
  id: string
  status: string
  reference_number: string | null
  // 2026-06-19 — Drives the confirm-forward sheet's inputType label.
  category?: string | null
  farmer_user_id: string
  client_id: string
  dealer_user_id: string | null
  date_from: string
  date_to: string
  created_at: string
  item_count: number
  pending_count: number
  item_status_counts?: ItemStatusCounts
  farmer_name?: string | null
  farmer_phone?: string | null
  farmer_photo_url?: string | null
  dealer_name?: string | null
  dealer_phone?: string | null
  dealer_shop_name?: string | null
  dealer_shop_address?: string | null
  dealer_shop_gps_lat?: number | null
  dealer_shop_gps_lng?: number | null
  crop_name?: string | null
  subscription_id?: string | null
  client_name?: string | null
  // 2026-07-24 — Training Sandbox marker. Drives the "TRAINING"
  // chip on the card + membership of the Training pill.
  client_is_training?: boolean
  packing_code?: string | null
  packing_list_shared_at?: string | null
  packing_picked_up_at?: string | null
  packing_farmer_received_at?: string | null
  // 2026-06-22 — APPROVED items the facilitator will pick up + deliver.
  packing_items?: {
    id: string
    brand_name: string | null
    given_volume: number | null
    volume_unit: string | null
    price: number | null
  }[]
  // 2026-06-22 — Seed-order folding into the unified feed (dealer
  // parity). Seed cards branch downstream for label, pill predicate,
  // and CTA. `crop_cosh_id` + `farm_area_acres` are seed-card body
  // fields; the variety name is intentionally never set on this
  // surface (variety-blind by design).
  is_seed?: boolean
  crop_cosh_id?: string | null
  farm_area_acres?: number | null
}

// 2026-06-22 — Raw payload shape from /facilitator/seed-orders.
interface SeedOrderRaw {
  id: string
  status: string
  reference_number: string | null
  category: string | null
  crop_cosh_id: string | null
  farmer_user_id: string
  farmer_name: string | null
  farmer_phone: string | null
  farmer_photo_url: string | null
  farm_area_acres: number | null
  client_id: string
  client_name: string | null
  dealer_user_id: string | null
  dealer_name: string | null
  created_at: string
}

interface NearbyDealer {
  user_id: string; name: string | null; phone: string | null; shop_name: string | null
  shop_address: string | null; distance_km: number; sell_categories: string[]
}

// 2026-07-24 — 'training' pill added alongside the five real ones.
// Real pills exclude training-client orders; training pill collects
// every training order regardless of status. See dealer/orders for
// the same pattern.
type Pill = 'pending' | 'routed' | 'returned' | 'farmer' | 'pickup' | 'training'

const PILL_LABEL_KEY: Record<Pill, 'pillPending' | 'pillRouted' | 'pillReturned' | 'pillFarmer' | 'pillPickup' | 'pillTraining'> = {
  pending: 'pillPending',
  routed: 'pillRouted',
  returned: 'pillReturned',
  farmer: 'pillFarmer',
  pickup: 'pillPickup',
  training: 'pillTraining',
}

function subBelongsTo(o: Order, pill: Pill): boolean {
  // 2026-06-20 — Defence-in-depth: terminal statuses never on active
  // pills regardless of backend payload. Matches the farmer + dealer
  // guards added 2026-06-20.
  // 2026-06-21 — COMPLETED dropped from the blocklist: when the
  // farmer approves the last item, the order flips to COMPLETED, but
  // the facilitator still has to pick up + deliver. The Pickup pill
  // is the correct surface for that — pill predicate gates further
  // down. Same fix shipped to dealer + farmer earlier today.
  if (['CANCELLED', 'REJECTED', 'REROUTED', 'EXPIRED', 'PURCHASED'].includes(o.status)) {
    return false
  }
  // 2026-07-24 — Training-client orders live exclusively on the
  // Training pill; real pills exclude them. See dealer/orders for
  // the mirror pattern.
  if (pill === 'training') {
    return !!o.client_is_training
  }
  if (o.client_is_training) {
    return false
  }
  // 2026-06-22 — Seed cards branch off the SeedOrderStatus enum.
  // Facilitator's life-cycle in seeds: SENT (accept/reject) →
  // ACCEPTED-no-dealer (forward to dealer) → routed to dealer
  // (read-only). NOT_AVAILABLE / REJECTED / PURCHASED are terminal
  // and already filtered above. Seeds don't appear on returned /
  // farmer / pickup — those stages happen at the dealer.
  if (o.is_seed) {
    switch (pill) {
      case 'pending':
        return ['SENT', 'ACCEPTED'].includes(o.status) && !o.dealer_user_id
      case 'routed':
        return !!o.dealer_user_id
          && !['NOT_AVAILABLE', 'REJECTED', 'PURCHASED', 'CANCELLED', 'REROUTED'].includes(o.status)
      case 'returned':
      case 'farmer':
      case 'pickup':
        return false
    }
  }
  const c = o.item_status_counts
  switch (pill) {
    case 'pending':
      // 2026-06-09 — Two flavors of "needs your call":
      // - SENT + no dealer = fresh from the farmer (Accept / Reject)
      // - ACCEPTED + no dealer = previously accepted but currently
      //   needs a dealer pick. Two ways to land here:
      //   (a) facilitator clicked Accept on a fresh order and is
      //       about to pick a dealer
      //   (b) dealer declined a facilitator-forwarded order →
      //       backend auto-routes it back here (the new order is
      //       ACCEPTED, facilitator preserved, dealer cleared).
      return ['SENT', 'ACCEPTED'].includes(o.status) && !o.dealer_user_id
    case 'routed':
      // 2026-06-08 — Routed = dealer is processing.
      // Includes orders with POSTPONED items even if some items are
      // already APPROVED (those live in /facilitator/pickup; their
      // presence shouldn't hide the order from active). Excludes
      // orders where NA / SFA dominate — those have their own pill.
      // The approved-count check was dropped (was incorrectly making
      // any order with picked-up items disappear from the queue).
      return !!o.dealer_user_id &&
        (c?.pending ?? 0) + (c?.available ?? 0) + (c?.postponed ?? 0) > 0 &&
        (c?.not_available ?? 0) === 0 &&
        (c?.sent_for_approval ?? 0) === 0
    case 'returned':
      return (c?.not_available ?? 0) > 0
    case 'farmer':
      return (c?.sent_for_approval ?? 0) > 0
    case 'pickup':
      // 2026-06-22 — Drop the packing_list_shared_at gate. Match the
      // farmer's Pickup pill behaviour (fires on approved_count alone).
      // Reason: the dealer's "Share Packing List" is a soft formality
      // — once items are APPROVED the dealer can already hand them
      // over physically, and the backend lazy-creates the packing row
      // + code on mark-picked-up. User report 2026-06-22: facilitator
      // saw 0 on Pickup with 3 approved items because the dealer
      // hadn't shared yet, even though physically the items were ready.
      // Two sub-states inside this pill (unchanged):
      //   (a) packing_picked_up_at is null → "Pick up from dealer"
      //       (mark-picked-up CTA)
      //   (b) packing_picked_up_at set, no farmer_received_at → "With
      //       you — deliver to farmer" (info only; farmer's tap is
      //       what closes the order)
      return (c?.approved ?? 0) > 0
        && !o.packing_farmer_received_at
  }
}

const COLOUR = '#7D4E00'

const STATUS_COLOUR: Record<string, string> = {
  SENT: 'bg-purple-100 text-purple-700',
  ACCEPTED: 'bg-sky-100 text-sky-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  SENT_FOR_APPROVAL: 'bg-amber-100 text-amber-700',
  PARTIALLY_APPROVED: 'bg-orange-100 text-orange-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-[#7A8C7E]',
}

function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

// 2026-06-22 — Shape a /facilitator/seed-orders row into the unified
// Order interface so the same OrderIdCard + pill machinery can render
// both flows without per-call branching. Variety-blind: we never
// receive variety_name and never set it. The crop label comes from
// crop_cosh_id via the shared cropDisplayName helper.
function adaptSeedOrder(s: SeedOrderRaw): Order {
  return {
    id: s.id,
    status: s.status,
    reference_number: s.reference_number,
    category: s.category || 'SEED',
    farmer_user_id: s.farmer_user_id,
    client_id: s.client_id,
    dealer_user_id: s.dealer_user_id,
    date_from: s.created_at,
    date_to: s.created_at,
    created_at: s.created_at,
    item_count: 1,
    pending_count: ['SENT', 'ACCEPTED'].includes(s.status) && !s.dealer_user_id ? 1 : 0,
    item_status_counts: {
      pending: 0, available: 0, postponed: 0, not_available: 0,
      sent_for_approval: 0, approved: 0, rejected: 0,
    },
    farmer_name: s.farmer_name,
    farmer_phone: s.farmer_phone,
    farmer_photo_url: s.farmer_photo_url,
    dealer_name: s.dealer_name,
    dealer_phone: null,
    dealer_shop_name: null,
    dealer_shop_address: null,
    dealer_shop_gps_lat: null,
    dealer_shop_gps_lng: null,
    crop_name: s.crop_cosh_id ? cropDisplayName(s.crop_cosh_id) : null,
    subscription_id: null,
    client_name: s.client_name,
    client_is_training: false,
    packing_code: null,
    packing_list_shared_at: null,
    packing_picked_up_at: null,
    packing_farmer_received_at: null,
    is_seed: true,
    crop_cosh_id: s.crop_cosh_id,
    farm_area_acres: s.farm_area_acres,
  }
}

export default function FacilitatorOrdersPage() {
  const router = useRouter()
  const t = useTranslations('facilitator.orders')
  const tOrdersCommon = useTranslations('orders.common')
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  // 2026-06-21 — URL-controllable initial pill so post-action redirects
  // (e.g. after Forward-to-Dealer) can deep-link to a specific pill.
  const search = useSearchParams()
  const initialPill = (search.get('pill') as Pill | null) || 'pending'
  const [pill, setPill] = useState<Pill>(initialPill)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  // 2026-06-22 — Fetch both feeds in parallel and merge into a single
  // chronological timeline. Seed cards are tagged via is_seed for
  // downstream branching (label, pill membership, CTA). Same shape as
  // the dealer parity work shipped 2026-06-19.
  const load = async () => {
    try {
      const [regular, seeds] = await Promise.all([
        api.get<Order[]>('/facilitator/orders').catch(() => ({ data: [] as Order[] })),
        api.get<SeedOrderRaw[]>('/facilitator/seed-orders').catch(() => ({ data: [] as SeedOrderRaw[] })),
      ])
      const merged: Order[] = [
        ...regular.data,
        ...seeds.data.map(adaptSeedOrder),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setOrders(merged)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [])

  async function accept(id: string) {
    setActing(id)
    try {
      await api.put(`/facilitator/orders/${id}/accept`, {})
      // 2026-06-21 — Stay on the Pending pill after accept. The
      // ACCEPTED order remains in Pending (status ACCEPTED + no
      // dealer = "pick a dealer") and renders inline with a
      // "Pick Dealer →" CTA that takes the facilitator to the
      // detail page only when they're actually ready to forward.
      // Pre-fix: router.push to detail page surfaced a "Forward
      // to Dealer" screen that felt like a dead-end legacy view.
      load()
    } finally { setActing(null) }
  }

  // Reject = cancel-and-migrate (backend spins a new DRAFT on the
  // farmer's Manage tab). Confirm sheet at z-[60].
  const [confirmReject, setConfirmReject] = useState<string | null>(null)
  async function reject(id: string) {
    setActing(id)
    try {
      await api.put(`/facilitator/orders/${id}/reject`, {})
      setConfirmReject(null)
      load()
    } finally { setActing(null) }
  }

  // 2026-06-22 — Seed accept/reject, inlined from the retired
  // /facilitator/seed-orders page. Accept keeps the card on the
  // Pending pill (now ACCEPTED + no dealer → "Forward to Dealer" CTA);
  // reject is terminal.
  async function acceptSeed(id: string) {
    setActing(id)
    try {
      await api.put(`/facilitator/seed-orders/${id}/accept`, {})
      load()
    } finally { setActing(null) }
  }
  const [confirmRejectSeedId, setConfirmRejectSeedId] = useState<string | null>(null)
  async function rejectSeed(id: string) {
    setActing(id)
    try {
      await api.put(`/facilitator/seed-orders/${id}/reject`, {})
      setConfirmRejectSeedId(null)
      load()
    } finally { setActing(null) }
  }

  // 2026-06-21 — Pickup pill: facilitator marks "I've picked up the
  // items from the dealer." Uses the same endpoint /facilitator/pickup
  // calls; the order stays on the Pickup pill afterwards (with a
  // "deliver to farmer" message) until the farmer marks received.
  async function markPickedUp(id: string) {
    setActing(id)
    try {
      await api.put(`/facilitator/orders/${id}/packing-list/mark-picked-up`, {})
      load()
    } catch {
      alert(t('pickupErrorMark'))
    } finally { setActing(null) }
  }

  // Returned-items re-route picker.
  const [rerouteOrderId, setRerouteOrderId] = useState<string | null>(null)
  const [nearbyDealers, setNearbyDealers] = useState<NearbyDealer[]>([])
  const [loadingDealers, setLoadingDealers] = useState(false)
  const [rerouting, setRerouting] = useState(false)
  async function openRerouteSheet(orderId: string) {
    setRerouteOrderId(orderId)
    setLoadingDealers(true)
    try {
      const { data } = await api.get<NearbyDealer[]>('/facilitator/nearby-dealers')
      setNearbyDealers(data)
    } catch { setNearbyDealers([]) }
    finally { setLoadingDealers(false) }
  }
  // 2026-06-19 — Confirm-before-reroute. Tap on a dealer row stashes
  // pendingReroute; the sheet asks "Do you wish to send the
  // {inputType} Order to {dealer}?"; confirm fires rerouteToDealer.
  const [pendingReroute, setPendingReroute] = useState<NearbyDealer | null>(null)
  function requestRerouteToDealer(dealer: NearbyDealer) {
    setPendingReroute(dealer)
  }

  async function rerouteToDealer(dealerUserId: string) {
    if (!rerouteOrderId) return
    setRerouting(true)
    setPendingReroute(null)
    try {
      await api.post(`/facilitator/orders/${rerouteOrderId}/reroute-returned`, {
        dealer_user_id: dealerUserId,
      })
      setRerouteOrderId(null)
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: { message?: string } | string } } }
      const detail = e?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string } | undefined)?.message
      alert(msg || t('errorReroute'))
    } finally { setRerouting(false) }
  }

  // 2026-06-07 — Group orders by reference_number (Order ID). Pre-
  // batch-1 rows may have null reference_number; fall back to the
  // row id so the group is still rendered (transient until backfill
  // sweeps catch up).
  const groups = useMemo(() => {
    const map = new Map<string, Order[]>()
    for (const o of orders) {
      const key = o.reference_number || `legacy:${o.id}`
      const list = map.get(key)
      if (list) list.push(o)
      else map.set(key, [o])
    }
    // Sort within each group by created_at ascending so the first
    // sub-order is the original root.
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
    return map
  }, [orders])

  // Pill counts: count GROUPS that have at least one sub-order
  // matching the pill (not raw sub-orders) so the count matches
  // what the user sees rendered.
  const counts: Record<Pill, number> = useMemo(() => {
    const c: Record<Pill, number> = { pending: 0, routed: 0, returned: 0, farmer: 0, pickup: 0, training: 0 }
    for (const list of groups.values()) {
      for (const p of Object.keys(c) as Pill[]) {
        if (list.some(o => subBelongsTo(o, p))) c[p] += 1
      }
    }
    return c
  }, [groups])

  // 2026-07-25 — Fallback when the pill is 'training' but no
  // training orders exist (e.g. session ended mid-page). Mirror
  // of the dealer/orders guard.
  useEffect(() => {
    if (pill === 'training' && counts.training === 0) {
      setPill('pending')
    }
  }, [pill, counts.training])

  const visibleGroups = useMemo(() => {
    const out: { key: string; subs: Order[]; matching: Order[] }[] = []
    for (const [key, list] of groups.entries()) {
      const matching = list.filter(o => subBelongsTo(o, pill))
      if (matching.length > 0) out.push({ key, subs: list, matching })
    }
    // Sort by newest sub-order in the group so the most-recent
    // activity lands at the top of the queue.
    out.sort((a, b) => {
      const aT = Math.max(...a.subs.map(o => new Date(o.created_at).getTime()))
      const bT = Math.max(...b.subs.map(o => new Date(o.created_at).getTime()))
      return bT - aT
    })
    return out
  }, [groups, pill])

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FACILITATOR" back="/facilitator/home" />
      <div className="pt-16 pb-20">

        {/* Pill row + History link. 2026-06-21 — Mirrors the dealer
            feed + farmer Manage tab layout: pills wrap naturally (no
            horizontal scroll, no off-screen pills), History sits
            absolute at row-2 right, aligned with the wrapped pill
            row's empty slot. */}
        <div className="px-4 pt-3">
          <div className="relative">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PILL_LABEL_KEY) as Pill[])
                .filter(p => p !== 'training' || counts.training > 0)
                .map(p => {
                // 2026-07-25 — Training pill hidden entirely when no
                // training orders exist. Real pills always render
                // (a zero there is meaningful signal); Training is
                // opt-in and appears only when a session is going.
                const active = pill === p
                const n = counts[p]
                return (
                  <button key={p} onClick={() => setPill(p)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                      active
                        ? 'bg-[#7D4E00] text-white border-[#7D4E00]'
                        : 'bg-white text-[#6B3F1F] border-[#DDD0B8]'
                    }`}>
                    <span>{t(PILL_LABEL_KEY[p])}</span>
                    <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                      active
                        ? 'bg-white/25 text-white'
                        : n === 0
                          ? 'bg-stone-100 text-[#7A8C7E]'
                          : 'bg-[#7D4E00]/15 text-[#7D4E00]'
                    }`}>{n}</span>
                  </button>
                )
              })}
            </div>
            {/* History — absolute at row-2 right (mirrors the dealer
                feed + farmer Manage). Row 2 typically holds the 5th
                pill alone on a phone-width column, leaving generous
                empty space to the right where History sits. */}
            <button onClick={() => router.push('/facilitator/history')}
              className="absolute top-[40px] right-0 text-xs font-semibold text-[#7A8C7E] active:text-[#7D4E00]">
              {t('history')}
            </button>
          </div>
        </div>

        <div className="px-4 mt-4 space-y-3 max-w-lg mx-auto">
          {loading ? (
            <div className="h-24 bg-white rounded-2xl animate-pulse" />
          ) : visibleGroups.length === 0 ? (
            <div className="text-center py-20">
              <span className="text-4xl">🌾</span>
              <p className="text-[#7A8C7E] text-sm mt-3">{t('emptyInPill', { pill: t(PILL_LABEL_KEY[pill]) })}</p>
            </div>
          ) : (
            visibleGroups.map(({ key, subs, matching }) => (
              <OrderIdCard
                key={key}
                orderId={subs[0]?.reference_number || subs[0]?.id || 'unknown'}
                subs={subs}
                matching={matching}
                pill={pill}
                expanded={expandedGroup === key}
                onToggleExpand={() => setExpandedGroup(expandedGroup === key ? null : key)}
                onAccept={accept}
                onReject={(id) => setConfirmReject(id)}
                onForwardReturned={(id) => openRerouteSheet(id)}
                onMarkPickedUp={markPickedUp}
                onOpenDetail={(id) => router.push(`/facilitator/orders/${id}`)}
                onAcceptSeed={acceptSeed}
                onConfirmRejectSeed={(id) => setConfirmRejectSeedId(id)}
                onForwardSeed={(id) => router.push(`/facilitator/seed-orders/${id}/forward`)}
                acting={acting}
              />
            ))
          )}
        </div>
      </div>

      {/* Reject confirmation sheet */}
      {confirmReject && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end"
          onClick={() => acting !== confirmReject && setConfirmReject(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">{t('rejectSheetTitle')}</p>
            <p className="text-xs text-[#7A8C7E] mt-2">
              {t('rejectSheetBody')}
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmReject(null)} disabled={acting === confirmReject}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl disabled:opacity-50">
                {t('rejectSheetCancel')}
              </button>
              <button onClick={() => reject(confirmReject)} disabled={acting === confirmReject}
                className="flex-1 bg-red-100 text-[#D4682E] text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {acting === confirmReject ? '…' : t('rejectSheetConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Seed reject confirmation sheet — terminal action, so a
          confirm step matches the regular-reject pattern. */}
      {confirmRejectSeedId && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end"
          onClick={() => acting !== confirmRejectSeedId && setConfirmRejectSeedId(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">{t('seedRejectSheetTitle')}</p>
            <p className="text-xs text-[#7A8C7E] mt-2">{t('seedRejectSheetBody')}</p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmRejectSeedId(null)} disabled={acting === confirmRejectSeedId}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl disabled:opacity-50">
                {t('rejectSheetCancel')}
              </button>
              <button onClick={() => rejectSeed(confirmRejectSeedId)} disabled={acting === confirmRejectSeedId}
                className="flex-1 bg-red-100 text-[#D4682E] text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {acting === confirmRejectSeedId ? '…' : t('rejectSheetConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reroute picker */}
      {rerouteOrderId && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end"
          onClick={() => !rerouting && setRerouteOrderId(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl max-h-[80vh] overflow-y-auto"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#DDD0B8]">
              <p className="font-bold text-[#6B3F1F]">{t('rerouteSheetTitle')}</p>
              <button onClick={() => !rerouting && setRerouteOrderId(null)} className="text-[#7A8C7E] text-xl">✕</button>
            </div>
            {loadingDealers ? (
              <div className="p-8 text-center">
                <div className="w-8 h-8 border-2 border-[#7D4E00] border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : nearbyDealers.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-4xl mb-3">🏪</p>
                <p className="text-[#7A8C7E] font-medium">{t('rerouteEmpty')}</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {nearbyDealers.map(d => (
                  <div key={d.user_id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="font-semibold text-[#6B3F1F]">{d.shop_name || d.name || t('dealerAssigned')}</p>
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
                        <button onClick={() => requestRerouteToDealer(d)} disabled={rerouting}
                          className="text-xs text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                          style={{ background: COLOUR }}>
                          {rerouting ? '…' : t('forwardBtn')}
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

      <ConfirmSendOrderSheet
        open={!!pendingReroute}
        inputType={tOrdersCommon(
          (() => {
            const cat = orders.find(o => o.id === rerouteOrderId)?.category
            return cat === 'PESTICIDE' ? 'inputType.pesticide'
              : cat === 'FERTILIZER' || cat === 'FERTILISER' ? 'inputType.fertilizer'
              : 'inputType.fallback'
          })()
        )}
        recipient={recipientLabel(
          true,
          pendingReroute,
          tOrdersCommon('unknownRecipient'),
        )}
        busy={rerouting}
        onCancel={() => setPendingReroute(null)}
        onConfirm={() => {
          if (pendingReroute) rerouteToDealer(pendingReroute.user_id)
        }}
      />
      <BottomNav color={COLOUR} activeRole="FACILITATOR" />
    </div>
  )
}


// ── Order-ID grouped card ────────────────────────────────────────────────────

function OrderIdCard({
  orderId, subs, matching, pill, expanded, onToggleExpand,
  onAccept, onReject, onForwardReturned, onMarkPickedUp, onOpenDetail,
  onAcceptSeed, onConfirmRejectSeed, onForwardSeed, acting,
}: {
  orderId: string
  subs: Order[]
  matching: Order[]
  pill: Pill
  expanded: boolean
  onToggleExpand: () => void
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onForwardReturned: (id: string) => void
  onMarkPickedUp: (id: string) => void
  onOpenDetail: (id: string) => void
  onAcceptSeed: (id: string) => void
  onConfirmRejectSeed: (id: string) => void
  onForwardSeed: (id: string) => void
  acting: string | null
}) {
  // Header data comes from the first sub-order in the group (the
  // farmer + crop are stable across the lineage).
  const head = subs[0]
  // 2026-06-07 — Inline-vs-rows decision: if only one sub-order
  // matches the pill, render its chunk inline. If 2+, render each
  // as a separate row inside the card.
  const renderRows = matching.length > 1

  return (
    <div className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
      <CardHeader head={head} subCount={subs.length} expanded={expanded}
        onToggleExpand={onToggleExpand} orderId={orderId} />
      <div className="divide-y divide-[#F0E5D0]">
        {renderRows
          ? matching.map(sub => (
              <PillChunk key={sub.id} sub={sub} pill={pill}
                onAccept={onAccept} onReject={onReject}
                onForwardReturned={onForwardReturned}
                onMarkPickedUp={onMarkPickedUp}
                onOpenDetail={onOpenDetail}
                onAcceptSeed={onAcceptSeed}
                onConfirmRejectSeed={onConfirmRejectSeed}
                onForwardSeed={onForwardSeed}
                acting={acting}
                showSubHeader />
            ))
          : matching.length === 1 && (
              <PillChunk sub={matching[0]} pill={pill}
                onAccept={onAccept} onReject={onReject}
                onForwardReturned={onForwardReturned}
                onMarkPickedUp={onMarkPickedUp}
                onOpenDetail={onOpenDetail}
                onAcceptSeed={onAcceptSeed}
                onConfirmRejectSeed={onConfirmRejectSeed}
                onForwardSeed={onForwardSeed}
                acting={acting} />
            )
        }
      </div>
      {expanded && (
        <ExpandedSubOrderList subs={subs} onOpenDetail={onOpenDetail} />
      )}
    </div>
  )
}

function CardHeader({
  head, subCount, expanded, onToggleExpand, orderId,
}: {
  head: Order | undefined
  subCount: number
  expanded: boolean
  onToggleExpand: () => void
  orderId: string
}) {
  const t = useTranslations('facilitator.orders')
  return (
    <div className="px-4 py-3 bg-[#F5F0E8]/40">
      <div className="flex items-start gap-3">
        {head?.farmer_photo_url ? (
          <img src={head.farmer_photo_url} alt={head?.farmer_name || t('unknownFarmer')}
            className="w-10 h-10 rounded-full object-cover border border-[#DDD0B8] shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-[#7D4E00]/10 border border-[#DDD0B8] shrink-0 flex items-center justify-center">
            <span className="text-xs font-bold text-[#7D4E00]">{initials(head?.farmer_name)}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-semibold text-[#6B3F1F] truncate">
              {head?.farmer_name || t('unknownFarmer')}
            </p>
            {head?.farmer_phone && (
              <a href={`tel:${head.farmer_phone}`}
                onClick={e => e.stopPropagation()}
                className="text-[11px] font-semibold text-[#7D4E00] bg-amber-50 px-2 py-0.5 rounded-md shrink-0">
                📞
              </a>
            )}
          </div>
          {(head?.crop_name || head?.client_name) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-xs text-[#7A8C7E] truncate">
                {head.crop_name && head.client_name
                  ? `${head.crop_name} · ${head.client_name}`
                  : head.crop_name || head.client_name}
              </p>
              {/* 2026-07-24 — Training marker chip. Visible before
                  tap-Accept so the facilitator knows they're
                  routing a practice order. */}
              {head?.client_is_training && (
                <span className="text-[9px] font-bold uppercase tracking-wider bg-amber-300 text-amber-900 px-1.5 py-0.5 rounded shrink-0">
                  Training
                </span>
              )}
            </div>
          )}
          <p className="text-[10px] font-mono tracking-wide text-[#7D4E00] mt-0.5">
            {orderId}
          </p>
        </div>
      </div>
      {subCount > 1 && (
        <button onClick={onToggleExpand}
          className="text-[10px] font-semibold text-[#7A8C7E] mt-2 flex items-center gap-1">
          {expanded ? '▾' : '▸'} {t('subOrdersToggle', { count: subCount })}
        </button>
      )}
    </div>
  )
}

function PillChunk({
  sub, pill, onAccept, onReject, onForwardReturned, onMarkPickedUp, onOpenDetail,
  onAcceptSeed, onConfirmRejectSeed, onForwardSeed,
  acting, showSubHeader,
}: {
  sub: Order
  pill: Pill
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onForwardReturned: (id: string) => void
  onMarkPickedUp: (id: string) => void
  onOpenDetail: (id: string) => void
  onAcceptSeed: (id: string) => void
  onConfirmRejectSeed: (id: string) => void
  onForwardSeed: (id: string) => void
  acting: string | null
  showSubHeader?: boolean
}) {
  const t = useTranslations('facilitator.orders')
  const locale = useLocale()
  return (
    <div className="px-4 py-3 space-y-2">
      {showSubHeader && (
        <p className="text-[10px] font-mono tracking-wide text-[#7A8C7E]">
          {t('subOrderHeader', { date: new Date(sub.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short' }) })}
        </p>
      )}

      {/* ── Seed-order branches (variety-blind; facilitator-only). ── */}
      {sub.is_seed && pill === 'pending' && sub.status === 'SENT' && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-[#5b3d8a] bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded-full">
              {t('seedTag')}
            </span>
            {sub.farm_area_acres != null && (
              <span className="text-[11px] text-[#7A8C7E]">
                {t('seedFarmArea', { acres: sub.farm_area_acres })}
              </span>
            )}
          </div>
          <p className="text-xs text-amber-700">{t('seedNewOrderHint')}</p>
          <div className="flex gap-2">
            <button onClick={() => onAcceptSeed(sub.id)} disabled={acting === sub.id}
              className="flex-1 py-2 rounded-lg text-white text-xs font-semibold disabled:opacity-50"
              style={{ background: COLOUR }}>
              {acting === sub.id ? '…' : t('acceptCta')}
            </button>
            <button onClick={() => onConfirmRejectSeed(sub.id)} disabled={acting === sub.id}
              className="flex-1 py-2 rounded-lg bg-red-100 text-[#D4682E] text-xs font-semibold disabled:opacity-50">
              {t('rejectCta')}
            </button>
          </div>
        </>
      )}
      {sub.is_seed && pill === 'pending' && sub.status === 'ACCEPTED' && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-[#5b3d8a] bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded-full">
              {t('seedTag')}
            </span>
            {sub.farm_area_acres != null && (
              <span className="text-[11px] text-[#7A8C7E]">
                {t('seedFarmArea', { acres: sub.farm_area_acres })}
              </span>
            )}
          </div>
          <p className="text-xs text-amber-700">{t('seedAcceptedHint')}</p>
          <button onClick={() => onForwardSeed(sub.id)}
            className="w-full py-2 rounded-lg text-white text-xs font-semibold"
            style={{ background: COLOUR }}>
            {t('seedForwardCta')}
          </button>
        </>
      )}
      {sub.is_seed && pill === 'routed' && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-[#5b3d8a] bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded-full">
              {t('seedTag')}
            </span>
            {sub.dealer_name && (
              <span className="text-[11px] text-[#7A8C7E]">
                {t('seedAtDealer', { dealer: sub.dealer_name })}
              </span>
            )}
          </div>
          <p className="text-xs text-[#7A8C7E]">{t('seedRoutedHint')}</p>
        </>
      )}

      {/* ── Regular order branches (unchanged). ── */}
      {!sub.is_seed && pill === 'pending' && sub.status === 'SENT' && (
        <>
          <p className="text-xs text-amber-700">
            {t('newOrderHint', { count: sub.item_count })}
          </p>
          <div className="flex gap-2">
            <button onClick={() => onAccept(sub.id)} disabled={acting === sub.id}
              className="flex-1 py-2 rounded-lg text-white text-xs font-semibold disabled:opacity-50"
              style={{ background: COLOUR }}>
              {acting === sub.id ? '…' : t('acceptCta')}
            </button>
            <button onClick={() => onReject(sub.id)} disabled={acting === sub.id}
              className="flex-1 py-2 rounded-lg bg-red-100 text-[#D4682E] text-xs font-semibold disabled:opacity-50">
              {t('rejectCta')}
            </button>
          </div>
        </>
      )}
      {/* 2026-06-09 — ACCEPTED + no dealer = either the facilitator
          just accepted (about to pick a dealer) OR the previously-
          chosen dealer declined (server auto-routes the items back
          here). Either way: pick a dealer. No Accept/Reject — the
          facilitator already committed. */}
      {!sub.is_seed && pill === 'pending' && sub.status === 'ACCEPTED' && (
        <>
          <p className="text-xs text-amber-700">
            {t('forwardToDealerHint', { count: sub.item_count })}
          </p>
          <p className="text-[11px] text-amber-600 -mt-1">
            {t('tapToPickDealer')}
          </p>
          <button onClick={() => onOpenDetail(sub.id)}
            className="w-full py-2 rounded-lg text-white text-xs font-semibold"
            style={{ background: COLOUR }}>
            {t('pickDealerCta')}
          </button>
        </>
      )}
      {!sub.is_seed && pill === 'routed' && (
        <>
          <RoutedBody sub={sub} onOpenDetail={onOpenDetail} />
          <PostponedStrip sub={sub} />
          <ApprovedHintStrip sub={sub} />
        </>
      )}
      {!sub.is_seed && pill === 'returned' && (
        <>
          <RoutedBody sub={sub} onOpenDetail={onOpenDetail} />
          <div className="bg-amber-50/60 rounded-lg px-3 py-2 flex items-center justify-between gap-2 mt-2">
            <p className="text-xs text-amber-800">
              {t('returnedItemsCount', { count: sub.item_status_counts?.not_available ?? 0 })}
            </p>
            <button onClick={() => onForwardReturned(sub.id)}
              className="text-xs font-semibold text-amber-800 underline">
              {t('forwardReturnedLink')}
            </button>
          </div>
          <PostponedStrip sub={sub} />
        </>
      )}
      {!sub.is_seed && pill === 'farmer' && (
        <>
          <RoutedBody sub={sub} onOpenDetail={onOpenDetail} />
          <p className="text-xs text-amber-700 font-medium mt-2">
            {t('waitingFarmerApproval', { count: sub.item_status_counts?.sent_for_approval ?? 0 })}
          </p>
          <PostponedStrip sub={sub} />
        </>
      )}
      {!sub.is_seed && pill === 'pickup' && (
        <>
          <RoutedBody sub={sub} onOpenDetail={onOpenDetail}
            itemCountOverride={sub.packing_items?.length ?? sub.item_status_counts?.approved ?? 0} />
          <PickupItemsList items={sub.packing_items ?? []} />
          {!sub.packing_picked_up_at ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 mt-2">
              <p className="text-xs text-emerald-900 mb-2">
                {t('pickupBodyFromDealer', {
                  dealer: sub.dealer_shop_name || sub.dealer_name || '—',
                  farmer: sub.farmer_name || '—',
                })}
                {sub.packing_code && (
                  <span className="ml-1 font-mono tracking-widest text-[10px] opacity-80">#{sub.packing_code}</span>
                )}
              </p>
              <button onClick={() => onMarkPickedUp(sub.id)}
                disabled={acting === sub.id}
                className="w-full py-2 rounded-lg text-white text-xs font-semibold disabled:opacity-50"
                style={{ background: COLOUR }}>
                {acting === sub.id ? '…' : t('pickupCta')}
              </button>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 mt-2">
              <p className="text-xs text-amber-900">
                {t('pickupBodyWithYou', { farmer: sub.farmer_name || '—' })}
                {sub.packing_code && (
                  <span className="ml-1 font-mono tracking-widest text-[10px] opacity-80">#{sub.packing_code}</span>
                )}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// 2026-06-08 — Postponed strip. Shown on Routed/Returned/With-Farmer
// chunks when the dealer postponed any items. The facilitator can't
// act here (only the dealer can resolve a postponed item), but they
// need visibility so the order doesn't silently vanish from view.
function PostponedStrip({ sub }: { sub: Order }) {
  const t = useTranslations('facilitator.orders')
  const n = sub.item_status_counts?.postponed ?? 0
  if (n === 0) return null
  return (
    <div className="bg-amber-50/40 rounded-lg px-3 py-2 mt-2">
      <p className="text-xs text-amber-800">
        {t('postponedStrip', { count: n })}
      </p>
    </div>
  )
}

// 2026-06-08 — Approved hint on a Routed card. When items have been
// approved + picked up (or are pending pickup) AND there are still
// non-approved items in play, surface a tiny note so the facilitator
// remembers the partial state.
function ApprovedHintStrip({ sub }: { sub: Order }) {
  const t = useTranslations('facilitator.orders')
  const n = sub.item_status_counts?.approved ?? 0
  if (n === 0) return null
  return (
    <p className="text-[10px] text-emerald-700 mt-2">
      {t('approvedHint', { count: n })}
    </p>
  )
}

// 2026-06-22 — Cross-check list for the facilitator at the dealer's
// shop: brand · qty unit · ₹price for each APPROVED item.
function PickupItemsList({ items }: {
  items: { id: string; brand_name: string | null; given_volume: number | null; volume_unit: string | null; price: number | null }[]
}) {
  if (items.length === 0) return null
  const total = items.reduce((sum, it) => sum + (it.price ?? 0), 0)
  return (
    <div className="mt-2 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 space-y-1">
      {items.map((it, idx) => (
        <div key={it.id} className="flex items-baseline justify-between gap-3 text-[11px]">
          <p className="text-[#6B3F1F] truncate flex-1">
            <span className="text-[#7A8C7E]">{idx + 1}.</span> <span className="font-medium">{it.brand_name || '—'}</span>
            {it.given_volume != null && (
              <span className="text-[#7A8C7E]"> · {it.given_volume}{it.volume_unit ? ` ${it.volume_unit}` : ''}</span>
            )}
          </p>
          {it.price != null && (
            <p className="text-[#6B3F1F] font-semibold shrink-0">₹{it.price.toLocaleString()}</p>
          )}
        </div>
      ))}
      {total > 0 && (
        <div className="flex items-baseline justify-between gap-3 pt-1.5 mt-1 border-t border-stone-200">
          <p className="text-[10px] text-[#7A8C7E] uppercase tracking-wide">Total</p>
          <p className="text-xs font-bold text-[#6B3F1F]">₹{total.toLocaleString()}</p>
        </div>
      )}
    </div>
  )
}

function RoutedBody({ sub, onOpenDetail, itemCountOverride }: {
  sub: Order
  onOpenDetail: (id: string) => void
  itemCountOverride?: number
}) {
  const t = useTranslations('facilitator.orders')
  const mapsHref = (sub.dealer_shop_gps_lat != null && sub.dealer_shop_gps_lng != null)
    ? `https://maps.google.com/?q=${sub.dealer_shop_gps_lat},${sub.dealer_shop_gps_lng}`
    : null
  // 2026-06-22 — Pickup pill passes itemCountOverride = number of
  // approved items (what the facilitator actually picks up), so the
  // "5 items" line doesn't include the 2 NA items.
  const itemCount = itemCountOverride ?? sub.item_count
  return (
    <button onClick={() => onOpenDetail(sub.id)} className="w-full text-left">
      <p className="text-xs font-semibold text-[#6B3F1F] truncate">
        🏪 {sub.dealer_shop_name || sub.dealer_name || t('dealerAssigned')}
      </p>
      {sub.dealer_shop_address && (
        <p className="text-[11px] text-[#7A8C7E] truncate">{sub.dealer_shop_address}</p>
      )}
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        {sub.dealer_phone && (
          <a href={`tel:${sub.dealer_phone}`} onClick={e => e.stopPropagation()}
            className="text-[10px] font-semibold text-[#7D4E00] bg-amber-50 px-2 py-0.5 rounded-md">
            📞 {sub.dealer_phone}
          </a>
        )}
        {mapsHref && (
          <a href={mapsHref} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
            className="text-[10px] font-semibold text-[#085041] bg-emerald-50 px-2 py-0.5 rounded-md">
            🗺️ Maps
          </a>
        )}
        <span className="text-[10px] text-[#7A8C7E]">{t('itemCountInline', { count: itemCount })}</span>
      </div>
    </button>
  )
}

function ExpandedSubOrderList({
  subs, onOpenDetail,
}: {
  subs: Order[]
  onOpenDetail: (id: string) => void
}) {
  const t = useTranslations('facilitator.orders')
  const locale = useLocale()
  return (
    <div className="bg-[#F5F0E8]/50 px-4 py-3 border-t border-[#F0E5D0]">
      <p className="text-[10px] font-semibold text-[#7A8C7E] uppercase tracking-wider mb-2">
        {t('expandedHeader', { count: subs.length })}
      </p>
      <div className="space-y-2">
        {subs.map(sub => (
          <button key={sub.id} onClick={() => onOpenDetail(sub.id)}
            className="w-full text-left flex items-center justify-between gap-2 bg-white border border-[#DDD0B8] rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs text-[#6B3F1F] truncate">
                {sub.dealer_shop_name || sub.dealer_name || t('noDealerAssigned')}
              </p>
              <p className="text-[10px] text-[#7A8C7E]">
                {new Date(sub.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
                {' '}{t('itemCountInline', { count: sub.item_count })}
              </p>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLOUR[sub.status] || 'bg-slate-100 text-[#7A8C7E]'}`}>
              {sub.status.replace(/_/g, ' ')}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
