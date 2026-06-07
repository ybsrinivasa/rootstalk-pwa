'use client'
import { useState, useEffect, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

// 2026-06-05 — Dealer orders feed restructured by ACTION pill rather
// than raw order-status: Pending / Postponed / With Farmer / Packing
// / Completed. Each pill answers "what does the dealer need to do
// with these orders right now?". Backend ships per-status item
// counts + packing items so the PWA can filter and render without
// extra round-trips.

interface PackingItem {
  id: string
  brand_name: string | null
  manufacturer_name: string | null
  given_volume: number | null
  volume_unit: string | null
  price: number | null
}

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
  // 2026-06-07 — Human-readable Order ID shared across the lineage.
  reference_number: string | null
  farmer_user_id: string
  farmer_name: string | null
  farmer_phone: string | null
  farmer_photo_url: string | null
  farmer_gps_lat: number | null
  farmer_gps_lng: number | null
  facilitator_user_id: string | null
  facilitator_name: string | null
  facilitator_phone: string | null
  client_id: string
  client_name: string | null
  category: string | null
  date_from: string
  date_to: string
  created_at: string
  item_status_counts: ItemStatusCounts
  packing_items: PackingItem[]
  packing_code: string | null
  packing_list_shared_at: string | null
  packing_list_removed_at: string | null
  // 2026-06-06 — Pickup + farmer-received tracking. Renders the
  // status line under the contact chips on the Packing card.
  packing_picked_up_at: string | null
  packing_picked_up_by_role: 'FARMER' | 'FACILITATOR' | null
  packing_picked_up_by_name: string | null
  packing_farmer_received_at: string | null
  // 2026-06-06 — Discriminator for seed orders folded into the
  // unified feed. Seed cards carry the variety + crop_cosh_id used
  // for the seed-specific label and route to /dealer/seed-orders
  // for the action surface (no per-id seed page yet).
  is_seed?: boolean
  variety_name?: string | null
  crop_cosh_id?: string | null
}

// 2026-06-06 — Raw shape from /dealer/seed-orders before adapter.
interface SeedOrderRaw {
  id: string
  status: string
  category: string | null
  variety_name: string | null
  crop_cosh_id: string | null
  farmer_user_id: string
  farmer_name: string | null
  farmer_phone: string | null
  farmer_photo_url: string | null
  client_id: string
  client_name: string | null
  unit: string | null
  quantity: number | null
  total_price: number | null
  created_at: string
}

type Pill = 'pending' | 'postponed' | 'farmer' | 'packing' | 'completed'

const PILL_LABEL: Record<Pill, string> = {
  pending: 'Pending',
  postponed: 'Postponed',
  farmer: 'With Farmer',
  packing: 'Packing',
  completed: 'Completed',
}

function initials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

function shortDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

// Per-pill membership rules. An order can appear in multiple pills
// when it has items in multiple buckets — e.g. some Approved (Packing)
// + some Postponed (Postponed) — because the dealer's next action
// depends on which bucket they're focusing on.
function belongsTo(o: Order, pill: Pill): boolean {
  // 2026-06-06 — Seed orders use the SeedOrderStatus enum directly
  // (no per-item counts) since each seed order has one item by
  // definition. Membership is keyed off o.status alone.
  if (o.is_seed) {
    switch (pill) {
      case 'pending':
        return ['SENT', 'ACCEPTED'].includes(o.status)
      case 'postponed':
        return o.status === 'POSTPONED'
      case 'farmer':
        return o.status === 'SENT_FOR_APPROVAL'
      case 'packing':
        // Seeds don't have a packing-list surface yet — treat
        // PURCHASED as the equivalent terminal-with-receipt state.
        return false
      case 'completed':
        return ['PURCHASED', 'CANCELLED', 'REJECTED', 'REROUTED', 'NOT_AVAILABLE'].includes(o.status)
    }
  }
  const c = o.item_status_counts
  switch (pill) {
    case 'pending':
      // Hasn't been submitted: still in SENT / ACCEPTED / PROCESSING.
      return ['SENT', 'ACCEPTED', 'PROCESSING'].includes(o.status)
    case 'postponed':
      return c.postponed > 0
    case 'farmer':
      return c.sent_for_approval > 0
    case 'packing':
      // 2026-06-06 — Order leaves Packing when EITHER the dealer
      // removed it manually OR the farmer confirmed receipt. Either
      // signals "done from the dealer's standpoint".
      return c.approved > 0 && !o.packing_list_removed_at && !o.packing_farmer_received_at
    case 'completed':
      return (
        c.pending === 0 && c.available === 0 && c.postponed === 0 &&
        c.sent_for_approval === 0 &&
        (c.approved === 0 || !!o.packing_list_removed_at || !!o.packing_farmer_received_at)
      )
  }
}

