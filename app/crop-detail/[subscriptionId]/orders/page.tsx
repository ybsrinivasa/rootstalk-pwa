'use client'
// Phase 3 of the Orders restructure (2026-06-02). Per-package Orders
// surface, tabbed:
//
//   Tab "Order"    — new orders. Three accordions: Seed/Seedling,
//                    Pesticide, Fertilizer. Pesticide/Fertilizer
//                    expose a Pre-sowing sub-mode when today is
//                    behind the subscription's crop_start_date.
//   Tab "Manage"   — orders in flight. Inline Approve (when items
//                    await farmer approval); Cancel always; Forward /
//                    Delete appear once a cancel is acknowledged.
//   Tab "Received" — purchased items for this subscription.
//
// Deep-link from Advisory tap: ?open=pesticide|fertilizer&date_from=..&date_to=..
// opens that accordion pre-filled with the date range. Direct entry
// from the Orders button on the crop dashboard opens the page with
// nothing pre-filled.

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import ClientCropChip from '@/components/ClientCropChip'
import api from '@/lib/api'

type Subscription = {
  id: string
  crop_start_date: string | null
  package_name?: string | null
  client_name?: string | null
  crop_cosh_id?: string | null
}

type SubOrder = {
  kind: 'REGULAR' | 'SEED'
  id: string; status: string
  // 2026-06-07 — Human-readable Order ID shared across the lineage.
  // Surfaces on the Manage card so the farmer can recognise the
  // same order on dealer/facilitator calls.
  reference_number?: string | null
  date_from?: string; date_to?: string
  created_at: string
  item_count?: number; is_max_count?: boolean
  // Per-status item breakdown (added 2026-06-02). The Manage card
  // surfaces only counts; item names stay hidden from the farmer
  // to prevent identity-based manipulation.
  awaiting_approval_count?: number
  returned_count?: number
  postponed_count?: number
  // 2026-06-06 — Approved items awaiting farmer-confirmed pickup.
  // Drives the emerald "Pick up N items from X" banner.
  pickup_ready_count?: number
  // 2026-06-08 — When 'FACILITATOR', the banner switches from
  // "Pick up N items from X" → "Receive N items from X" (the
  // facilitator has already collected from the dealer; the farmer
  // is now receiving them from the facilitator).
  packing_picked_up_by_role?: 'FARMER' | 'FACILITATOR' | null
  // 2026-06-09 — Packing ID for the Pickup chunk lead (mirrors the
  // Facilitator pickup card composition).
  packing_code?: string | null
  // 2026-06-03 — Lineage so the Manage tab can group reroute-child
  // orders under one card. Root of the chain has lineage_root_id ===
  // its own id (backend backfills this on first reroute).
  lineage_root_id?: string
  category?: 'PESTICIDE' | 'FERTILIZER' | null
  variety_name?: string | null
  unit?: string | null; quantity?: number | null; total_price?: number | null
  // Recipient (dealer or facilitator) so the farmer can track who's
  // holding the order without drilling in. Phone is a tel: link.
  recipient_name?: string | null
  recipient_phone?: string | null
  recipient_shop_name?: string | null
  recipient_role?: 'DEALER' | 'FACILITATOR' | null
  // 2026-06-06 — When a facilitator owns the order, returned items
  // stay with the facilitator (not the farmer). Drives the
  // returned-items strip suppression on this tab — see the
  // `returnedN > 0` block below.
  facilitator_user_id?: string | null
}

type DBSPreview = {
  category: 'PESTICIDE' | 'FERTILIZER'
  count: number
  available: boolean
  reason: string | null
  has_locked_brand: boolean
  practice_ids: string[]
  client_id: string
}

type PurchasedItem = {
  id: string; brand_name: string | null; manufacturer_name?: string | null
  l1_type: string | null; l2_type: string | null
  given_volume: number | null; volume_unit: string | null; price: number | null
  scan_verified: boolean; order_id: string; created_at: string
  timeline_name?: string | null
  application_date_from?: string | null
  application_date_to?: string | null
  // 2026-06-03 — set when the backend consolidates same-brand rows
  // across multiple timelines. Lets the UI show "Applied across N
  // timelines" instead of pretending it's a single-timeline row.
  merged_timeline_count?: number
  // 2026-06-06 — Recipient context per item so every Received card
  // can render shop / name + phone (matching the seed-order card
  // shape). Role-aware: an order may have been handled by a
  // dealer OR a facilitator (mutually exclusive backend-side).
  recipient_role?: 'DEALER' | 'FACILITATOR' | null
  recipient_name?: string | null
  recipient_phone?: string | null
  recipient_shop_name?: string | null
  received_at?: string | null
}

const STATUS_COLOUR: Record<string, string> = {
  SENT:               'bg-purple-100 text-purple-700',
  PROCESSING:         'bg-blue-100 text-blue-700',
  SENT_FOR_APPROVAL:  'bg-amber-100 text-amber-700',
  PARTIALLY_APPROVED: 'bg-orange-100 text-orange-700',
  COMPLETED:          'bg-emerald-100 text-emerald-700',
  CANCELLED:          'bg-stone-100 text-[#7A8C7E]',
  DRAFT:              'bg-stone-100 text-[#7A8C7E]',
  APPROVED:           'bg-blue-100 text-blue-700',
  PURCHASED:          'bg-emerald-100 text-emerald-700',
}

export default function CropOrdersPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const router = useRouter()
  const search = useSearchParams()
  const t = useTranslations('orders.cropOrders')
  const [tab, setTab] = useState<'order' | 'manage' | 'received'>(
    (search.get('tab') as 'order' | 'manage' | 'received') || 'order',
  )
  const [sub, setSub] = useState<Subscription | null>(null)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    // No single-subscription endpoint exists today; reuse the list and
    // filter. Cheap enough — payload is small + already cached by /home.
    api.get<Subscription[]>('/farmer/my-subscriptions')
      .then(({ data }) => {
        const match = (data || []).find(s => s.id === subscriptionId)
        if (match) setSub(match)
      })
      .catch(() => {})
  }, [subscriptionId, router])

  const todayBeforeStart = useMemo(() => {
    if (!sub?.crop_start_date) return true   // no start date yet → pre-sowing window open
    const start = new Date(sub.crop_start_date)
    return new Date() < start
  }, [sub])
  // Duration-based orders need a start_date reference to compute the
  // DAS-anchored practice windows. Pre-sowing sub-mode still renders
  // without one (it just shows the empty-state line).
  const hasStartDate = !!sub?.crop_start_date

  const tabClass = (k: typeof tab) =>
    `flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${
      tab === k ? 'border-[#3A7D44] text-[#3A7D44]' : 'border-transparent text-[#7A8C7E]'
    }`

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FARMER" back={`/crop-detail/${subscriptionId}`} />
      <div className="pt-16 pb-20">
        {/* Same company/crop anchor the Advisory / Diagnose / Ask
            Expert surfaces use, so the farmer is grounded the
            instant the page opens. */}
        <ClientCropChip subscriptionId={subscriptionId} />

        <div className="flex bg-white border-b border-[#DDD0B8] sticky top-16 z-30">
          <button onClick={() => setTab('order')}    className={tabClass('order')}>{t('tabs.order')}</button>
          <button onClick={() => setTab('manage')}   className={tabClass('manage')}>{t('tabs.manage')}</button>
          <button onClick={() => setTab('received')} className={tabClass('received')}>{t('tabs.received')}</button>
        </div>

        {tab === 'order' && (
          <OrderTab
            subscriptionId={subscriptionId}
            todayBeforeStart={todayBeforeStart}
            hasStartDate={hasStartDate}
            openHint={(search.get('open') || '').toLowerCase() as 'seed' | 'pesticide' | 'fertilizer' | ''}
            initialDateFrom={search.get('date_from') || ''}
            initialDateTo={search.get('date_to') || ''}
          />
        )}
        {tab === 'manage'   && <ManageTab subscriptionId={subscriptionId} />}
        {tab === 'received' && <ReceivedTab subscriptionId={subscriptionId} />}
      </div>
    </div>
  )
}


