'use client'
import { useState, useEffect, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import AvatarLightbox from '@/components/AvatarLightbox'
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
  // 2026-06-19 — Photo so the dealer can visually identify the
  // facilitator who routed the order. Tap-to-enlarge on render.
  facilitator_photo_url: string | null
  client_id: string
  client_name: string | null
  // 2026-07-24 — Training Sandbox marker. Drives the "TRAINING"
  // chip on the card + membership of the Training pill.
  client_is_training?: boolean
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
  // 2026-07-08 — Crop context for the dealer card (seed orders
  // today; regular orders can adopt the same shape later).
  crop_name?: string | null
  crop_measure?: 'AREA_WISE' | 'PLANT_WISE' | null
  farm_area_acres?: number | null
  number_of_plants?: number | null
  computed_crop_age?: { value: number; unit: string; source: string; is_minimum?: boolean } | null
}

// 2026-06-06 — Raw shape from /dealer/seed-orders before adapter.
interface SeedOrderRaw {
  id: string
  status: string
  // 2026-06-19 — Backend now generates RT-YY-NNNNNN for seed orders too.
  reference_number?: string | null
  category: string | null
  variety_name: string | null
  crop_cosh_id: string | null
  crop_name: string | null
  crop_measure: 'AREA_WISE' | 'PLANT_WISE' | null
  computed_crop_age: { value: number; unit: string; source: string; is_minimum?: boolean } | null
  farmer_user_id: string
  farmer_name: string | null
  farmer_phone: string | null
  farmer_photo_url: string | null
  farm_area_acres: number | null
  number_of_plants: number | null
  client_id: string
  client_name: string | null
  unit: string | null
  quantity: number | null
  total_price: number | null
  created_at: string
}

// 2026-06-09 — Completed dropped from active pills (Batch 2 of
// Dealer mirroring). Terminal sub-orders live in /dealer/history.
// 2026-07-24 — 'training' pill added. Real pills (pending / postponed
// / farmer / packing) now exclude orders whose client is a training
// child, so a dealer's actual work doesn't get mixed with practice
// work. The Training pill collects every training-client order the
// dealer holds regardless of item status — that's the whole point
// of separating it.
type Pill = 'pending' | 'postponed' | 'farmer' | 'packing' | 'training'

const PILLS: readonly Pill[] = ['pending', 'postponed', 'farmer', 'packing', 'training'] as const

function initials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

function shortDate(iso: string | null, locale: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: 'short' })
}

// 2026-07-25 — Training-order render routing. Training-pill orders
// need the SAME action UI (Accept / Packing / Handover / etc.) that
// a real order of the equivalent status gets, or the dealer sees the
// card and can't proceed (screenshot from user 2026-07-25). Pick the
// "most action-needed" real pill for the given item state — same
// order the dealer would tap through in the real flow: pending →
// packing → postponed → farmer.
function effectivePillForTraining(o: Order): Pill {
  if (o.is_seed) {
    if (['SENT', 'ACCEPTED'].includes(o.status)) return 'pending'
    if (o.status === 'READY_FOR_PICKUP') return 'packing'
    if (o.status === 'POSTPONED') return 'postponed'
    if (o.status === 'SENT_FOR_APPROVAL') return 'farmer'
    return 'pending'
  }
  if (['SENT', 'ACCEPTED', 'PROCESSING'].includes(o.status)) return 'pending'
  const c = o.item_status_counts
  if (c.approved > 0 && !o.packing_list_removed_at && !o.packing_farmer_received_at) return 'packing'
  if (c.postponed > 0) return 'postponed'
  if (c.sent_for_approval > 0) return 'farmer'
  return 'pending'
}

// Per-pill membership rules. An order can appear in multiple pills
// when it has items in multiple buckets — e.g. some Approved (Packing)
// + some Postponed (Postponed) — because the dealer's next action
// depends on which bucket they're focusing on.
function subBelongsTo(o: Order, pill: Pill): boolean {
  // 2026-06-20 — Defence-in-depth: terminal statuses must never
  // appear on any active pill regardless of what the backend ships.
  // EXPIRED is the one most likely to leak (orders whose window
  // lapsed but the cleanup pass hasn't run).
  //
  // 2026-06-21 — COMPLETED removed from the blocklist. Order status
  // flips to COMPLETED the moment the farmer approves the last item
  // (see `_update_order_status`), but the dealer still has to pack +
  // hand over. The Packing pill's per-pill filter
  // (`c.approved > 0 && !packing_list_removed_at && !packing_farmer_received_at`)
  // is the correct gate — drop the order off Packing only when packing
  // is actually done, not when farmer approval lands. The Home Screen
  // Packing tile uses the same predicate without this guard, so this
  // alignment fixes the "tile says 1, tab shows 0" discrepancy.
  if (['CANCELLED', 'REJECTED', 'REROUTED', 'EXPIRED', 'PURCHASED'].includes(o.status)) {
    return false
  }
  // 2026-07-24 — Training-client orders live exclusively on the
  // Training pill. Real pills (pending / postponed / farmer /
  // packing) exclude them so the dealer's actual work doesn't get
  // mixed with practice work. The Training pill collects every
  // active training order regardless of item status.
  if (pill === 'training') {
    return !!o.client_is_training
  }
  if (o.client_is_training) {
    return false
  }
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
        // 2026-06-19 — Seed order's hand-over step. After farmer
        // approval the order parks at READY_FOR_PICKUP; the dealer
        // packs the seed and marks it handed over from this pill.
        return o.status === 'READY_FOR_PICKUP'
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
  }
}

