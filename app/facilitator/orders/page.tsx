'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

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
  packing_code?: string | null
  packing_picked_up_at?: string | null
  packing_farmer_received_at?: string | null
}

interface NearbyDealer {
  user_id: string; name: string | null; phone: string | null; shop_name: string | null
  shop_address: string | null; distance_km: number; sell_categories: string[]
}

type Pill = 'pending' | 'routed' | 'returned' | 'farmer'

const PILL_LABEL: Record<Pill, string> = {
  pending: 'Pending',
  routed: 'Routed',
  returned: 'Returned',
  farmer: 'With Farmer',
}

function subBelongsTo(o: Order, pill: Pill): boolean {
  const c = o.item_status_counts
  switch (pill) {
    case 'pending':
      return o.status === 'SENT' && !o.dealer_user_id
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

export default function FacilitatorOrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [pill, setPill] = useState<Pill>('pending')
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  const load = () =>
    api.get<Order[]>('/facilitator/orders')
      .then(r => setOrders(r.data))
      .finally(() => setLoading(false))

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [])

  async function accept(id: string) {
    setActing(id)
    try {
      await api.put(`/facilitator/orders/${id}/accept`, {})
      router.push(`/facilitator/orders/${id}`)
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
  async function rerouteToDealer(dealerUserId: string) {
    if (!rerouteOrderId) return
    setRerouting(true)
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
      alert(msg || 'Could not re-route. Please try again.')
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
    const c: Record<Pill, number> = { pending: 0, routed: 0, returned: 0, farmer: 0 }
    for (const list of groups.values()) {
      for (const p of Object.keys(c) as Pill[]) {
        if (list.some(o => subBelongsTo(o, p))) c[p] += 1
      }
    }
    return c
  }, [groups])

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
      <PWAHeader title="Acting as Facilitator" activeRole="FACILITATOR" back="/facilitator/home" />
      <div className="pt-16 pb-20">

        {/* Pill row + History chip */}
        <div className="px-4 pt-3 flex items-center gap-2">
          <div className="flex gap-2 overflow-x-auto flex-1">
            {(Object.keys(PILL_LABEL) as Pill[]).map(p => {
              const active = pill === p
              const n = counts[p]
              return (
                <button key={p} onClick={() => setPill(p)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-[#7D4E00] text-white border-[#7D4E00]'
                      : 'bg-white text-[#6B3F1F] border-[#DDD0B8]'
                  }`}>
                  {PILL_LABEL[p]} · {n}
                </button>
              )
            })}
          </div>
          {/* History chip — Completed + Cancelled live elsewhere */}
          <button onClick={() => router.push('/facilitator/history')}
            className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap bg-white text-[#7A8C7E] border-[#DDD0B8]">
            📁 History
          </button>
        </div>

        <div className="px-4 mt-4 space-y-3 max-w-lg mx-auto">
          {loading ? (
            <div className="h-24 bg-white rounded-2xl animate-pulse" />
          ) : visibleGroups.length === 0 ? (
            <div className="text-center py-20">
              <span className="text-4xl">🌾</span>
              <p className="text-[#7A8C7E] text-sm mt-3">Nothing under {PILL_LABEL[pill]}</p>
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
                onOpenDetail={(id) => router.push(`/facilitator/orders/${id}`)}
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
            <p className="font-bold text-[#6B3F1F]">Reject this order?</p>
            <p className="text-xs text-[#7A8C7E] mt-2">
              The farmer will get a fresh draft on their Manage tab so they
              can send the same items to someone else.
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmReject(null)} disabled={acting === confirmReject}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl disabled:opacity-50">
                Cancel
              </button>
              <button onClick={() => reject(confirmReject)} disabled={acting === confirmReject}
                className="flex-1 bg-red-100 text-[#D4682E] text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {acting === confirmReject ? '…' : 'Yes, reject'}
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
              <p className="font-bold text-[#6B3F1F]">Forward returned items to</p>
              <button onClick={() => !rerouting && setRerouteOrderId(null)} className="text-[#7A8C7E] text-xl">✕</button>
            </div>
            {loadingDealers ? (
              <div className="p-8 text-center">
                <div className="w-8 h-8 border-2 border-[#7D4E00] border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : nearbyDealers.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-4xl mb-3">🏪</p>
                <p className="text-[#7A8C7E] font-medium">No nearby dealers found</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {nearbyDealers.map(d => (
                  <div key={d.user_id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="font-semibold text-[#6B3F1F]">{d.shop_name || d.name || 'Dealer'}</p>
                        <p className="text-xs text-[#7A8C7E] mt-0.5">{d.distance_km} km away</p>
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
                            📞 Call
                          </a>
                        )}
                        <button onClick={() => rerouteToDealer(d.user_id)} disabled={rerouting}
                          className="text-xs text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                          style={{ background: COLOUR }}>
                          {rerouting ? '…' : 'Forward'}
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

      <BottomNav color={COLOUR} activeRole="FACILITATOR" />
    </div>
  )
}


// ── Order-ID grouped card ────────────────────────────────────────────────────

function OrderIdCard({
  orderId, subs, matching, pill, expanded, onToggleExpand,
  onAccept, onReject, onForwardReturned, onOpenDetail, acting,
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
  onOpenDetail: (id: string) => void
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
                onOpenDetail={onOpenDetail}
                acting={acting}
                showSubHeader />
            ))
          : matching.length === 1 && (
              <PillChunk sub={matching[0]} pill={pill}
                onAccept={onAccept} onReject={onReject}
                onForwardReturned={onForwardReturned}
                onOpenDetail={onOpenDetail}
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
  return (
    <div className="px-4 py-3 bg-[#F5F0E8]/40">
      <div className="flex items-start gap-3">
        {head?.farmer_photo_url ? (
          <img src={head.farmer_photo_url} alt={head?.farmer_name || 'Farmer'}
            className="w-10 h-10 rounded-full object-cover border border-[#DDD0B8] shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-[#7D4E00]/10 border border-[#DDD0B8] shrink-0 flex items-center justify-center">
            <span className="text-xs font-bold text-[#7D4E00]">{initials(head?.farmer_name)}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-semibold text-[#6B3F1F] truncate">
              {head?.farmer_name || 'Unknown farmer'}
            </p>
            {head?.farmer_phone && (
              <a href={`tel:${head.farmer_phone}`}
                onClick={e => e.stopPropagation()}
                className="text-[11px] font-semibold text-[#7D4E00] bg-amber-50 px-2 py-0.5 rounded-md shrink-0">
                📞
              </a>
            )}
          </div>
          {head?.crop_name && (
            <p className="text-xs text-[#7A8C7E] truncate">{head.crop_name}</p>
          )}
          <p className="text-[10px] font-mono tracking-wide text-[#7D4E00] mt-0.5">
            {orderId}
          </p>
        </div>
      </div>
      {subCount > 1 && (
        <button onClick={onToggleExpand}
          className="text-[10px] font-semibold text-[#7A8C7E] mt-2 flex items-center gap-1">
          {expanded ? '▾' : '▸'} {subCount} sub-orders
        </button>
      )}
    </div>
  )
}

function PillChunk({
  sub, pill, onAccept, onReject, onForwardReturned, onOpenDetail,
  acting, showSubHeader,
}: {
  sub: Order
  pill: Pill
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onForwardReturned: (id: string) => void
  onOpenDetail: (id: string) => void
  acting: string | null
  showSubHeader?: boolean
}) {
  return (
    <div className="px-4 py-3 space-y-2">
      {showSubHeader && (
        <p className="text-[10px] font-mono tracking-wide text-[#7A8C7E]">
          Sub-order · {new Date(sub.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
        </p>
      )}
      {pill === 'pending' && (
        <>
          <p className="text-xs text-amber-700">
            New order — your call. {sub.item_count} item{sub.item_count === 1 ? '' : 's'}.
          </p>
          <div className="flex gap-2">
            <button onClick={() => onAccept(sub.id)} disabled={acting === sub.id}
              className="flex-1 py-2 rounded-lg text-white text-xs font-semibold disabled:opacity-50"
              style={{ background: COLOUR }}>
              {acting === sub.id ? '…' : '✓ Accept'}
            </button>
            <button onClick={() => onReject(sub.id)} disabled={acting === sub.id}
              className="flex-1 py-2 rounded-lg bg-red-100 text-[#D4682E] text-xs font-semibold disabled:opacity-50">
              ✗ Reject
            </button>
          </div>
        </>
      )}
      {pill === 'routed' && (
        <>
          <RoutedBody sub={sub} onOpenDetail={onOpenDetail} />
          <PostponedStrip sub={sub} />
          <ApprovedHintStrip sub={sub} />
        </>
      )}
      {pill === 'returned' && (
        <>
          <RoutedBody sub={sub} onOpenDetail={onOpenDetail} />
          <div className="bg-amber-50/60 rounded-lg px-3 py-2 flex items-center justify-between gap-2 mt-2">
            <p className="text-xs text-amber-800">
              {sub.item_status_counts?.not_available ?? 0} returned item{(sub.item_status_counts?.not_available ?? 0) === 1 ? '' : 's'}
            </p>
            <button onClick={() => onForwardReturned(sub.id)}
              className="text-xs font-semibold text-amber-800 underline">
              Forward to another dealer
            </button>
          </div>
          <PostponedStrip sub={sub} />
        </>
      )}
      {pill === 'farmer' && (
        <>
          <RoutedBody sub={sub} onOpenDetail={onOpenDetail} />
          <p className="text-xs text-amber-700 font-medium mt-2">
            ⏳ Waiting for farmer to approve {sub.item_status_counts?.sent_for_approval ?? 0} item{(sub.item_status_counts?.sent_for_approval ?? 0) === 1 ? '' : 's'}
          </p>
          <PostponedStrip sub={sub} />
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
  const n = sub.item_status_counts?.postponed ?? 0
  if (n === 0) return null
  return (
    <div className="bg-amber-50/40 rounded-lg px-3 py-2 mt-2">
      <p className="text-xs text-amber-800">
        ⏰ {n} postponed item{n === 1 ? '' : 's'} · dealer is following up
      </p>
    </div>
  )
}

// 2026-06-08 — Approved hint on a Routed card. When items have been
// approved + picked up (or are pending pickup) AND there are still
// non-approved items in play, surface a tiny note so the facilitator
// remembers the partial state.
function ApprovedHintStrip({ sub }: { sub: Order }) {
  const n = sub.item_status_counts?.approved ?? 0
  if (n === 0) return null
  return (
    <p className="text-[10px] text-emerald-700 mt-2">
      ✓ {n} approved item{n === 1 ? '' : 's'} · check Pickup
    </p>
  )
}

function RoutedBody({ sub, onOpenDetail }: { sub: Order; onOpenDetail: (id: string) => void }) {
  const mapsHref = (sub.dealer_shop_gps_lat != null && sub.dealer_shop_gps_lng != null)
    ? `https://maps.google.com/?q=${sub.dealer_shop_gps_lat},${sub.dealer_shop_gps_lng}`
    : null
  return (
    <button onClick={() => onOpenDetail(sub.id)} className="w-full text-left">
      <p className="text-xs font-semibold text-[#6B3F1F] truncate">
        🏪 {sub.dealer_shop_name || sub.dealer_name || 'Dealer assigned'}
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
        <span className="text-[10px] text-[#7A8C7E]">· {sub.item_count} item{sub.item_count === 1 ? '' : 's'}</span>
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
  return (
    <div className="bg-[#F5F0E8]/50 px-4 py-3 border-t border-[#F0E5D0]">
      <p className="text-[10px] font-semibold text-[#7A8C7E] uppercase tracking-wider mb-2">
        All sub-orders ({subs.length})
      </p>
      <div className="space-y-2">
        {subs.map(sub => (
          <button key={sub.id} onClick={() => onOpenDetail(sub.id)}
            className="w-full text-left flex items-center justify-between gap-2 bg-white border border-[#DDD0B8] rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs text-[#6B3F1F] truncate">
                {sub.dealer_shop_name || sub.dealer_name || 'No dealer assigned'}
              </p>
              <p className="text-[10px] text-[#7A8C7E]">
                {new Date(sub.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} · {sub.item_count} item{sub.item_count === 1 ? '' : 's'}
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