// 2026-06-06 — Adapter: shape a /dealer/seed-orders row into the
// unified Order interface so the same OrderHeaderRow + pill-routing
// machinery handles both flows without per-call branching.
function adaptSeedOrder(s: SeedOrderRaw): Order {
  return {
    id: s.id,
    status: s.status,
    // Seed orders don't carry an Order ID in V1 (Batch 1 covers
    // app/modules/orders only). When seed-order parity ships, this
    // will surface like the regular ID.
    reference_number: null,
    farmer_user_id: s.farmer_user_id,
    farmer_name: s.farmer_name,
    farmer_phone: s.farmer_phone,
    farmer_photo_url: s.farmer_photo_url,
    farmer_gps_lat: null,
    farmer_gps_lng: null,
    facilitator_user_id: null,
    facilitator_name: null,
    facilitator_phone: null,
    client_id: s.client_id,
    client_name: s.client_name,
    category: s.category || 'SEED',
    date_from: s.created_at,
    date_to: s.created_at,
    created_at: s.created_at,
    // Empty placeholder — seed orders aren't multi-item; the
    // belongsTo() guard above short-circuits before these are read.
    item_status_counts: {
      pending: 0, available: 0, postponed: 0, not_available: 0,
      sent_for_approval: 0, approved: 0, rejected: 0,
    },
    packing_items: [],
    packing_code: null,
    packing_list_shared_at: null,
    packing_list_removed_at: null,
    packing_picked_up_at: null,
    packing_picked_up_by_role: null,
    packing_picked_up_by_name: null,
    packing_farmer_received_at: null,
    is_seed: true,
    variety_name: s.variety_name,
    crop_cosh_id: s.crop_cosh_id,
  }
}

export default function DealerOrdersPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F5F0E8]" />}>
      <DealerOrdersInner />
    </Suspense>
  )
}

function DealerOrdersInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialPill = (searchParams.get('pill') as Pill) || 'pending'
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [pill, setPill] = useState<Pill>(initialPill)
  // Local state for share/remove busy spinners + the confirm-remove
  // sheet payload.
  const [confirmRemove, setConfirmRemove] = useState<Order | null>(null)
  // 2026-06-06 — Re-share confirmation. First share is friction-free;
  // subsequent shares show a warning about duplicate-delivery risk.
  const [confirmReshare, setConfirmReshare] = useState<Order | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      // 2026-06-06 — Fetch both feeds in parallel and merge into a
      // single chronological timeline. Seed cards are tagged via
      // is_seed for downstream branching (label, route, pill rules).
      const [regular, seeds] = await Promise.all([
        api.get<Order[]>('/dealer/orders').catch(() => ({ data: [] as Order[] })),
        api.get<SeedOrderRaw[]>('/dealer/seed-orders').catch(() => ({ data: [] as SeedOrderRaw[] })),
      ])
      const merged: Order[] = [
        ...regular.data,
        ...seeds.data.map(adaptSeedOrder),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setOrders(merged)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [])

  const counts: Record<Pill, number> = useMemo(() => {
    const c: Record<Pill, number> = {
      pending: 0, postponed: 0, farmer: 0, packing: 0, completed: 0,
    }
    for (const o of orders) {
      for (const p of Object.keys(c) as Pill[]) {
        if (belongsTo(o, p)) c[p] += 1
      }
    }
    return c
  }, [orders])

  const visible = orders.filter(o => belongsTo(o, pill))

  function buildShareText(o: Order): string {
    // Structured for legibility on WhatsApp / SMS.
    const orderDate = new Date(o.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    const lines: string[] = []
    lines.push('*Packing List*')
    if (o.packing_code) lines.push(`Packing ID: *${o.packing_code}*`)
    lines.push(`Order date: ${orderDate}`)
    lines.push('')
    lines.push(`Farmer: ${o.farmer_name || 'Unknown'}`)
    if (o.farmer_phone) lines.push(`Farmer phone: ${o.farmer_phone}`)
    if (o.farmer_gps_lat != null && o.farmer_gps_lng != null) {
      lines.push(`Location: https://maps.google.com/?q=${o.farmer_gps_lat},${o.farmer_gps_lng}`)
    }
    if (o.facilitator_name || o.facilitator_phone) {
      lines.push('')
      lines.push(`Facilitator: ${o.facilitator_name || ''}`.trim())
      if (o.facilitator_phone) lines.push(`Facilitator phone: ${o.facilitator_phone}`)
    }
    if (o.client_name) {
      lines.push('')
      lines.push(`Company: ${o.client_name}`)
    }
    lines.push('')
    lines.push('Items:')
    let total = 0
    for (const it of o.packing_items) {
      const qty = it.given_volume != null ? ` · ${it.given_volume} ${it.volume_unit || ''}`.trim() : ''
      const price = it.price != null ? ` · ₹${it.price}` : ''
      const mfr = it.manufacturer_name ? ` (${it.manufacturer_name})` : ''
      lines.push(`• ${it.brand_name || 'Item'}${mfr}${qty}${price}`)
      if (it.price) total += it.price
    }
    lines.push('')
    lines.push(`*Total: ₹${total.toLocaleString('en-IN')}*`)
    return lines.join('\n')
  }

  async function shareOrder(o: Order) {
    setBusy(o.id)
    setConfirmReshare(null)
    try {
      // 2026-06-06 — Call mark-shared FIRST so the backend lazy-creates
      // the PackingList row and stamps a packing_code. We use the
      // returned code to compose the share text — earlier flow had the
      // code only after the share was done, so the first share went
      // out without the ID.
      const { data } = await api.put<{
        packing_code: string | null
        first_shared_at: string | null
      }>(`/dealer/orders/${o.id}/packing-list/mark-shared`, {})
      const code = data.packing_code || o.packing_code || null
      const text = buildShareText({ ...o, packing_code: code })

      const navigatorAny = navigator as Navigator & { share?: (data: ShareData) => Promise<void> }
      if (navigatorAny.share) {
        try {
          await navigatorAny.share({ title: 'Packing list', text })
        } catch { /* user cancelled */ }
      } else {
        await navigator.clipboard?.writeText(text)
        alert('Copied to clipboard — paste into your messenger.')
      }
      await load()
    } finally { setBusy(null) }
  }

  function onSharePressed(o: Order) {
    // First share is friction-free; subsequent shares warn about
    // duplicate-delivery risk per user direction 2026-06-06.
    if (o.packing_list_shared_at) {
      setConfirmReshare(o)
      return
    }
    void shareOrder(o)
  }

  async function removeOrder(o: Order) {
    setBusy(o.id)
    try {
      await api.put(`/dealer/orders/${o.id}/packing-list/remove`, {})
      setConfirmRemove(null)
      await load()
    } finally { setBusy(null) }
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Orders" activeRole="DEALER" back="/dealer/home" />
      <div className="pt-16 pb-20">

        {/* Pill row */}
        <div className="px-4 pt-3 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {(Object.keys(PILL_LABEL) as Pill[]).map(p => {
              const active = pill === p
              const n = counts[p]
              return (
                <button key={p} onClick={() => setPill(p)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-[#085041] text-white border-[#085041]'
                      : 'bg-white text-[#6B3F1F] border-[#DDD0B8]'
                  }`}>
                  {PILL_LABEL[p]} · {n}
                </button>
              )
            })}
          </div>
        </div>

        <div className="px-4 mt-4 space-y-3">
          {loading ? (
            <div className="h-28 bg-white rounded-2xl animate-pulse" />
          ) : visible.length === 0 ? (
            <div className="text-center py-20">
              <span className="text-5xl">📋</span>
              <p className="text-[#7A8C7E] text-sm mt-3">
                Nothing under {PILL_LABEL[pill]}
              </p>
            </div>
          ) : (
            visible.map(order => {
              if (pill === 'packing') {
                return <PackingCard key={order.id} order={order}
                  onShare={() => onSharePressed(order)}
                  onRemove={() => setConfirmRemove(order)}
                  busy={busy === order.id} />
              }
              if (pill === 'postponed') {
                return (
                  <button key={order.id} onClick={() => router.push('/dealer/postponed')}
                    className="w-full bg-white rounded-2xl p-4 border border-amber-200 shadow-sm text-left active:scale-[0.99] transition-transform">
                    <OrderHeaderRow order={order} />
                    <p className="text-[11px] text-amber-700 font-medium mt-2">
                      {order.item_status_counts.postponed} postponed item{order.item_status_counts.postponed === 1 ? '' : 's'} · tap to resolve
                    </p>
                  </button>
                )
              }
              if (pill === 'farmer') {
                return (
                  <div key={order.id} className="bg-white rounded-2xl p-4 border border-amber-200 shadow-sm">
                    <OrderHeaderRow order={order} />
                    <p className="text-[11px] text-amber-700 font-medium mt-2">
                      Waiting for farmer to approve {order.item_status_counts.sent_for_approval} item{order.item_status_counts.sent_for_approval === 1 ? '' : 's'}
                    </p>
                  </div>
                )
              }
              if (pill === 'completed') {
                return (
                  <div key={order.id} className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm opacity-90">
                    <OrderHeaderRow order={order} />
                    <p className="text-[11px] text-[#7A8C7E] mt-2">
                      Completed · {order.item_status_counts.approved} sold
                      {order.item_status_counts.not_available > 0 && `, ${order.item_status_counts.not_available} unavailable`}
                    </p>
                  </div>
                )
              }
              // Pending — original card pattern, tappable to detail.
              // 2026-06-06 — Seed cards route to /dealer/seed-orders
              // (the list page; no per-id seed page exists yet).
              const target = order.is_seed
                ? '/dealer/seed-orders'
                : `/dealer/orders/${order.id}`
              return (
                <button key={order.id} onClick={() => router.push(target)}
                  className="w-full bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left active:scale-[0.99] transition-transform">
                  <OrderHeaderRow order={order} />
                  <p className="text-[11px] text-[#7A8C7E] mt-2">
                    {order.status === 'SENT' && 'New · tap to accept'}
                    {order.status === 'ACCEPTED' && (order.is_seed ? 'Accepted · tap to enter qty + price' : 'Accepted · tap to process')}
                    {order.status === 'PROCESSING' && 'Processing · tap to continue'}
                  </p>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Re-share warning sheet */}
      {confirmReshare && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end" onClick={() => setConfirmReshare(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">Share again?</p>
            <p className="text-xs text-amber-700 mt-2">
              This packing list was already shared
              {confirmReshare.packing_list_shared_at && (
                <span>
                  {' at '}
                  <strong>
                    {new Date(confirmReshare.packing_list_shared_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    {' on '}
                    {new Date(confirmReshare.packing_list_shared_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </strong>
                </span>
              )}. Re-sharing could lead to duplicate deliveries — only do this
              if the first share didn&apos;t reach the recipient.
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmReshare(null)}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl">
                Cancel
              </button>
              <button onClick={() => shareOrder(confirmReshare)} disabled={busy === confirmReshare.id}
                className="flex-1 bg-amber-600 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {busy === confirmReshare.id ? '…' : 'Yes, share again'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove-confirm sheet */}
      {confirmRemove && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end" onClick={() => setConfirmRemove(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">Remove from Packing?</p>
            <p className="text-xs text-[#7A8C7E] mt-2">
              The order will move to Completed. You won&apos;t see it here again
              unless something on it reopens. History stays intact.
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmRemove(null)}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl">
                Cancel
              </button>
              <button onClick={() => removeOrder(confirmRemove)} disabled={busy === confirmRemove.id}
                className="flex-1 bg-red-100 text-[#D4682E] text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {busy === confirmRemove.id ? '…' : 'Yes, remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav color="#085041" activeRole="DEALER" />
    </div>
  )
}

function OrderHeaderRow({ order }: { order: Order }) {
  // 2026-06-06 — Seed cards in the unified feed surface a 🌱 badge
  // + the variety name so the dealer can recognise a seed order at
  // a glance vs. a pesticide / fertiliser order.
  return (
    <div className="flex items-start gap-3">
      {order.farmer_photo_url ? (
        <img src={order.farmer_photo_url} alt={order.farmer_name || 'Farmer'}
          className="w-12 h-12 rounded-full object-cover border border-[#DDD0B8] shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded-full bg-[#085041]/10 border border-[#DDD0B8] shrink-0 flex items-center justify-center">
          <span className="text-sm font-bold text-[#085041]">{initials(order.farmer_name)}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="font-semibold text-[#6B3F1F] truncate">
            {order.farmer_name || 'Unknown farmer'}
          </p>
          {order.is_seed && (
            <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full shrink-0">
              🌱 Seed
            </span>
          )}
        </div>
        {order.client_name && (
          <p className="text-xs text-[#7A8C7E] truncate">{order.client_name}</p>
        )}
        <p className="text-[11px] text-[#7A8C7E]">
          {order.is_seed
            ? (
                <span className="uppercase tracking-wider font-medium text-[10px]">
                  Seed / Seedling
                </span>
              )
            : order.category && (
                <span className="uppercase tracking-wider font-medium text-[10px]">
                  {order.category.toLowerCase()}
                </span>
              )}
          {(order.is_seed || order.category) && ' · '}
          Received {shortDate(order.created_at)}
        </p>
        {/* 2026-06-07 — Human-readable Order ID, shared across the
            lineage. Mono so it reads cleanly off the screen for
            phone/WhatsApp cross-reference. */}
        {order.reference_number && (
          <p className="text-[10px] font-mono tracking-wide text-[#085041] mt-1">
            {order.reference_number}
          </p>
        )}
      </div>
    </div>
  )
}

function PickupStatus({ order }: { order: Order }) {
  if (order.packing_farmer_received_at) {
    const t = new Date(order.packing_farmer_received_at)
    return (
      <p className="text-[11px] text-emerald-700 mt-1 font-semibold">
        ✓ Received by farmer · {t.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} {t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
      </p>
    )
  }
  if (order.packing_picked_up_at) {
    const t = new Date(order.packing_picked_up_at)
    const who = order.packing_picked_up_by_role === 'FACILITATOR'
      ? `facilitator${order.packing_picked_up_by_name ? ` (${order.packing_picked_up_by_name})` : ''}`
      : 'farmer'
    return (
      <p className="text-[11px] text-amber-700 mt-1 font-medium">
        📦 Picked up by {who} · {t.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} {t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        {order.packing_picked_up_by_role === 'FACILITATOR' && ' · awaiting farmer receipt'}
      </p>
    )
  }
  return (
    <p className="text-[11px] text-[#7A8C7E] mt-1">
      Awaiting pickup
    </p>
  )
}

function PackingCard({
  order, onShare, onRemove, busy,
}: {
  order: Order
  onShare: () => void
  onRemove: () => void
  busy: boolean
}) {
  const shared = !!order.packing_list_shared_at
  const total = order.packing_items.reduce((s, i) => s + (i.price || 0), 0)
  const sharedAt = order.packing_list_shared_at
    ? new Date(order.packing_list_shared_at)
    : null
  return (
    <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm overflow-hidden">
      {/* Packing ID strip — paper-friendly cross-surface identifier
          so the dealer, farmer, and facilitator all reference the
          same batch. Big mono so the dealer can read it aloud. */}
      {order.packing_code && (
        <div className="px-4 py-2 bg-emerald-600 text-white flex items-baseline justify-between">
          <p className="text-[10px] uppercase tracking-wider opacity-75">Packing ID</p>
          <p className="text-base font-bold font-mono tracking-widest">{order.packing_code}</p>
        </div>
      )}
      <div className="p-4 bg-emerald-50/40 border-b border-emerald-100">
        <OrderHeaderRow order={order} />
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {order.farmer_phone && (
            <a href={`tel:${order.farmer_phone}`}
              onClick={e => e.stopPropagation()}
              className="text-[11px] font-semibold text-[#085041] bg-emerald-100 px-2.5 py-1 rounded-lg">
              📞 Farmer
            </a>
          )}
          {order.facilitator_phone && (
            <a href={`tel:${order.facilitator_phone}`}
              onClick={e => e.stopPropagation()}
              className="text-[11px] font-semibold text-[#6B3F1F] bg-slate-100 px-2.5 py-1 rounded-lg">
              📞 Facilitator
            </a>
          )}
          {order.facilitator_user_id && !order.facilitator_phone && (
            <span className="text-[11px] font-semibold text-[#6B3F1F] bg-slate-100 px-2.5 py-1 rounded-lg">
              + Facilitator
            </span>
          )}
        </div>
        {sharedAt && (
          <p className="text-[11px] text-emerald-700 mt-2 font-medium">
            ✓ Shared {sharedAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} at {sharedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
        {/* 2026-06-06 — Pickup + farmer-received status line. Three
            possible states the dealer cares about. */}
        <PickupStatus order={order} />
      </div>
      <div className="divide-y divide-emerald-100">
        {order.packing_items.map(it => (
          <div key={it.id} className="p-3 flex items-baseline justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#6B3F1F] truncate">{it.brand_name || 'Item'}</p>
              {it.manufacturer_name && (
                <p className="text-[11px] text-[#7A8C7E] truncate">by {it.manufacturer_name}</p>
              )}
              {it.given_volume != null && (
                <p className="text-[11px] text-[#7A8C7E] mt-0.5">{it.given_volume} {it.volume_unit || ''}</p>
              )}
            </div>
            {it.price != null && (
              <p className="text-sm font-bold text-[#085041] shrink-0">₹{it.price.toLocaleString('en-IN')}</p>
            )}
          </div>
        ))}
      </div>
      <div className="px-3 py-2 bg-emerald-50/40 border-t border-emerald-100 flex items-center justify-between">
        <p className="text-[11px] text-[#7A8C7E]">Total</p>
        <p className="text-sm font-bold text-[#085041]">₹{total.toLocaleString('en-IN')}</p>
      </div>
      <div className="p-3 flex gap-2">
        <button onClick={onShare} disabled={busy}
          className="flex-1 bg-[#085041] text-white text-xs font-semibold py-2.5 rounded-xl disabled:opacity-60">
          {busy ? '…' : (shared ? '↗ Share again' : '↗ Share')}
        </button>
        <button onClick={onRemove} disabled={busy}
          className="flex-1 border border-red-200 text-[#D4682E] text-xs font-semibold py-2.5 rounded-xl disabled:opacity-50">
          🗑 Remove
        </button>
      </div>
    </div>
  )
}