// ── Tab: Order ──────────────────────────────────────────────────────────────
// Three accordions. Pesticide/Fertilizer optionally surface a Pre-sowing
// sub-mode when today < crop_start_date.

function OrderTab({
  subscriptionId, todayBeforeStart, hasStartDate, openHint, initialDateFrom, initialDateTo,
}: {
  subscriptionId: string
  todayBeforeStart: boolean
  hasStartDate: boolean
  openHint: 'seed' | 'pesticide' | 'fertilizer' | ''
  initialDateFrom: string
  initialDateTo: string
}) {
  const [open, setOpen] = useState<'seed' | 'pesticide' | 'fertilizer' | null>(
    openHint || null,
  )
  const t = useTranslations('orders.cropOrders.accordions')
  return (
    <div className="p-4 space-y-2">
      <Accordion title={t('seed')} emoji="🌱" open={open === 'seed'} onToggle={() => setOpen(o => o === 'seed' ? null : 'seed')}>
        <SeedSection subscriptionId={subscriptionId} />
      </Accordion>
      <Accordion title={t('pesticide')} emoji="🧪" open={open === 'pesticide'} onToggle={() => setOpen(o => o === 'pesticide' ? null : 'pesticide')}>
        <CategorySection
          subscriptionId={subscriptionId}
          category="PESTICIDE"
          todayBeforeStart={todayBeforeStart}
          hasStartDate={hasStartDate}
          initialDateFrom={initialDateFrom}
          initialDateTo={initialDateTo}
        />
      </Accordion>
      <Accordion title={t('fertilizer')} emoji="🌾" open={open === 'fertilizer'} onToggle={() => setOpen(o => o === 'fertilizer' ? null : 'fertilizer')}>
        <CategorySection
          subscriptionId={subscriptionId}
          category="FERTILIZER"
          todayBeforeStart={todayBeforeStart}
          hasStartDate={hasStartDate}
          initialDateFrom={initialDateFrom}
          initialDateTo={initialDateTo}
        />
      </Accordion>
    </div>
  )
}