// 2026-06-06 — Adapter: shape a /dealer/seed-orders row into the
// unified Order interface so the same OrderHeaderRow + pill-routing
// machinery handles both flows without per-call branching.
function adaptSeedOrder(s: SeedOrderRaw): Order {
  return {
    id: s.id,
    status: s.status,
    // 2026-06-19 — Seed orders now carry the same RT-YY-NNNNNN ID
    // as regular orders. Old rows backfilled in migration
    // `c4a91e07f3d6`; new rows generated at create.
    reference_number: s.reference_number ?? null,
    farmer_user_id: s.farmer_user_id,
    farmer_name: s.farmer_name,
    farmer_phone: s.farmer_phone,
    farmer_photo_url: s.farmer_photo_url,
    farmer_gps_lat: null,
    farmer_gps_lng: null,
    facilitator_user_id: null,
    facilitator_name: null,
    facilitator_phone: null,
    facilitator_photo_url: null,
    client_id: s.client_id,
    client_name: s.client_name,
    client_is_training: false,
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
    crop_name: s.crop_name,
    crop_measure: s.crop_measure,
    farm_area_acres: s.farm_area_acres,
    number_of_plants: s.number_of_plants,
    computed_crop_age: s.computed_crop_age,
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
  const t = useTranslations('dealer.orders')
  const tCommon = useTranslations('common')
  const locale = useLocale()
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

  // 2026-06-19 — Seed inline-action state (migrated from
  // /dealer/seed-orders). Postpone + decline bottom sheets live at
  // page level so they sit above the BottomNav with the right
  // safe-area padding.
  const [postponeSeedId, setPostponeSeedId] = useState<string | null>(null)
  const [postponeMaxDays, setPostponeMaxDays] = useState(0)
  const [postponeDays, setPostponeDays] = useState(1)
  const [postponeBusy, setPostponeBusy] = useState(false)
  const [confirmDeclineSeedId, setConfirmDeclineSeedId] = useState<string | null>(null)
  const [decliningSeed, setDecliningSeed] = useState(false)

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

  // 2026-06-09 — Order-ID grouped feed (mirrors Facilitator/Farmer
  // pattern). One card per reference_number; sub-orders inside.
  // Seeds don't carry an Order ID yet — fall back to row id so each
  // seed lands in its own group (transient).
  const groups = useMemo(() => {
    const map = new Map<string, Order[]>()
    for (const o of orders) {
      const key = o.reference_number || `legacy:${o.id}`
      const list = map.get(key)
      if (list) list.push(o)
      else map.set(key, [o])
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
    return map
  }, [orders])

  // Pill counts: count GROUPS that have at least one matching
  // sub-order (matches what the user sees rendered).
  const counts: Record<Pill, number> = useMemo(() => {
    const c: Record<Pill, number> = {
      pending: 0, postponed: 0, farmer: 0, packing: 0, training: 0,
    }
    for (const list of groups.values()) {
      for (const p of PILLS) {
        if (list.some(o => subBelongsTo(o, p))) c[p] += 1
      }
    }
    return c
  }, [groups])

  // 2026-07-25 — If the pill is 'training' but no training orders
  // exist, fall back to 'pending' so the dealer isn't stuck on an
  // empty view when a session ends mid-page. Runs once per counts
  // change; harmless when counts.training > 0.
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
    out.sort((a, b) => {
      const aT = Math.max(...a.subs.map(o => new Date(o.created_at).getTime()))
      const bT = Math.max(...b.subs.map(o => new Date(o.created_at).getTime()))
      return bT - aT
    })
    return out
  }, [groups, pill])

  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  function buildShareText(o: Order): string {
    // Structured for legibility on WhatsApp / SMS.
    const orderDate = new Date(o.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
    const lines: string[] = []
    lines.push(t('share.header'))
    if (o.packing_code) lines.push(t('share.packingIdLine', { code: o.packing_code }))
    lines.push(t('share.orderDateLine', { date: orderDate }))
    lines.push('')
    lines.push(t('share.farmerLine', { name: o.farmer_name || t('share.farmerUnknown') }))
    if (o.farmer_phone) lines.push(t('share.farmerPhoneLine', { phone: o.farmer_phone }))
    if (o.farmer_gps_lat != null && o.farmer_gps_lng != null) {
      lines.push(t('share.locationLine', { lat: o.farmer_gps_lat, lng: o.farmer_gps_lng }))
    }
    if (o.facilitator_name || o.facilitator_phone) {
      lines.push('')
      lines.push(t('share.facilitatorLine', { name: o.facilitator_name || '' }).trim())
      if (o.facilitator_phone) lines.push(t('share.facilitatorPhoneLine', { phone: o.facilitator_phone }))
    }
    if (o.client_name) {
      lines.push('')
      lines.push(t('share.companyLine', { name: o.client_name }))
    }
    lines.push('')
    lines.push(t('share.itemsHeader'))
    let total = 0
    for (const it of o.packing_items) {
      const qty = it.given_volume != null ? ` · ${it.given_volume} ${it.volume_unit || ''}`.trim() : ''
      const price = it.price != null ? ` · ₹${it.price}` : ''
      const mfr = it.manufacturer_name ? ` (${it.manufacturer_name})` : ''
      lines.push(`• ${it.brand_name || t('share.itemFallback')}${mfr}${qty}${price}`)
      if (it.price) total += it.price
    }
    lines.push('')
    lines.push(t('share.totalLine', { amount: total.toLocaleString(locale) }))
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
          await navigatorAny.share({ title: t('shareTitle'), text })
        } catch { /* user cancelled */ }
      } else {
        await navigator.clipboard?.writeText(text)
        alert(t('share.copiedToClipboard'))
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

  // 2026-06-19 — Inline handover for seed orders in the Packing pill.
  // Pre-fix the seed card linked to /dealer/seed-orders which mixed
  // packing-needed orders with new accept-needed ones; the focused
  // Packing pill was the right surface to keep them on.
  async function handoverSeed(o: Order) {
    if (!confirm(t('packing.confirmHandoverSeed'))) return
    setBusy(o.id)
    try {
      await api.put(`/dealer/seed-orders/${o.id}/handover`, {})
      await load()
    } catch {
      alert(t('packing.errorHandoverSeed'))
    } finally { setBusy(null) }
  }

  // 2026-06-19 — Seed accept (SENT → ACCEPTED), inlined from the
  // retired /dealer/seed-orders page. After accept the card stays in
  // the Pending pill and re-renders with the qty/price form.
  async function acceptSeed(id: string) {
    setBusy(id)
    try {
      await api.put(`/dealer/seed-orders/${id}/accept`, {})
      await load()
    } finally { setBusy(null) }
  }

  // Seed send-for-approval. Lands the dealer on the With Farmer pill
  // so they see the seed sitting alongside any regular orders awaiting
  // farmer approval.
  async function submitSeed(id: string, form: { unit: string; quantity: string; total_price: string }) {
    if (!form.quantity) return
    setBusy(id)
    try {
      await api.put(`/dealer/seed-orders/${id}/submit-for-approval`, {
        unit: form.unit,
        quantity: parseFloat(form.quantity),
        total_price: form.total_price ? parseFloat(form.total_price) : null,
      })
      setPill('farmer')
      await load()
    } finally { setBusy(null) }
  }

  async function markNotAvailableSeed(id: string) {
    if (!confirm(t('seedPending.confirmNa'))) return
    setBusy(id)
    try {
      await api.put(`/dealer/seed-orders/${id}/not-available`, {})
      await load()
    } catch {
      alert(t('seedPending.errorMarkNa'))
    } finally { setBusy(null) }
  }

  async function openPostponeSeed(id: string) {
    setPostponeBusy(true)
    try {
      const { data } = await api.get<{ max_days: number; can_postpone: boolean }>(
        `/dealer/seed-orders/${id}/postpone-window`,
      )
      if (!data.can_postpone) {
        alert(t('seedPending.errorPostponeWindow'))
        return
      }
      setPostponeSeedId(id)
      setPostponeMaxDays(data.max_days)
      setPostponeDays(1)
    } finally { setPostponeBusy(false) }
  }

  async function confirmPostponeSeed() {
    if (!postponeSeedId) return
    setPostponeBusy(true)
    try {
      await api.put(`/dealer/seed-orders/${postponeSeedId}/postpone`, {
        days: postponeDays,
      })
      setPostponeSeedId(null)
      await load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: { message?: string } | string } } }
      const detail = e?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : detail?.message
      alert(msg || t('seedPending.errorPostpone'))
    } finally { setPostponeBusy(false) }
  }

  async function declineSeed(id: string) {
    setDecliningSeed(true)
    try {
      await api.put(`/dealer/seed-orders/${id}/not-available`, {})
      setConfirmDeclineSeedId(null)
      await load()
    } catch {
      alert(t('seedPending.errorDecline'))
    } finally { setDecliningSeed(false) }
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/home" />
      <div className="pt-16 pb-20">

        {/* Pill row — 2026-06-09: count promoted to filled-circle
            badge so task-load reads at a glance (parity with Farmer
            + Facilitator).
            2026-06-19 — Pills now wrap (flex-wrap) instead of
            horizontal-scrolling so all four are plainly visible on a
            phone-width column. History moves off the same row to a
            small right-aligned secondary link below, so it's still
            reachable but doesn't crowd the primary filters. */}
        <div className="px-4 pt-3 relative">
          {/* 2026-06-19 — No right-side gutter on the pill wrapper:
              we want the natural wrap (Pending / Postponed / With
              Farmer on row 1, Packing alone on row 2). History lives
              on row 2's right via absolute position — safe because
              Packing leaves plenty of empty space on that row. */}
          <div className="flex flex-wrap gap-2">
            {PILLS.filter(p => p !== 'training' || counts.training > 0).map(p => {
              // 2026-07-25 — Hide the Training pill entirely when no
              // training orders exist. Real pills always render (a
              // count of 0 there is meaningful — "you have nothing
              // pending" is worth surfacing); Training is opt-in and
              // only appears when a session is actually going.
              const active = pill === p
              const n = counts[p]
              return (
                <button key={p} onClick={() => setPill(p)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                    active
                      ? 'bg-[#7D4196] text-white border-[#7D4196]'
                      : 'bg-white text-[#6B3F1F] border-[#DDD0B8]'
                  }`}>
                  <span>{t(`pill.${p}`)}</span>
                  <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                    active
                      ? 'bg-white/25 text-white'
                      : n === 0
                        ? 'bg-stone-100 text-[#7A8C7E]'
                        : 'bg-[#7D4196]/15 text-[#7D4196]'
                  }`}>{n}</span>
                </button>
              )
            })}
          </div>
          {/* History sits on row 2 (aligned with Packing) at the
              right edge. Row 2 holds only Packing, so collision is
              not a concern. */}
          <button onClick={() => router.push('/dealer/history')}
            className="absolute top-[53px] right-4 text-xs font-semibold text-[#7A8C7E] active:text-[#7D4196]">
            {t('historyChip')} →
          </button>
        </div>

        <div className="px-4 mt-4 space-y-3">
          {loading ? (
            <div className="h-28 bg-white rounded-2xl animate-pulse" />
          ) : visibleGroups.length === 0 ? (
            <div className="text-center py-20">
              <span className="text-5xl">📋</span>
              <p className="text-[#7A8C7E] text-sm mt-3">
                {t('emptyPill', { pillName: t(`pill.${pill}`) })}
              </p>
            </div>
          ) : (
            visibleGroups.map(({ key, subs, matching }) => (
              <DealerOrderIdCard
                key={key}
                orderId={subs[0]?.reference_number || subs[0]?.id || 'unknown'}
                subs={subs}
                matching={matching}
                pill={pill}
                expanded={expandedGroup === key}
                onToggleExpand={() => setExpandedGroup(expandedGroup === key ? null : key)}
                onShare={onSharePressed}
                onRemove={(o) => setConfirmRemove(o)}
                // 2026-06-19 — Seed open-detail is a no-op now that all
                // seed actions live inline on the unified feed. Regular
                // orders still route to their detail page for the rich
                // per-item review surface.
                onOpenDetail={(o) => {
                  if (o.is_seed) return
                  router.push(`/dealer/orders/${o.id}`)
                }}
                onHandoverSeed={handoverSeed}
                onAcceptSeed={acceptSeed}
                onConfirmDeclineSeed={(id) => setConfirmDeclineSeedId(id)}
                onSubmitSeed={submitSeed}
                onOpenPostponeSeed={openPostponeSeed}
                onMarkNotAvailableSeed={markNotAvailableSeed}
                busy={busy}
              />
            ))
          )}
        </div>
      </div>

      {/* Re-share warning sheet */}
      {confirmReshare && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end" onClick={() => setConfirmReshare(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">{t('reshare.title')}</p>
            <p className="text-xs text-amber-700 mt-2">
              {t('reshare.bodyPrefix')}
              {confirmReshare.packing_list_shared_at && (
                <span>
                  {' '}{t('reshare.bodyAt')}{' '}
                  <strong>
                    {new Date(confirmReshare.packing_list_shared_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                    {' '}{t('reshare.bodyOn')}{' '}
                    {new Date(confirmReshare.packing_list_shared_at).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
                  </strong>
                </span>
              )}{t('reshare.bodySuffix')}
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmReshare(null)}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl">
                {tCommon('cancel')}
              </button>
              <button onClick={() => shareOrder(confirmReshare)} disabled={busy === confirmReshare.id}
                className="flex-1 bg-amber-600 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {busy === confirmReshare.id ? '…' : t('reshare.yesShareAgain')}
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
            <p className="font-bold text-[#6B3F1F]">{t('removeConfirm.title')}</p>
            <p className="text-xs text-[#7A8C7E] mt-2">
              {t('removeConfirm.body')}
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmRemove(null)}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl">
                {tCommon('cancel')}
              </button>
              <button onClick={() => removeOrder(confirmRemove)} disabled={busy === confirmRemove.id}
                className="flex-1 bg-red-100 text-[#D4682E] text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {busy === confirmRemove.id ? '…' : t('removeConfirm.yesRemove')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2026-06-19 — Seed postpone bottom sheet, migrated from
          the retired /dealer/seed-orders page. Reuses the same shape
          as the regular-order postpone sheet on /dealer/orders/[id]. */}
      {postponeSeedId && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end"
          onClick={() => !postponeBusy && setPostponeSeedId(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-[#DDD0B8] flex items-center justify-between">
              <p className="font-semibold text-[#6B3F1F]">{t('seedPending.postponeSheet.title')}</p>
              <button onClick={() => !postponeBusy && setPostponeSeedId(null)} className="text-[#7A8C7E] text-xl">×</button>
            </div>
            <div className="p-5">
              <p className="text-sm text-[#7A8C7E] mb-1">{t('seedPending.postponeSheet.howManyDays')}</p>
              <p className="text-xs text-[#7A8C7E] mb-4">
                {t('seedPending.postponeSheet.pickRange', { max: postponeMaxDays })}
              </p>
              <div className="flex items-center justify-center gap-3 mb-5">
                <button onClick={() => setPostponeDays(d => Math.max(1, d - 1))}
                  disabled={postponeDays <= 1 || postponeBusy}
                  className="w-12 h-12 rounded-full border border-[#DDD0B8] text-[#6B3F1F] text-xl font-bold disabled:opacity-30">−</button>
                <div className="min-w-[80px] text-center">
                  <p className="text-3xl font-bold text-[#6B3F1F]">{postponeDays}</p>
                  <p className="text-xs text-[#7A8C7E]">{t('seedPending.postponeSheet.dayUnit', { count: postponeDays })}</p>
                </div>
                <button onClick={() => setPostponeDays(d => Math.min(postponeMaxDays, d + 1))}
                  disabled={postponeDays >= postponeMaxDays || postponeBusy}
                  className="w-12 h-12 rounded-full border border-[#DDD0B8] text-[#6B3F1F] text-xl font-bold disabled:opacity-30">+</button>
              </div>
              <button onClick={confirmPostponeSeed} disabled={postponeBusy}
                className="w-full py-3 rounded-2xl text-white font-semibold text-sm disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #d97706, #b45309)' }}>
                {postponeBusy ? t('seedPending.postponeSheet.postponing') : t('seedPending.postponeSheet.postponeCta', { count: postponeDays })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Decline-confirm sheet for SENT seed orders */}
      {confirmDeclineSeedId && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end"
          onClick={() => !decliningSeed && setConfirmDeclineSeedId(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">{t('seedPending.declineSheet.title')}</p>
            <p className="text-xs text-[#7A8C7E] mt-2">{t('seedPending.declineSheet.body')}</p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmDeclineSeedId(null)} disabled={decliningSeed}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl disabled:opacity-50">
                {tCommon('cancel')}
              </button>
              <button onClick={() => declineSeed(confirmDeclineSeedId)} disabled={decliningSeed}
                className="flex-1 bg-red-100 text-[#D4682E] text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {decliningSeed ? '…' : t('seedPending.declineSheet.yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav color="#7D4196" activeRole="DEALER" />
    </div>
  )
}

function PickupStatus({ order }: { order: Order }) {
  const t = useTranslations('dealer.orders.pickup')
  const locale = useLocale()
  if (order.packing_farmer_received_at) {
    const stamp = new Date(order.packing_farmer_received_at)
    return (
      <p className="text-[11px] text-purple-700 mt-1 font-semibold">
        {t('receivedByFarmer', {
          date: stamp.toLocaleDateString(locale, { day: '2-digit', month: 'short' }),
          time: stamp.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
        })}
      </p>
    )
  }
  if (order.packing_picked_up_at) {
    const stamp = new Date(order.packing_picked_up_at)
    const date = stamp.toLocaleDateString(locale, { day: '2-digit', month: 'short' })
    const time = stamp.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    let line: string
    if (order.packing_picked_up_by_role === 'FACILITATOR') {
      line = order.packing_picked_up_by_name
        ? t('pickedUpByFacilitatorNamed', { name: order.packing_picked_up_by_name, date, time })
        : t('pickedUpByFacilitator', { date, time })
    } else {
      line = t('pickedUpByFarmer', { date, time })
    }
    return (
      <p className="text-[11px] text-amber-700 mt-1 font-medium">
        {line}
      </p>
    )
  }
  return (
    <p className="text-[11px] text-[#7A8C7E] mt-1">
      {t('awaitingPickup')}
    </p>
  )
}

// 2026-06-09 — Order-ID grouped card (parity with
// Facilitator/Farmer). Header carries the shared context (farmer +
// crop/category + Order ID); body renders per-pill chunks for the
// matching sub-orders. Multi-chunk groups (rare on dealer side —
// would be a lineage where the dealer holds 2+ sibling sub-orders)
// render the chunks as separate rows with a "Sub-order · date"
// micro-header.
function DealerOrderIdCard({
  orderId, subs, matching, pill, expanded, onToggleExpand,
  onShare, onRemove, onOpenDetail, onHandoverSeed,
  onAcceptSeed, onConfirmDeclineSeed, onSubmitSeed,
  onOpenPostponeSeed, onMarkNotAvailableSeed,
  busy,
}: {
  orderId: string
  subs: Order[]
  matching: Order[]
  pill: Pill
  expanded: boolean
  onToggleExpand: () => void
  onShare: (o: Order) => void
  onRemove: (o: Order) => void
  onOpenDetail: (o: Order) => void
  onHandoverSeed: (o: Order) => void
  onAcceptSeed: (id: string) => void
  onConfirmDeclineSeed: (id: string) => void
  onSubmitSeed: (id: string, form: { unit: string; quantity: string; total_price: string }) => void
  onOpenPostponeSeed: (id: string) => void
  onMarkNotAvailableSeed: (id: string) => void
  busy: string | null
}) {
  const head = subs[0]
  const renderRows = matching.length > 1
  const borderClass = pill === 'training'
    ? 'border-amber-300'
    : pill === 'packing'
      ? 'border-purple-200'
      : pill === 'farmer' || pill === 'postponed'
        ? 'border-amber-200'
        : 'border-[#DDD0B8]'
  return (
    <div className={`bg-white rounded-2xl border ${borderClass} shadow-sm overflow-hidden`}>
      <DealerOrderCardHeader head={head} subCount={subs.length} expanded={expanded}
        onToggleExpand={onToggleExpand} orderId={orderId} />
      <div className="divide-y divide-[#F0E5D0]">
        {renderRows
          ? matching.map(sub => (
              <DealerPillChunk key={sub.id} sub={sub} pill={pill}
                onShare={onShare} onRemove={onRemove} onOpenDetail={onOpenDetail}
                onHandoverSeed={onHandoverSeed}
                onAcceptSeed={onAcceptSeed}
                onConfirmDeclineSeed={onConfirmDeclineSeed}
                onSubmitSeed={onSubmitSeed}
                onOpenPostponeSeed={onOpenPostponeSeed}
                onMarkNotAvailableSeed={onMarkNotAvailableSeed}
                busy={busy} showSubHeader />
            ))
          : matching.length === 1 && (
              <DealerPillChunk sub={matching[0]} pill={pill}
                onShare={onShare} onRemove={onRemove} onOpenDetail={onOpenDetail}
                onHandoverSeed={onHandoverSeed}
                onAcceptSeed={onAcceptSeed}
                onConfirmDeclineSeed={onConfirmDeclineSeed}
                onSubmitSeed={onSubmitSeed}
                onOpenPostponeSeed={onOpenPostponeSeed}
                onMarkNotAvailableSeed={onMarkNotAvailableSeed}
                busy={busy} />
            )
        }
      </div>
      {expanded && <DealerExpandedSubOrderList subs={subs} onOpenDetail={onOpenDetail} />}
    </div>
  )
}

function DealerOrderCardHeader({
  head, subCount, expanded, onToggleExpand, orderId,
}: {
  head: Order | undefined
  subCount: number
  expanded: boolean
  onToggleExpand: () => void
  orderId: string
}) {
  const t = useTranslations('dealer.orders.cardHeader')
  const tTrain = useTranslations('training')
  const locale = useLocale()
  if (!head) return null
  return (
    <div className="px-4 py-3 bg-[#F5F0E8]/40">
      {/* 2026-06-19 — Order ID first, full-width and prominent.
          Previously this lived as a tiny mono line at the bottom;
          now it leads the card so the dealer can confirm it over
          phone before reading anything else. */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="font-mono text-xs font-semibold text-[#7D4196] tracking-wide truncate">
          {orderId}
        </p>
        {head.is_seed ? (
          <span className="text-[10px] font-semibold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded-full shrink-0">
            {t('seedTag')}
          </span>
        ) : (
          head.category && (
            <span className="text-[10px] font-semibold text-[#7A8C7E] uppercase tracking-wider shrink-0">
              {head.category.toLowerCase()}
            </span>
          )
        )}
      </div>

      {/* 2026-06-19 — Explicit role label so the dealer knows whose
          name they're looking at. Two patterns share this shape: the
          direct farmer→dealer order (this block alone) and the
          facilitator-routed order (this block + the facilitator
          strip below). */}
      <div className="flex items-start gap-3">
        <AvatarLightbox photoUrl={head.farmer_photo_url} name={head.farmer_name} size={44} />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-[#7A8C7E] uppercase tracking-wide font-semibold">{t('farmerRoleLabel')}</p>
          <p className="font-semibold text-[#6B3F1F] truncate">
            {head.farmer_name || t('unknownFarmer')}
          </p>
          {head.client_name && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-xs text-[#7A8C7E] truncate">{head.client_name}</p>
              {/* 2026-07-24 — Training marker. Yellow chip so the
                  dealer sees it BEFORE tapping Accept — a training
                  order shouldn't touch their real inventory / brand
                  counts. */}
              {head.client_is_training && (
                <span className="text-[9px] font-bold uppercase tracking-wider bg-amber-300 text-amber-900 px-1.5 py-0.5 rounded shrink-0">
                  {tTrain('chip')}
                </span>
              )}
            </div>
          )}
          <p className="text-[11px] text-[#7A8C7E] mt-0.5">
            {head.is_seed ? t('seedCategory') : (head.category?.toLowerCase() || t('categoryFallback'))}
            {t('receivedSuffix', { date: shortDate(head.created_at, locale) })}
          </p>
        </div>
        {head.farmer_phone && (
          <a href={`tel:${head.farmer_phone}`}
            onClick={(e) => e.stopPropagation()}
            aria-label={t('callFarmerAria')}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-100 text-purple-800 text-xs font-semibold">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {t('callBtn')}
          </a>
        )}
      </div>

      {/* Facilitator strip — only on facilitator-routed orders. Same
          explicit role label so the dealer immediately knows the
          relationship. */}
      {(head.facilitator_user_id || head.facilitator_name) && (
        <div className="flex items-start gap-2 mt-2 pt-2 border-t border-[#F0E8D6]">
          <AvatarLightbox
            photoUrl={head.facilitator_photo_url}
            name={head.facilitator_name}
            size={36}
            bgColor="rgba(125, 78, 0, 0.1)"
            textColor="#7D4E00" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-[#7A8C7E] uppercase tracking-wide font-semibold">{t('facilitatorRoleLabel')}</p>
            <p className="text-xs font-medium text-[#6B3F1F] truncate">
              {head.facilitator_name || t('unknownFacilitator')}
            </p>
          </div>
          {head.facilitator_phone && (
            <a href={`tel:${head.facilitator_phone}`}
              onClick={(e) => e.stopPropagation()}
              aria-label={t('callFacilitatorAria')}
              className="shrink-0 text-xs bg-purple-100 text-purple-800 px-2.5 py-1.5 rounded-lg font-semibold">
              {t('callBtn')}
            </a>
          )}
        </div>
      )}
      {/* 2026-07-08 — Crop context strip: crop name · area or plants ·
          age. Rendered when we have any of the three fields; keeps the
          card compact when data is missing (e.g. pre-Cosh-resolve
          orders with no measure). Dot separators drop naturally when
          adjacent segments are absent. */}
      {head.is_seed && (head.crop_name || head.variety_name || head.farm_area_acres || head.number_of_plants || head.computed_crop_age) && (
        <div className="mt-2 pt-2 border-t border-[#F0E8D6] text-[11px] text-[#6B3F1F] flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {head.crop_name && (
            <span className="font-semibold">{head.crop_name}</span>
          )}
          {/* 2026-07-28 — Variety name (critical for dealer: a
              seed sale needs the specific variety, not just the
              crop). Rendered as bold accent so it reads distinct
              from the crop name and the numeric context. */}
          {head.variety_name && (
            <>
              {head.crop_name && <span className="text-[#7A8C7E]">·</span>}
              <span className="font-semibold text-[#2C4A2A]">{head.variety_name}</span>
            </>
          )}
          {head.crop_measure === 'PLANT_WISE' && head.number_of_plants ? (
            <>
              {(head.crop_name || head.variety_name) && <span className="text-[#7A8C7E]">·</span>}
              <span>{t('cropContext.plants', { count: head.number_of_plants })}</span>
            </>
          ) : head.farm_area_acres ? (
            <>
              {(head.crop_name || head.variety_name) && <span className="text-[#7A8C7E]">·</span>}
              <span>{t('cropContext.acres', { count: head.farm_area_acres })}</span>
            </>
          ) : null}
          {head.computed_crop_age && (
            <>
              {(head.crop_name || head.variety_name || head.farm_area_acres || head.number_of_plants) && (
                <span className="text-[#7A8C7E]">·</span>
              )}
              <span>
                {head.computed_crop_age.is_minimum ? '> ' : ''}
                {t(
                  head.computed_crop_age.unit === 'years'
                    ? 'cropContext.ageYears'
                    : 'cropContext.ageDays',
                  { count: head.computed_crop_age.value },
                )}
              </span>
            </>
          )}
        </div>
      )}
      {subCount > 1 && (
        <button onClick={onToggleExpand}
          className="text-[10px] font-semibold text-[#7A8C7E] mt-2 flex items-center gap-1">
          {expanded ? '▾' : '▸'} {t('expandSubOrders', { count: subCount })}
        </button>
      )}
    </div>
  )
}

function DealerPillChunk({
  sub, pill, onShare, onRemove, onOpenDetail, onHandoverSeed,
  onAcceptSeed, onConfirmDeclineSeed, onSubmitSeed,
  onOpenPostponeSeed, onMarkNotAvailableSeed,
  busy, showSubHeader,
}: {
  sub: Order
  pill: Pill
  onShare: (o: Order) => void
  onRemove: (o: Order) => void
  onOpenDetail: (o: Order) => void
  onHandoverSeed: (o: Order) => void
  onAcceptSeed: (id: string) => void
  onConfirmDeclineSeed: (id: string) => void
  onSubmitSeed: (id: string, form: { unit: string; quantity: string; total_price: string }) => void
  onOpenPostponeSeed: (id: string) => void
  onMarkNotAvailableSeed: (id: string) => void
  busy: string | null
  showSubHeader?: boolean
}) {
  const router = useRouter()
  const t = useTranslations('dealer.orders.chunk')
  const locale = useLocale()
  // 2026-07-25 — Under the Training pill, delegate to whichever real
  // pill would render this order's current action state. Training is
  // a status-agnostic bucket; without this, SENT orders (etc.) would
  // show only the card header with no Accept/Decline surface.
  const renderPill: Pill = pill === 'training' ? effectivePillForTraining(sub) : pill
  return (
    <div>
      {showSubHeader && (
        <p className="px-4 pt-3 text-[10px] font-mono tracking-wide text-[#7A8C7E]">
          {t('subOrderPrefix', { date: new Date(sub.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short' }) })}
        </p>
      )}
      {renderPill === 'pending' && (
        sub.is_seed ? (
          // 2026-06-19 — Inline seed accept + qty/price form. Migrated
          // from the retired /dealer/seed-orders page. SENT shows
          // Accept + Decline; ACCEPTED reveals the qty/price form +
          // Postpone + Not Available secondary actions.
          <SeedPendingChunk sub={sub}
            busy={busy === sub.id}
            onAccept={() => onAcceptSeed(sub.id)}
            onDecline={() => onConfirmDeclineSeed(sub.id)}
            onSubmit={(form) => onSubmitSeed(sub.id, form)}
            onPostpone={() => onOpenPostponeSeed(sub.id)}
            onMarkNa={() => onMarkNotAvailableSeed(sub.id)} />
        ) : (
          <button onClick={() => onOpenDetail(sub)}
            className="w-full px-4 py-3 text-left active:bg-[#F5F0E8]/60">
            <p className="text-xs text-[#7A8C7E]">
              {sub.status === 'SENT' && t('pending.newAccept')}
              {sub.status === 'ACCEPTED' && t('pending.acceptedRegular')}
              {sub.status === 'PROCESSING' && t('pending.processing')}
            </p>
          </button>
        )
      )}
      {renderPill === 'postponed' && (
        sub.is_seed ? (
          // POSTPONED seed — single inline action: Not Available.
          // (Lifting the postpone-bottom-sheet from the legacy page;
          // seed has no qty/price decision to revisit here.)
          <div className="px-4 py-3 space-y-2">
            <p className="text-[11px] text-amber-800 font-medium">
              {t('seedPending.postponedHint')}
            </p>
            <button onClick={() => onMarkNotAvailableSeed(sub.id)}
              disabled={busy === sub.id}
              className="w-full bg-red-100 disabled:opacity-50 text-[#D4682E] text-xs font-semibold py-2.5 rounded-xl">
              {t('seedPending.notAvailableCta')}
            </button>
          </div>
        ) : (
          <button onClick={() => router.push('/dealer/postponed')}
            className="w-full px-4 py-3 text-left active:bg-amber-50/60">
            <p className="text-[11px] text-amber-700 font-medium">
              {t('postponedTap', { count: sub.item_status_counts.postponed })}
            </p>
          </button>
        )
      )}
      {renderPill === 'farmer' && (
        <div className="px-4 py-3">
          <p className="text-[11px] text-amber-700 font-medium">
            {sub.is_seed
              ? t('waitingForFarmerSeed')
              : t('waitingForFarmer', { count: sub.item_status_counts.sent_for_approval })}
          </p>
        </div>
      )}
      {renderPill === 'packing' && (
        sub.is_seed ? (
          // 2026-06-19 — Inline seed handover. Pre-fix this tile linked
          // to /dealer/seed-orders which dumped the dealer onto the
          // unfiltered Active tab (mix of accept-needed + handover-
          // needed). Acting in-place keeps the focused Packing pill
          // intact.
          <div className="px-4 py-3 space-y-2">
            <p className="text-[11px] text-purple-800 font-medium text-center">
              {t('packingSeedBanner')}
            </p>
            <button onClick={() => onHandoverSeed(sub)}
              disabled={busy === sub.id}
              className="w-full bg-purple-600 disabled:bg-purple-300 text-white text-xs font-semibold py-2.5 rounded-xl">
              {busy === sub.id ? t('packingSeedBusy') : t('packingSeedHandoverCta')}
            </button>
          </div>
        ) : (
          <PackingChunk order={sub}
            onShare={() => onShare(sub)}
            onRemove={() => onRemove(sub)}
            busy={busy === sub.id} />
        )
      )}
    </div>
  )
}

// 2026-06-19 — Inline seed Pending-pill chunk, migrated from the
// retired /dealer/seed-orders page. SENT shows blind Accept/Decline;
// ACCEPTED reveals the qty/price form + Postpone + Not Available
// secondary actions. Form state lives locally so the parent doesn't
// own per-row form keys.
const SEED_UNITS = ['Grams', 'Kilograms', 'Numbers']
function SeedPendingChunk({
  sub, busy, onAccept, onDecline, onSubmit, onPostpone, onMarkNa,
}: {
  sub: Order
  busy: boolean
  onAccept: () => void
  onDecline: () => void
  onSubmit: (form: { unit: string; quantity: string; total_price: string }) => void
  onPostpone: () => void
  onMarkNa: () => void
}) {
  const t = useTranslations('dealer.orders.seedPending')
  const tCommon = useTranslations('common')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ unit: 'Kilograms', quantity: '', total_price: '' })
  return (
    <div className="px-4 py-3 space-y-2">
      {sub.status === 'SENT' && !showForm && (
        <>
          <p className="text-[11px] text-[#7A8C7E]">{t('blindAcceptHint')}</p>
          <div className="flex gap-2">
            <button onClick={onAccept} disabled={busy}
              className="flex-1 bg-purple-600 disabled:opacity-50 text-white text-xs font-semibold py-2.5 rounded-xl">
              {t('acceptCta')}
            </button>
            <button onClick={onDecline} disabled={busy}
              className="flex-1 bg-red-100 disabled:opacity-50 text-[#D4682E] text-xs font-semibold py-2.5 rounded-xl">
              {t('declineCta')}
            </button>
          </div>
        </>
      )}
      {sub.status === 'ACCEPTED' && !showForm && (
        <>
          <button onClick={() => { setShowForm(true); setForm({ unit: 'Kilograms', quantity: '', total_price: '' }) }}
            className="w-full bg-indigo-600 text-white text-xs font-semibold py-2.5 rounded-xl">
            {t('enterQtyPrice')}
          </button>
          <div className="flex gap-2">
            <button onClick={onPostpone} disabled={busy}
              className="flex-1 bg-amber-100 disabled:opacity-50 text-amber-800 text-xs font-semibold py-2.5 rounded-xl">
              {t('laterCta')}
            </button>
            <button onClick={onMarkNa} disabled={busy}
              className="flex-1 bg-red-100 disabled:opacity-50 text-[#D4682E] text-xs font-semibold py-2.5 rounded-xl">
              {t('notAvailableCta')}
            </button>
          </div>
        </>
      )}
      {showForm && (
        <div className="bg-[#F5F0E8] rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-[#6B3F1F]">{t('form.title')}</p>
          <div>
            <label className="block text-xs text-[#7A8C7E] mb-1">{t('form.unitLabel')}</label>
            <div className="flex gap-2">
              {SEED_UNITS.map(u => (
                <button key={u} onClick={() => setForm(f => ({ ...f, unit: u }))}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                    form.unit === u ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-[#6B3F1F] border-[#DDD0B8]'
                  }`}>
                  {u === 'Grams' ? t('units.grams') : u === 'Kilograms' ? t('units.kilograms') : t('units.numbers')}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-[#7A8C7E] mb-1">{t('form.qtyLabel')}</label>
              <input type="number" value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                placeholder={t('form.qtyPlaceholder', { unit: form.unit })}
                className="w-full border border-[#DDD0B8] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-[#7A8C7E] mb-1">{t('form.priceLabel')}</label>
              <input type="number" value={form.total_price}
                onChange={e => setForm(f => ({ ...f, total_price: e.target.value }))}
                placeholder={t('form.pricePlaceholder')}
                className="w-full border border-[#DDD0B8] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => onSubmit(form)} disabled={busy || !form.quantity}
              className="flex-1 bg-indigo-600 text-white text-xs font-semibold py-2.5 rounded-xl disabled:opacity-40">
              {busy ? t('form.sending') : t('form.sendForApproval')}
            </button>
            <button onClick={() => setShowForm(false)}
              className="px-4 border border-[#DDD0B8] text-[#6B3F1F] text-xs font-medium py-2.5 rounded-xl">
              {tCommon('cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// 2026-06-09 — Packing chunk (was the body of PackingCard).
// Preserves the full inline workflow the dealer needs: Packing ID
// strip, contact chips + shared-at + pickup status, items list,
// total, Share / Remove. Order-level header (farmer + Order ID) is
// now in DealerOrderCardHeader; the chunk starts at the Packing
// ID strip.
function PackingChunk({
  order, onShare, onRemove, busy,
}: {
  order: Order
  onShare: () => void
  onRemove: () => void
  busy: boolean
}) {
  const t = useTranslations('dealer.orders.packing')
  const locale = useLocale()
  const shared = !!order.packing_list_shared_at
  const total = order.packing_items.reduce((s, i) => s + (i.price || 0), 0)
  const sharedAt = order.packing_list_shared_at
    ? new Date(order.packing_list_shared_at)
    : null
  return (
    <div>
      {order.packing_code && (
        <div className="px-4 py-2 bg-purple-600 text-white flex items-baseline justify-between">
          <p className="text-[10px] uppercase tracking-wider opacity-75">{t('packingIdLabel')}</p>
          <p className="text-base font-bold font-mono tracking-widest">{order.packing_code}</p>
        </div>
      )}
      <div className="px-4 py-3 bg-purple-50/40">
        <div className="flex items-center gap-2 flex-wrap">
          {order.farmer_phone && (
            <a href={`tel:${order.farmer_phone}`}
              onClick={e => e.stopPropagation()}
              className="text-[11px] font-semibold text-[#7D4196] bg-purple-100 px-2.5 py-1 rounded-lg">
              {t('callFarmer')}
            </a>
          )}
          {order.facilitator_phone && (
            <a href={`tel:${order.facilitator_phone}`}
              onClick={e => e.stopPropagation()}
              className="text-[11px] font-semibold text-[#6B3F1F] bg-slate-100 px-2.5 py-1 rounded-lg">
              {t('callFacilitator')}
            </a>
          )}
          {order.facilitator_user_id && !order.facilitator_phone && (
            <span className="text-[11px] font-semibold text-[#6B3F1F] bg-slate-100 px-2.5 py-1 rounded-lg">
              {t('plusFacilitator')}
            </span>
          )}
        </div>
        {sharedAt && (
          <p className="text-[11px] text-purple-700 mt-2 font-medium">
            {t('sharedAt', {
              date: sharedAt.toLocaleDateString(locale, { day: '2-digit', month: 'short' }),
              time: sharedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
            })}
          </p>
        )}
        <PickupStatus order={order} />
      </div>
      <div className="divide-y divide-purple-100">
        {order.packing_items.map(it => (
          <div key={it.id} className="p-3 flex items-baseline justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#6B3F1F] truncate">{it.brand_name || t('itemFallback')}</p>
              {it.manufacturer_name && (
                <p className="text-[11px] text-[#7A8C7E] truncate">{t('byManufacturer', { manufacturer: it.manufacturer_name })}</p>
              )}
              {it.given_volume != null && (
                <p className="text-[11px] text-[#7A8C7E] mt-0.5">{it.given_volume} {it.volume_unit || ''}</p>
              )}
            </div>
            {it.price != null && (
              <p className="text-sm font-bold text-[#7D4196] shrink-0">₹{it.price.toLocaleString(locale)}</p>
            )}
          </div>
        ))}
      </div>
      <div className="px-3 py-2 bg-purple-50/40 border-t border-purple-100 flex items-center justify-between">
        <p className="text-[11px] text-[#7A8C7E]">{t('totalLabel')}</p>
        <p className="text-sm font-bold text-[#7D4196]">₹{total.toLocaleString(locale)}</p>
      </div>
      <div className="p-3 flex gap-2">
        <button onClick={onShare} disabled={busy}
          className="flex-1 bg-[#7D4196] text-white text-xs font-semibold py-2.5 rounded-xl disabled:opacity-60">
          {busy ? '…' : (shared ? t('shareAgainCta') : t('shareCta'))}
        </button>
        <button onClick={onRemove} disabled={busy}
          className="flex-1 border border-red-200 text-[#D4682E] text-xs font-semibold py-2.5 rounded-xl disabled:opacity-50">
          {t('removeCta')}
        </button>
      </div>
    </div>
  )
}

function DealerExpandedSubOrderList({
  subs, onOpenDetail,
}: {
  subs: Order[]
  onOpenDetail: (o: Order) => void
}) {
  const t = useTranslations('dealer.orders.expanded')
  const locale = useLocale()
  return (
    <div className="bg-[#F5F0E8]/50 px-4 py-3 border-t border-[#F0E5D0]">
      <p className="text-[10px] font-semibold text-[#7A8C7E] uppercase tracking-wider mb-2">
        {t('allSubOrders', { count: subs.length })}
      </p>
      <div className="space-y-2">
        {subs.map(sub => (
          <button key={sub.id} onClick={() => onOpenDetail(sub)}
            className="w-full text-left flex items-center justify-between gap-2 bg-white border border-[#DDD0B8] rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="text-[10px] text-[#7A8C7E]">
                {new Date(sub.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
              </p>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 bg-slate-100 text-[#7A8C7E]">
              {sub.status.replace(/_/g, ' ')}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