function Accordion({ title, emoji, open, onToggle, children }: {
  title: string; emoji: string
  open: boolean; onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#DDD0B8] overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{emoji}</span>
          <p className="font-semibold text-[#6B3F1F] text-sm">{title}</p>
        </div>
        <span className={`text-[#7A8C7E] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && <div className="px-4 pb-4 border-t border-[#F0E5D0]">{children}</div>}
    </div>
  )
}


function SeedSection({ subscriptionId }: { subscriptionId: string }) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.seedSection')
  return (
    <div className="pt-3 space-y-3">
      <p className="text-xs text-[#7A8C7E]">
        {t('body')}
      </p>
      <button onClick={() => router.push(`/subscribe/seed-varieties/${subscriptionId}`)}
        className="w-full py-3 rounded-xl text-white text-sm font-semibold"
        style={{ background: '#3A7D44' }}>
        {t('browseCta')}
      </button>
    </div>
  )
}


function CategorySection({
  subscriptionId, category, todayBeforeStart, hasStartDate, initialDateFrom, initialDateTo,
}: {
  subscriptionId: string
  category: 'PESTICIDE' | 'FERTILIZER'
  todayBeforeStart: boolean
  hasStartDate: boolean
  initialDateFrom: string
  initialDateTo: string
}) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.category')
  // 2026-06-03 — dateFrom is locked to today. The deep-link param is
  // ignored for From (we no longer let advisory pre-fill it to a past
  // date) — orders only flow forward from "now". To stays editable.
  const todayISO = new Date().toISOString().slice(0, 10)
  const [dateFrom, setDateFrom] = useState(todayISO)
  const [dateTo, setDateTo] = useState(initialDateTo || '')
  const [preview, setPreview] = useState<{ count: number; practice_ids: string[] } | null>(null)
  const [loading, setLoading] = useState(false)

  // Auto-preview when To-date is set. The server defaults date_from
  // to today; the From input here is purely informational and used
  // when handing off to /order/new below.
  useEffect(() => {
    if (!dateTo) { setPreview(null); return }
    let cancelled = false
    setLoading(true)
    api.get<{ count: number; practices: { id: string }[] }>(
      `/farmer/subscriptions/${subscriptionId}/order-preview?category=${category}&to_date=${dateTo}`,
    )
      .then(({ data }) => {
        if (!cancelled) {
          // Hold practice_ids alongside the count — /order/new needs
          // them in the URL so its POST hits the right bundle. Without
          // this hand-off the page's defensive empty-practices guard
          // redirects without posting.
          setPreview({
            count: data.count,
            practice_ids: (data.practices || []).map(p => p.id),
          })
        }
      })
      .catch(() => { if (!cancelled) setPreview(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [subscriptionId, category, dateTo])

  const canContinue = !!(dateFrom && dateTo && preview && preview.count > 0)

  return (
    <div className="pt-3 space-y-3">
      {/* Pre-sowing sub-mode — visible whenever today < start_date.
          We ALWAYS render it in the window so the farmer isn't
          surprised that the option doesn't appear; an empty pool
          shows an explicit "nothing recommended" line. */}
      {todayBeforeStart && (
        <PreSowingSubMode subscriptionId={subscriptionId} category={category} />
      )}

      {!hasStartDate ? (
        // Without a crop_start_date the DAS-anchored date-range
        // section just stays out. Mentioning "start date" here was
        // confusing — the farmer reads "date" and assumes it's the
        // order's date range. The dashboard owns the start-date
        // decision; this screen only surfaces what's actionable now.
        // (Reported 2026-06-02.)
        null
      ) : (
        <div>
          <p className="text-[11px] font-semibold text-[#7A8C7E] uppercase tracking-wider mb-2">
            {category === 'PESTICIDE' ? t('headerPesticide') : t('headerFertilizer')}
          </p>
          {/* 2026-06-03 — From is a locked "Today" pill (no input).
              To is a styled button overlaying a hidden native date
              picker so we control the visible DD/MM/YYYY format. */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[11px] text-[#7A8C7E]">{t('fromLabel')}</p>
              <div className="mt-1 w-full border border-[#DDD0B8] rounded-lg px-3 py-2 text-sm bg-stone-50 text-[#6B3F1F] font-medium">
                {t('todayPill')}
              </div>
            </div>
            <div>
              <p className="text-[11px] text-[#7A8C7E]">{t('toLabel')}</p>
              <div className="mt-1 relative w-full border border-[#DDD0B8] rounded-lg bg-white">
                <p className={`px-3 py-2 text-sm ${dateTo ? 'text-[#6B3F1F] font-medium' : 'text-[#7A8C7E]'}`}>
                  {dateTo
                    ? new Date(dateTo).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
                    : t('pickDate')}
                </p>
                <input type="date" value={dateTo} min={todayISO}
                  onChange={e => setDateTo(e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              </div>
            </div>
          </div>
          {dateTo && (
            <p className="text-xs text-[#7A8C7E] mt-2">
              {loading ? t('checking') :
               preview && preview.count > 0 ? t('recommendedInWindow', { count: preview.count }) :
               preview ? t('nothingInWindow') : t('noPreview')}
            </p>
          )}
          <button
            disabled={!canContinue}
            onClick={() => {
              const params = new URLSearchParams({
                category,
                order_type: category,
                date_from: dateFrom,
                date_to: dateTo,
                practice_ids: (preview?.practice_ids || []).join(','),
              })
              router.push(`/order/new/${subscriptionId}?${params.toString()}`)
            }}
            className="mt-3 w-full py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
            style={{ background: '#3A7D44' }}>
            {t('continueBtn')}
          </button>
        </div>
      )}
    </div>
  )
}


function PreSowingSubMode({ subscriptionId, category }: { subscriptionId: string; category: 'PESTICIDE' | 'FERTILIZER' }) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.preSowing')
  const [preview, setPreview] = useState<DBSPreview | null>(null)

  useEffect(() => {
    let cancelled = false
    api.get<DBSPreview>(
      `/farmer/subscriptions/${subscriptionId}/dbs-bulk-preview?category=${category}`,
    )
      .then(({ data }) => { if (!cancelled) setPreview(data) })
      .catch(() => { if (!cancelled) setPreview(null) })
    return () => { cancelled = true }
  }, [subscriptionId, category])

  if (!preview) return null
  // Spec correction (2026-06-02) — show the sub-mode in the
  // pre-sowing window even when count is zero, so the farmer
  // doesn't worry that the option is missing.

  return (
    <div className="bg-emerald-50/40 border border-[#3A7D44]/20 rounded-xl p-3">
      <p className="text-[11px] font-semibold text-[#3A7D44] uppercase tracking-wider">
        {category === 'PESTICIDE' ? t('headerPesticides') : t('headerFertilizers')}
      </p>
      {preview.available ? (
        <>
          <p className="text-sm text-[#6B3F1F] mt-1">
            {t('recommendedBeforeSowing', { count: preview.count })}
            {preview.has_locked_brand && <span className="text-[11px] text-[#7A8C7E] block mt-0.5">{t('lockedBrandApplies')}</span>}
          </p>
          <button
            onClick={() => {
              // Reuse the existing DBS flow on the Advisory page until
              // we ship a dedicated bulk-DBS surface here. Phase 3
              // mid-step: takes the farmer back to Advisory where the
              // DBS picker is wired. (Will inline in a follow-on.)
              router.push(`/advisory/${subscriptionId}`)
            }}
            className="mt-2 w-full py-2 rounded-lg text-white text-xs font-semibold"
            style={{ background: '#3A7D44' }}>
            {category === 'PESTICIDE' ? t('ctaPesticides') : t('ctaFertilizers')}
          </button>
        </>
      ) : (
        <p className="text-xs text-[#7A8C7E] mt-1">
          {t('empty')}
        </p>
      )}
    </div>
  )
}


// ── Tab: Manage ─────────────────────────────────────────────────────────────

// 2026-06-09 — Mirror Facilitator pattern on Farmer Manage tab:
// Order-ID grouped cards + 4 action pills (Routed / For Approval /
// Returned / Pickup). "With Farmer" on the facilitator is "For
// Approval" here — the farmer is the one approving. An Order ID
// card appears in multiple pills if its sub-orders span multiple
// statuses (same rule as Facilitator).
type Pill = 'routed' | 'approval' | 'returned' | 'pickup'

const PILLS: readonly Pill[] = ['routed', 'approval', 'returned', 'pickup'] as const

function subBelongsToPill(o: SubOrder, pill: Pill): boolean {
  // Terminal sub-orders never show in active pills — they belong
  // to History (separate surface, Batch 3).
  // 2026-06-20 — EXPIRED added: an order whose window lapsed without
  // farmer-receipt is terminal too. Pre-fix it leaked into Routed and
  // its tap-target crashed (user report).
  if (['CANCELLED', 'PURCHASED', 'REJECTED', 'REROUTED', 'EXPIRED'].includes(o.status)) {
    return false
  }

  if (o.kind === 'SEED') {
    // Seed lifecycle uses status directly (no per-item counts).
    switch (pill) {
      case 'routed':
        return ['DRAFT', 'SENT', 'ACCEPTED', 'AVAILABLE', 'POSTPONED'].includes(o.status)
      case 'approval':
        return o.status === 'SENT_FOR_APPROVAL'
      case 'returned':
        return o.status === 'NOT_AVAILABLE'
      case 'pickup':
        // 2026-06-19 — Seeds now have a physical-pickup step.
        // Farmer-approve lands the order at READY_FOR_PICKUP; the
        // Pickup pill surfaces it with an inline "I've picked up
        // the seed" button. Either farmer or dealer (via /handover)
        // closes the order — whichever taps first wins.
        return o.status === 'READY_FOR_PICKUP'
    }
  }

  const awaiting = o.awaiting_approval_count ?? 0
  const returned = o.returned_count ?? 0
  const pickup = o.pickup_ready_count ?? 0
  switch (pill) {
    case 'routed':
      // Dealer is processing or order is DRAFT awaiting send.
      // Nothing else needs farmer attention. COMPLETED-with-leftover
      // (NA / postponed) drops to Returned / Routed via their own
      // counts; truly-done COMPLETED filtered out earlier.
      return awaiting === 0 && returned === 0 && pickup === 0
    case 'approval':
      return awaiting > 0
    case 'returned':
      return returned > 0
    case 'pickup':
      return pickup > 0
  }
}

function ManageTab({ subscriptionId }: { subscriptionId: string }) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.manage')
  const search = useSearchParams()
  const [orders, setOrders] = useState<SubOrder[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // 2026-06-19 — Pill is URL-controllable via ?pill=, mirroring the
  // pattern on /dealer/orders. Lets handlers from other pages
  // (seed approve, mark-received redirects) land the farmer on
  // the right pill without an extra tap.
  const initialPill = (search.get('pill') as Pill) || 'approval'
  const [pill, setPill] = useState<Pill>(initialPill)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  async function load() {
    const { data } = await api.get<{ orders: SubOrder[] }>(
      `/farmer/subscriptions/${subscriptionId}/orders`,
    )
    // 2026-06-03 — Manage hides truly-done orders, but a COMPLETED
    // order can still have NA items the farmer hasn't rerouted yet
    // (dealer marked them NA, farmer approved the rest, order moved
    // to COMPLETED). Keep COMPLETED orders visible whenever there's
    // any returned_count or postponed_count outstanding so the
    // farmer can still reach their review page and reroute.
    setOrders((data.orders || []).filter(o => {
      if (o.status === 'PURCHASED') return false
      if (o.status === 'COMPLETED' &&
          !(o.returned_count || 0) &&
          !(o.postponed_count || 0)) return false
      return true
    }))
  }
  useEffect(() => { load().catch(() => setOrders([])) }, [subscriptionId])

  async function cancel(orderId: string, kind: 'REGULAR' | 'SEED') {
    // 2026-06-06 — Seed cancel uses the seed-specific endpoint which
    // returns a `new_draft_seed_order_id`. The husk becomes
    // CANCELLED; the draft carries the variety + quantity so the
    // farmer can pick a new recipient without re-keying. Regular
    // cancel keeps its existing behaviour (items flip to NA, husk
    // stays for forward/delete).
    if (kind === 'SEED') {
      if (!confirm(t('confirmCancelSeed'))) return
      setBusy(orderId)
      try {
        const { data } = await api.put<{ status: string; new_draft_seed_order_id?: string }>(
          `/farmer/seed-orders/${orderId}/cancel`, {},
        )
        const draftId = data?.new_draft_seed_order_id
        if (draftId) {
          router.push(`/seed-orders/${draftId}`)
        } else {
          await load()
        }
      } finally { setBusy(null) }
      return
    }
    if (!confirm(t('confirmCancelRegular'))) return
    setBusy(orderId)
    try {
      await api.put(`/farmer/orders/${orderId}/cancel`, {})
      await load()
    } finally { setBusy(null) }
  }

  async function deleteOrder(orderId: string, kind: 'REGULAR' | 'SEED') {
    // 2026-06-09 — Delete now covers two cases: CANCELLED husks
    // (existing) and DRAFT (e.g. from dealer-decline cancel-and-
    // migrate where the farmer wants to discard rather than send).
    // Look up the order's current status so the confirm copy reads
    // right.
    const target = (orders || []).find(o => o.id === orderId)
    const isDraft = target?.status === 'DRAFT'
    if (!confirm(isDraft ? t('confirmDeleteDraft') : t('confirmDeleteCancelled'))) return
    setBusy(orderId)
    try {
      if (kind === 'SEED') {
        await api.delete(`/farmer/seed-orders/${orderId}`)
      } else {
        await api.delete(`/farmer/orders/${orderId}`)
      }
      await load()
    } finally { setBusy(null) }
  }

  async function approveAll(orderId: string, kind: 'REGULAR' | 'SEED') {
    setBusy(orderId)
    try {
      if (kind === 'SEED') {
        await api.put(`/farmer/seed-orders/${orderId}/approve`, {})
        // 2026-06-19 — Seed-approve moves the order into the Pickup
        // pill where the farmer's mark-received button lives. Hop the
        // pill so the next CTA is visible without a fresh tap.
        setPill('pickup')
      } else {
        await api.put(`/farmer/orders/${orderId}/items/approve-all`, {})
      }
      await load()
    } finally { setBusy(null) }
  }

  // 2026-06-19 — Farmer confirms physical pickup of a seed order.
  // Either-actor-wins: dealer's /handover does the same transition
  // (READY_FOR_PICKUP → PURCHASED); whichever side taps first wins.
  async function markReceivedSeed(orderId: string) {
    setBusy(orderId)
    try {
      await api.put(`/farmer/seed-orders/${orderId}/mark-received`, {})
      await load()
    } catch {
      alert(t('errorMarkReceivedSeed'))
    } finally { setBusy(null) }
  }

  // 2026-06-06 — Inline reroute action routes directly to the focused
  // forward page (which handles the postponed nudge + picker without
  // a review-page detour). User direction: keep the Manage card
  // tap-target scoped to the two underlined links only.
  function rerouteReturned(orderId: string) {
    router.push(`/orders/${orderId}/forward`)
  }

  if (orders === null) return <div className="m-4 h-20 bg-white/60 rounded-2xl animate-pulse" />
  if (orders.length === 0) {
    return (
      <div className="p-4">
        <div className="bg-white border border-[#DDD0B8] rounded-2xl p-6 text-center">
          <p className="text-sm text-[#7A8C7E]">{t('emptyAwaiting')}</p>
        </div>
      </div>
    )
  }

  // 2026-06-09 — Group sub-orders by reference_number (Order ID).
  // Pre-batch-1 rows may have null reference_number; fall back to
  // lineage_root_id, then to the row id. Sub-orders within a group
  // sort by created_at ascending so the first is the original root.
  const groups = (() => {
    const map = new Map<string, SubOrder[]>()
    for (const o of orders || []) {
      const key = o.reference_number || o.lineage_root_id || o.id
      const list = map.get(key)
      if (list) list.push(o)
      else map.set(key, [o])
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
    return map
  })()

  // 2026-06-05 — Approval queue (kept inside the For Approval pill
  // per user direction 2026-06-09). Show approvals one at a time in
  // arrival order with a "1 of N" peek so the farmer knows others
  // are queued. Independent decisions (Returned / Pickup / Routed)
  // are shown all-at-once on their respective pills.
  const allAwaiting = (orders || [])
    .filter(o => (o.awaiting_approval_count || 0) > 0)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const currentAwaiting = allAwaiting[0]
  const otherAwaiting = allAwaiting.slice(1)

  // Pill counts: count GROUPS that have at least one matching
  // sub-order (matches what the user sees rendered).
  const counts: Record<Pill, number> = { routed: 0, approval: 0, returned: 0, pickup: 0 }
  for (const list of groups.values()) {
    for (const p of PILLS) {
      if (list.some(o => subBelongsToPill(o, p))) counts[p] += 1
    }
  }

  // Visible groups for the selected pill.
  const visibleGroups: { key: string; subs: SubOrder[]; matching: SubOrder[] }[] = []
  for (const [key, list] of groups.entries()) {
    let matching = list.filter(o => subBelongsToPill(o, pill))
    // Approval-queue: only the earliest approval sub-order shows
    // when on the For Approval pill — others wait behind.
    if (pill === 'approval' && matching.length > 0 && currentAwaiting) {
      matching = matching.filter(o => o.id === currentAwaiting.id)
    }
    if (matching.length > 0) {
      visibleGroups.push({ key, subs: list, matching })
    }
  }
  visibleGroups.sort((a, b) => {
    const aT = Math.max(...a.subs.map(o => new Date(o.created_at).getTime()))
    const bT = Math.max(...b.subs.map(o => new Date(o.created_at).getTime()))
    return bT - aT
  })

  return (
    <div className="p-4 space-y-3">
      {/* Pill row + History link. Mirrors the dealer-orders feed
          layout (2026-06-19): pills wrap naturally (no horizontal
          scroll), History sits absolute at row-2 right, aligned
          with the wrapped pill — emerging behind the 4-pill row's
          empty slot. */}
      <div className="relative">
        <div className="flex flex-wrap gap-2">
          {PILLS.map(p => {
            const active = pill === p
            const n = counts[p]
            return (
              <button key={p} onClick={() => setPill(p)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  active
                    ? 'bg-[#3A7D44] text-white border-[#3A7D44]'
                    : 'bg-white text-[#6B3F1F] border-[#DDD0B8]'
                }`}>
                <span>{t(`pill.${p}`)}</span>
                {/* 2026-06-09 — Count badge: filled circle so the
                    task-load reads at a glance. Tinted for the
                    active pill (white on green), role accent for
                    inactive pills. Zero is muted so the eye skips. */}
                <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                  active
                    ? 'bg-white/25 text-white'
                    : n === 0
                      ? 'bg-stone-100 text-[#7A8C7E]'
                      : 'bg-[#3A7D44]/15 text-[#3A7D44]'
                }`}>{n}</span>
              </button>
            )
          })}
        </div>
        {/* History — absolute at row-2 right (mirrors the dealer
            feed). Row 2 typically holds the 4th pill alone on a
            phone-width column, leaving generous empty space to the
            right where History sits. */}
        <button onClick={() => router.push(`/crop-detail/${subscriptionId}/orders/history`)}
          className="absolute top-[40px] right-0 text-xs font-semibold text-[#7A8C7E] active:text-[#3A7D44]">
          📁 {t('historyChip')} →
        </button>
      </div>

      {/* Approval 1-of-N peek banner — only shown on the For
          Approval pill when more approvals are queued behind the
          current one. Per user direction 2026-06-09. */}
      {pill === 'approval' && currentAwaiting && otherAwaiting.length > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2 text-xs text-indigo-800">
          {t('approvalPeek')} <strong>{t('approvalPeekProgress', { total: allAwaiting.length })}</strong> ·{' '}
          <span className="text-indigo-600">{t('approvalPeekHint')}</span>
        </div>
      )}

      {visibleGroups.length === 0 && (
        <div className="bg-white border border-[#DDD0B8] rounded-2xl p-6 text-center">
          <p className="text-sm text-[#7A8C7E]">{t('emptyPill', { pillName: t(`pill.${pill}`) })}</p>
        </div>
      )}

      {visibleGroups.map(({ key, subs, matching }) => (
        <OrderIdCard
          key={key}
          orderId={subs[0]?.reference_number || subs[0]?.id || 'unknown'}
          subs={subs}
          matching={matching}
          pill={pill}
          expanded={expandedGroup === key}
          onToggleExpand={() => setExpandedGroup(expandedGroup === key ? null : key)}
          onCancel={(id, kind) => cancel(id, kind)}
          onDelete={(id, kind) => deleteOrder(id, kind)}
          onForwardReturned={rerouteReturned}
          onMarkReceivedSeed={markReceivedSeed}
          busy={busy}
        />
      ))}
    </div>
  )
}

// ── Per-pill chunk renderers + Order-ID card (Batch 1, 2026-06-09) ─────────

function OrderIdCard({
  orderId, subs, matching, pill, expanded, onToggleExpand,
  onCancel, onDelete, onForwardReturned, onMarkReceivedSeed, busy,
}: {
  orderId: string
  subs: SubOrder[]
  matching: SubOrder[]
  pill: Pill
  expanded: boolean
  onToggleExpand: () => void
  onCancel: (id: string, kind: 'REGULAR' | 'SEED') => void
  onDelete: (id: string, kind: 'REGULAR' | 'SEED') => void
  onForwardReturned: (id: string) => void
  onMarkReceivedSeed: (id: string) => void
  busy: string | null
}) {
  const t = useTranslations('orders.cropOrders.manage')
  const head = subs[0]
  // Single-chunk inline; multi-chunk (e.g. lineage has two sibling
  // sub-orders both with returned items) renders as rows with
  // "Sub-order · date" micro-header.
  const renderRows = matching.length > 1

  // Cancel allowed when source has live work + farmer hasn't
  // already cancelled it. Cancel walks the lineage server-side
  // (per Batch 6: cascade across siblings, all migrate to one
  // new DRAFT). So we offer Cancel at the Order-ID level.
  const liveSubs = subs.filter(s =>
    !['CANCELLED', 'PURCHASED', 'COMPLETED', 'REJECTED', 'REROUTED', 'EXPIRED'].includes(s.status),
  )
  // 2026-06-09 — Cancel-on-DRAFT was visually a no-op (cancel-and-
  // migrate creates another DRAFT with the same items, so the user
  // sees no change and thinks Cancel failed). DRAFT now offers a
  // Delete action instead (different button below) — the review
  // page already excludes DRAFT from canCancel.
  const cancellable = liveSubs.find(s => {
    if (s.kind === 'SEED') {
      return !['DRAFT', 'SENT_FOR_APPROVAL'].includes(s.status)
    }
    return s.status !== 'DRAFT' && (s.awaiting_approval_count || 0) === 0
  })
  // A DRAFT sub-order is deletable. Typically arrives via
  // dealer-decline cancel-and-migrate; farmer can discard it
  // entirely instead of picking a recipient.
  const deletable = liveSubs.find(s =>
    s.kind === 'REGULAR' && s.status === 'DRAFT',
  )

  return (
    <div className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
      <OrderCardHeader head={head} subCount={subs.length} expanded={expanded}
        onToggleExpand={onToggleExpand} orderId={orderId} />
      <div className="divide-y divide-[#F0E5D0]">
        {renderRows
          ? matching.map(sub => (
              <FarmerPillChunk key={sub.id} sub={sub} pill={pill}
                onForwardReturned={onForwardReturned}
                onMarkReceivedSeed={onMarkReceivedSeed}
                busy={busy} showSubHeader />
            ))
          : matching.length === 1 && (
              <FarmerPillChunk sub={matching[0]} pill={pill}
                onForwardReturned={onForwardReturned}
                onMarkReceivedSeed={onMarkReceivedSeed}
                busy={busy} />
            )
        }
      </div>
      {expanded && (
        <ExpandedSubOrderList subs={subs} />
      )}
      {/* Cancel / cleanup row — surfaced at the Order ID level
          because cancel cascades across the lineage. */}
      {cancellable && (
        <div className="border-t border-[#F0E5D0] px-4 py-2">
          <button onClick={() => onCancel(cancellable.id, cancellable.kind)}
            disabled={busy === cancellable.id}
            className="w-full py-1.5 rounded-lg border border-red-300 text-red-600 text-xs font-medium disabled:opacity-50">
            {busy === cancellable.id ? '…' : t('cancelOrderBtn')}
          </button>
        </div>
      )}
      {/* 2026-06-09 — Delete DRAFT. Per user direction: cancel-and-
          migrate on a DRAFT is a no-op visually (it creates an
          identical DRAFT), so DRAFT gets a real Delete instead. */}
      {!cancellable && deletable && (
        <div className="border-t border-[#F0E5D0] px-4 py-2">
          <button onClick={() => onDelete(deletable.id, deletable.kind)}
            disabled={busy === deletable.id}
            className="w-full py-1.5 rounded-lg border border-red-300 text-red-600 text-xs font-medium disabled:opacity-50">
            {busy === deletable.id ? '…' : t('deleteDraftBtn')}
          </button>
        </div>
      )}
    </div>
  )
}

function OrderCardHeader({
  head, subCount, expanded, onToggleExpand, orderId,
}: {
  head: SubOrder | undefined
  subCount: number
  expanded: boolean
  onToggleExpand: () => void
  orderId: string
}) {
  const t = useTranslations('orders.cropOrders.orderHeader')
  const locale = useLocale()
  return (
    <div className="px-4 py-3 bg-[#F5F0E8]/40">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-semibold text-[#7A8C7E] uppercase tracking-wider">
            {head?.kind === 'SEED' ? t('kindSeed') : (head?.category?.toLowerCase() || t('kindFallback'))}
          </span>
        </div>
        <span className="text-[10px] text-[#7A8C7E]">
          {head?.created_at && new Date(head.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
        </span>
      </div>
      <p className="text-[10px] font-mono tracking-wide text-[#3A7D44]">
        {orderId}
      </p>
      {head?.kind === 'SEED' ? (
        <p className="text-sm text-[#6B3F1F] truncate mt-1">{head.variety_name || t('seedFallback')}</p>
      ) : (
        <p className="text-sm text-[#6B3F1F] mt-1">
          {head?.date_from && head?.date_to ? (
            <>
              {new Date(head.date_from).toLocaleDateString(locale, { day: '2-digit', month: 'short' })} —
              {' '}{new Date(head.date_to).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
            </>
          ) : null}
        </p>
      )}
      {subCount > 1 && (
        <button onClick={onToggleExpand}
          className="text-[10px] font-semibold text-[#7A8C7E] mt-2 flex items-center gap-1">
          {expanded ? '▾' : '▸'} {t('expandSubs', { count: subCount })}
        </button>
      )}
    </div>
  )
}

function FarmerPillChunk({
  sub, pill, onForwardReturned, onMarkReceivedSeed, busy, showSubHeader,
}: {
  sub: SubOrder
  pill: Pill
  onForwardReturned: (id: string) => void
  onMarkReceivedSeed: (id: string) => void
  busy: string | null
  showSubHeader?: boolean
}) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.chunk')
  const locale = useLocale()
  return (
    <div className="px-4 py-3 space-y-2">
      {showSubHeader && (
        <p className="text-[10px] font-mono tracking-wide text-[#7A8C7E]">
          {t('subOrderPrefix')} {new Date(sub.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
        </p>
      )}
      <RecipientLine
        name={sub.recipient_name}
        shopName={sub.recipient_shop_name}
        phone={sub.recipient_phone}
        role={sub.recipient_role}
      />
      {pill === 'routed' && <RoutedChunk sub={sub} />}
      {pill === 'approval' && <ApprovalChunk sub={sub} />}
      {pill === 'returned' && (
        <ReturnedChunk sub={sub} onForwardReturned={onForwardReturned} busy={busy} />
      )}
      {pill === 'pickup' && (
        sub.kind === 'SEED' ? (
          <SeedPickupChunk sub={sub} onMarkReceived={onMarkReceivedSeed} busy={busy} />
        ) : (
          <PickupChunk sub={sub} />
        )
      )}
      {(pill === 'routed' || pill === 'approval') && (
        <PostponedStrip sub={sub} pill={pill} />
      )}
    </div>
  )
}

// 2026-06-19 — Farmer-side seed pickup confirmation. Mirrors the
// dealer's inline handover chunk on /dealer/orders Packing pill:
// banner + single CTA, no surface hop. Either-actor-wins semantics
// against /dealer/seed-orders/{id}/handover.
function SeedPickupChunk({
  sub, onMarkReceived, busy,
}: {
  sub: SubOrder
  onMarkReceived: (id: string) => void
  busy: string | null
}) {
  const t = useTranslations('orders.cropOrders.chunk')
  return (
    <div className="bg-emerald-50 rounded-xl p-3 space-y-2">
      <p className="text-xs text-emerald-900 text-center font-medium">
        {t('seedPickupBanner')}
      </p>
      <button onClick={() => onMarkReceived(sub.id)}
        disabled={busy === sub.id}
        className="w-full bg-emerald-600 disabled:bg-emerald-300 text-white text-xs font-semibold py-2.5 rounded-xl">
        {busy === sub.id ? t('seedPickupBusy') : t('seedPickupCta')}
      </button>
    </div>
  )
}

// 2026-06-09 — Postponed strip with three render variants:
// - Active "Send to another dealer" — direct dealer + Routed pill
//   (no SFA / NA / pickup in play here, so the farmer can act).
//   Routes to /orders/[id]/forward where the include-postponed
//   nudge sheet already lives. The user picks "Include postponed"
//   in the nudge → /reroute-returned fires with include_postponed:
//   true → server flips postponed items to NA and bundles them
//   into the new DRAFT.
// - Passive "your facilitator is handling" — facilitator owns the
//   order; postponed items belong to the facilitator's queue.
// - Passive "dealer is following up" — fallback (Approval pill,
//   seeds, etc.) where the farmer shouldn't act yet.
function PostponedStrip({ sub, pill }: { sub: SubOrder; pill: Pill }) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.chunk')
  const n = sub.postponed_count ?? 0
  if (n === 0) return null

  if (sub.facilitator_user_id) {
    return (
      <div className="bg-amber-50/40 rounded-lg px-3 py-2">
        <p className="text-xs text-amber-800">
          {t('postponedFacilitatorHandling', { count: n })}
        </p>
      </div>
    )
  }

  // Active variant: Routed pill on a regular (non-seed) order.
  // Seeds don't go through /forward; passive fallback for them.
  if (pill === 'routed' && sub.kind === 'REGULAR') {
    return (
      <div className="bg-amber-50/60 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
        <p className="text-xs text-amber-800">
          {t('postponedCount', { count: n })}
        </p>
        <button onClick={() => router.push(`/orders/${sub.id}/forward`)}
          className="text-xs font-semibold text-amber-800 underline">
          {t('sendToAnotherDealer')}
        </button>
      </div>
    )
  }

  return (
    <div className="bg-amber-50/40 rounded-lg px-3 py-2">
      <p className="text-xs text-amber-800">
        {t('postponedDealerFollowUp', { count: n })}
      </p>
    </div>
  )
}

function RoutedChunk({ sub }: { sub: SubOrder }) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.chunk')
  if (sub.kind === 'REGULAR' && sub.status === 'DRAFT') {
    return (
      <div className="space-y-2">
        <p className="text-xs text-amber-700">
          {t('draftPickRecipient')}
        </p>
        <button onClick={() => router.push(`/orders/${sub.id}`)}
          className="w-full py-2 rounded-lg text-white text-xs font-semibold"
          style={{ background: '#3A7D44' }}>
          {t('pickRecipientCta')}
        </button>
      </div>
    )
  }
  if (sub.kind === 'SEED' && sub.status === 'DRAFT') {
    return (
      <div className="space-y-2">
        <p className="text-xs text-amber-700">
          {t('draftPickRecipient')}
        </p>
        <button onClick={() => router.push(`/seed-orders/${sub.id}`)}
          className="w-full py-2 rounded-lg text-white text-xs font-semibold"
          style={{ background: '#3A7D44' }}>
          {t('pickRecipientCta')}
        </button>
      </div>
    )
  }
  return (
    <p className="text-xs text-[#7A8C7E]">
      {sub.item_count !== undefined && sub.item_count > 0
        ? t('itemsCountPrefix', { count: sub.item_count })
        : ''}
      {t('dealerProcessing')}
    </p>
  )
}

function ApprovalChunk({ sub }: { sub: SubOrder }) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.chunk')
  const awaiting = sub.awaiting_approval_count ?? 0
  return (
    <div className="bg-emerald-50/40 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
      <p className="text-xs text-[#3A7D44]">
        {t('awaitingApproval', { count: awaiting })}
      </p>
      <button
        onClick={() => router.push(sub.kind === 'SEED' ? `/seed-orders/${sub.id}` : `/orders/${sub.id}`)}
        className="text-xs font-semibold text-white px-3 py-1 rounded-lg"
        style={{ background: '#3A7D44' }}>
        {t('approveCta')}
      </button>
    </div>
  )
}

function ReturnedChunk({
  sub, onForwardReturned, busy,
}: {
  sub: SubOrder
  onForwardReturned: (id: string) => void
  busy: string | null
}) {
  const t = useTranslations('orders.cropOrders.chunk')
  const returned = sub.returned_count ?? (sub.status === 'NOT_AVAILABLE' ? 1 : 0)
  // Facilitator-owned: returned items belong to the facilitator's
  // queue. Farmer sees a passive note.
  if (sub.facilitator_user_id) {
    return (
      <div className="bg-amber-50/60 rounded-lg px-3 py-2">
        <p className="text-xs text-amber-800">
          {t('returnedFacilitatorHandling', { count: returned })}
        </p>
      </div>
    )
  }
  return (
    <div className="bg-amber-50/60 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
      <p className="text-xs text-amber-800">
        {t('returnedCount', { count: returned })}
      </p>
      <button onClick={() => onForwardReturned(sub.id)} disabled={busy === sub.id}
        className="text-xs font-semibold text-amber-800 underline disabled:opacity-50">
        {busy === sub.id ? '…' : t('sendToAnotherDealer')}
      </button>
    </div>
  )
}

// 2026-06-09 — Pickup chunk parity with the Facilitator pickup
// card composition. Packing ID is the lead identifier (mono
// banner); the count + recipient line sits beneath; the Confirm
// CTA routes to the full /orders/[id]/pickup surface where the
// item list + total + I-have-received button live.
function PickupChunk({ sub }: { sub: SubOrder }) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.chunk')
  const count = sub.pickup_ready_count ?? 0
  const receiveMode = sub.packing_picked_up_by_role === 'FACILITATOR'
  const fromName = sub.recipient_shop_name || sub.recipient_name
  return (
    <button
      onClick={() => router.push(`/orders/${sub.id}/pickup`)}
      className="w-full bg-white rounded-lg border border-emerald-300 overflow-hidden text-left active:bg-emerald-50/50">
      {sub.packing_code && (
        <div className="px-3 py-1.5 bg-emerald-600 text-white flex items-baseline justify-between">
          <p className="text-[9px] uppercase tracking-wider opacity-75">{t('packingIdLabel')}</p>
          <p className="text-xs font-bold font-mono tracking-widest">{sub.packing_code}</p>
        </div>
      )}
      <div className="px-3 py-2 flex items-center justify-between gap-3 bg-emerald-50">
        <p className="text-xs text-emerald-800">
          {receiveMode ? t('receivePrefix') : t('pickupPrefix')}{' '}
          <strong>{t('pickupItemCount', { count })}</strong>
          {fromName && (
            <> {t('fromConnector')} <strong>{fromName}</strong></>
          )}
        </p>
        <span className="text-xs font-semibold text-emerald-700 underline shrink-0">
          {t('confirmCta')}
        </span>
      </div>
    </button>
  )
}

// 2026-06-20 — Terminal sub-orders (EXPIRED, CANCELLED, REJECTED,
// REROUTED) shown in the expanded lineage list for context, but their
// row isn't tappable — the order detail page assumes a live order and
// crashes on terminal statuses. Live rows still tap through.
const TERMINAL_SUB_STATUSES = new Set([
  'EXPIRED', 'CANCELLED', 'REJECTED', 'REROUTED', 'PURCHASED', 'COMPLETED',
])

function ExpandedSubOrderList({ subs }: { subs: SubOrder[] }) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.expanded')
  const tOrdersCommon = useTranslations('orders.common')
  const locale = useLocale()
  return (
    <div className="bg-[#F5F0E8]/50 px-4 py-3 border-t border-[#F0E5D0]">
      <p className="text-[10px] font-semibold text-[#7A8C7E] uppercase tracking-wider mb-2">
        {t('allSubOrders', { count: subs.length })}
      </p>
      <div className="space-y-2">
        {subs.map(sub => {
          const terminal = TERMINAL_SUB_STATUSES.has(sub.status)
          const body = (
            <>
              <div className="min-w-0">
                <p className="text-xs text-[#6B3F1F] truncate">
                  {sub.recipient_shop_name || sub.recipient_name || t('noRecipient')}
                </p>
                <p className="text-[10px] text-[#7A8C7E]">
                  {new Date(sub.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
                  {sub.item_count !== undefined && sub.item_count > 0 && (
                    <> · {tOrdersCommon('itemsCount', { count: sub.item_count })}</>
                  )}
                </p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLOUR[sub.status] || 'bg-slate-100 text-[#7A8C7E]'}`}>
                {sub.status.replace(/_/g, ' ')}
              </span>
            </>
          )
          if (terminal) {
            return (
              <div key={sub.id}
                className="w-full flex items-center justify-between gap-2 bg-white/60 border border-[#DDD0B8] rounded-lg px-3 py-2 opacity-70">
                {body}
              </div>
            )
          }
          return (
            <button key={sub.id}
              onClick={() => router.push(sub.kind === 'SEED' ? `/seed-orders/${sub.id}` : `/orders/${sub.id}`)}
              className="w-full text-left flex items-center justify-between gap-2 bg-white border border-[#DDD0B8] rounded-lg px-3 py-2">
              {body}
            </button>
          )
        })}
      </div>
    </div>
  )
}



// ── Tab: Received ───────────────────────────────────────────────────────────

interface SeedPurchased {
  id: string; status: string; variety_name?: string | null
  unit?: string | null; quantity?: number | null
  total_price?: number | null; created_at: string
  subscription_id: string
  recipient_name?: string | null
  recipient_shop_name?: string | null
  recipient_phone?: string | null
  recipient_role?: 'DEALER' | 'FACILITATOR' | null
}

function ReceivedTab({ subscriptionId }: { subscriptionId: string }) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.received')
  const tChunk = useTranslations('orders.cropOrders.chunk')
  const locale = useLocale()
  const [items, setItems] = useState<PurchasedItem[] | null>(null)
  const [seeds, setSeeds] = useState<SeedPurchased[] | null>(null)
  // 2026-06-09 (restored) — "Ready to pick up" strip on top of the
  // Received tab. Surfaces approved-but-not-yet-confirmed orders
  // (pickup_ready_count > 0) so the farmer is naturally nudged to
  // confirm receipt before browsing their actually-received items.
  // Mirror of the Manage tab's Pickup pill but with the awaiting
  // items front-and-centre on the receiving surface.
  const [pickupReady, setPickupReady] = useState<SubOrder[] | null>(null)
  useEffect(() => {
    api.get<PurchasedItem[]>(`/farmer/purchased-items?subscription_id=${subscriptionId}`)
      .then(({ data }) => setItems(data))
      .catch(() => setItems([]))
    api.get<SeedPurchased[]>(`/farmer/seed-orders`)
      .then(({ data }) => setSeeds(data.filter(s =>
        s.subscription_id === subscriptionId && s.status === 'PURCHASED'
      )))
      .catch(() => setSeeds([]))
    api.get<{ orders: SubOrder[] }>(`/farmer/subscriptions/${subscriptionId}/orders`)
      .then(({ data }) => setPickupReady(
        (data.orders || []).filter(o => (o.pickup_ready_count ?? 0) > 0)
      ))
      .catch(() => setPickupReady([]))
  }, [subscriptionId])

  if (items === null || seeds === null || pickupReady === null) return <div className="m-4 h-20 bg-white/60 rounded-2xl animate-pulse" />
  if (items.length === 0 && seeds.length === 0 && pickupReady.length === 0) {
    return (
      <div className="p-4">
        <div className="bg-white border border-[#DDD0B8] rounded-2xl p-6 text-center">
          <p className="text-sm text-[#7A8C7E]">{t('emptyTitle')}</p>
          <p className="text-xs text-[#7A8C7E] mt-1">
            {t('emptyHint')}
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="p-4 space-y-3">
      {pickupReady.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wider px-1">
            {pickupReady.every(o => o.packing_picked_up_by_role === 'FACILITATOR')
              ? t('readyToReceive')
              : t('readyToPickUp')}
          </p>
          {pickupReady.map(o => {
            const receiveMode = o.packing_picked_up_by_role === 'FACILITATOR'
            const fromName = o.recipient_shop_name || o.recipient_name
            return (
              <button key={o.id}
                onClick={() => router.push(`/orders/${o.id}/pickup`)}
                className="w-full bg-white rounded-2xl border border-emerald-300 shadow-sm overflow-hidden text-left active:scale-[0.99] transition-transform">
                {o.packing_code && (
                  <div className="px-4 py-1.5 bg-emerald-600 text-white flex items-baseline justify-between">
                    <p className="text-[10px] uppercase tracking-wider opacity-75">{tChunk('packingIdLabel')}</p>
                    <p className="text-sm font-bold font-mono tracking-widest">{o.packing_code}</p>
                  </div>
                )}
                <div className="p-4">
                  <p className="text-sm text-emerald-800">
                    {receiveMode ? t('receivePrefix') : t('pickupPrefix')}{' '}
                    <strong>{tChunk('pickupItemCount', { count: o.pickup_ready_count ?? 0 })}</strong>
                    {fromName && <> {tChunk('fromConnector')} <strong>{fromName}</strong></>}
                  </p>
                  <p className="text-[11px] text-emerald-700 mt-1 font-semibold">
                    {t('tapToConfirm')}
                  </p>
                </div>
              </button>
            )
          })}
        </section>
      )}
      {seeds.map(s => (
        <div key={s.id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm p-4">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <span className="text-[10px] uppercase tracking-wide text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded-full font-semibold">{t('seedBadge')}</span>
              <p className="font-semibold text-[#6B3F1F] truncate mt-1">{s.variety_name || t('seedVarietyFallback')}</p>
            </div>
            {s.quantity != null && s.unit && (
              <p className="text-xs text-[#7A8C7E] shrink-0">{s.quantity} {s.unit}{s.total_price != null ? ` · ₹${s.total_price}` : ''}</p>
            )}
          </div>
          <p className="text-[11px] text-[#7A8C7E] mt-1">
            {t('purchasedOn', { date: new Date(s.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short' }) })}
          </p>
          <RecipientLine
            name={s.recipient_name}
            shopName={s.recipient_shop_name}
            phone={s.recipient_phone}
            role={s.recipient_role}
          />
        </div>
      ))}
      {items.map(it => (
        <div key={it.id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
          <div className="p-4">
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-[#6B3F1F] truncate">{it.brand_name || t('unknownBrand')}</p>
                {it.manufacturer_name && (
                  <p className="text-xs text-[#7A8C7E] truncate">{t('byManufacturer', { manufacturer: it.manufacturer_name })}</p>
                )}
              </div>
              {it.given_volume != null && it.volume_unit && (
                <p className="text-xs text-[#7A8C7E] shrink-0">{it.given_volume} {it.volume_unit}{it.price != null ? ` · ₹${it.price}` : ''}</p>
              )}
            </div>
            {(it.application_date_from && it.application_date_to) && (
              <p className="text-[11px] text-[#7A8C7E] mt-1">
                {t('applyDates', {
                  from: new Date(it.application_date_from).toLocaleDateString(locale, { day: '2-digit', month: 'short' }),
                  to: new Date(it.application_date_to).toLocaleDateString(locale, { day: '2-digit', month: 'short' }),
                })}
                {it.merged_timeline_count && it.merged_timeline_count > 1 && (
                  <span className="ml-1 text-[#7A8C7E]">{t('acrossTimelines', { count: it.merged_timeline_count })}</span>
                )}
              </p>
            )}
            {it.l2_type && (
              <p className="text-[10px] text-[#7A8C7E] mt-0.5">{it.l2_type.replace(/_/g, ' ')}</p>
            )}
            {it.received_at && (
              <p className="text-[11px] text-[#7A8C7E] mt-1">
                {t('receivedOn', { date: new Date(it.received_at).toLocaleDateString(locale, { day: '2-digit', month: 'short' }) })}
              </p>
            )}
          </div>
          {/* 2026-06-06 — Recipient line on every Received card so the
              farmer can call the dealer / facilitator easily. Matches
              the seed-order card shape. Phone is a tel: link. */}
          {(it.recipient_shop_name || it.recipient_name || it.recipient_phone) && (
            <RecipientCardLine
              recipientName={it.recipient_name}
              recipientShopName={it.recipient_shop_name}
              recipientPhone={it.recipient_phone}
              recipientRole={it.recipient_role}
            />
          )}
        </div>
      ))}
    </div>
  )
}


// Recipient sub-line on every Order card. Shop name leads when the
// holder is a dealer (that's how farmers recognise them); for a
// facilitator the personal name leads. Phone is a tel: link so it
// dials on tap. All nullable — renders nothing if every field is
// blank (e.g. a DRAFT order with no recipient set yet).
function RecipientLine({
  name, shopName, phone, role,
}: {
  name?: string | null
  shopName?: string | null
  phone?: string | null
  role?: 'DEALER' | 'FACILITATOR' | null
}) {
  const t = useTranslations('orders.cropOrders.recipient')
  if (!name && !shopName && !phone) return null
  const primary = role === 'DEALER' ? (shopName || name) : (name || shopName)
  const secondary = role === 'DEALER'
    ? (name && shopName && name !== shopName ? t('nameWithDealer', { name }) : t('dealerLabel'))
    : t('facilitatorLabel')
  return (
    <div className="mt-1.5 pt-1.5 border-t border-[#F0E5D0] flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[#6B3F1F] truncate">{primary || secondary}</p>
        {primary && (
          <p className="text-[10px] text-[#7A8C7E] truncate">{secondary}</p>
        )}
      </div>
      {phone && (
        <a href={`tel:${phone}`}
          onClick={e => e.stopPropagation()}
          className="text-[11px] font-semibold text-[#3A7D44] px-2 py-1 rounded-lg bg-emerald-50 shrink-0">
          📞 {phone}
        </a>
      )}
    </div>
  )
}

// Variant of RecipientLine for the Received tab's per-item recipient
// card. Uses the bordered card layout and renders the "(Dealer)" /
// "(Facilitator)" annotation slightly differently.
function RecipientCardLine({
  recipientName, recipientShopName, recipientPhone, recipientRole,
}: {
  recipientName?: string | null
  recipientShopName?: string | null
  recipientPhone?: string | null
  recipientRole?: 'DEALER' | 'FACILITATOR' | null
}) {
  const t = useTranslations('orders.cropOrders.recipient')
  return (
    <div className="border-t border-[#F0E5D0] px-4 py-2 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[#6B3F1F] truncate">
          {recipientShopName || recipientName}
        </p>
        {(recipientShopName && recipientName) || recipientRole === 'FACILITATOR' ? (
          <p className="text-[10px] text-[#7A8C7E] truncate">
            {recipientRole === 'FACILITATOR'
              ? t('nameWithFacilitator', { name: recipientName ?? '' })
              : t('nameWithDealer', { name: recipientName ?? '' })}
          </p>
        ) : null}
      </div>
      {recipientPhone && (
        <a href={`tel:${recipientPhone}`}
          className="text-[11px] font-semibold text-[#3A7D44] px-2 py-1 rounded-lg bg-emerald-50 shrink-0">
          📞 {recipientPhone}
        </a>
      )}
    </div>
  )
}
